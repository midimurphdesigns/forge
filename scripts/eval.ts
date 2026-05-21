import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { runCoordinator } from "@/lib/coordinator";
import { sessionStore } from "@/lib/store";
import { SCENARIOS, type Scenario } from "@/lib/eval/scenarios";
import { scoreScenario, type ScenarioScore } from "@/lib/eval/rubric";

type RunOptions = {
  runsPerScenario: number;
  dryRun: boolean;
  scenarioFilter: string | null;
};

function parseArgs(): RunOptions {
  const args = process.argv.slice(2);
  return {
    runsPerScenario: Number(args.find((a) => a.startsWith("--runs="))?.slice(7) ?? "1"),
    dryRun: args.includes("--dry-run"),
    scenarioFilter:
      args.find((a) => a.startsWith("--scenario="))?.slice(11) ?? null,
  };
}

async function runOnce(
  scenario: Scenario,
): Promise<{ score: ScenarioScore; durationMs: number }> {
  const sessionId = randomUUID();
  await sessionStore.create(sessionId);
  const startedAt = Date.now();
  const coordinatorResult = await runCoordinator(sessionId, scenario.input);
  const durationMs = Date.now() - startedAt;
  const score = scoreScenario(scenario, coordinatorResult);
  await sessionStore.delete(sessionId);
  return { score, durationMs };
}

function aggregate(
  scenarioId: string,
  runs: Array<{ score: ScenarioScore; durationMs: number }>,
) {
  const totals = runs.map((r) => r.score.totalScore);
  const max = runs[0].score.maxTotalScore;
  const mean = totals.reduce((s, v) => s + v, 0) / totals.length;
  const variance =
    totals.reduce((s, v) => s + (v - mean) ** 2, 0) / totals.length;
  const stddev = Math.sqrt(variance);
  const meanDuration =
    runs.reduce((s, r) => s + r.durationMs, 0) / runs.length;
  return {
    scenarioId,
    runs: runs.length,
    maxScore: max,
    meanScore: mean,
    stddevScore: stddev,
    meanDurationMs: Math.round(meanDuration),
  };
}

async function main() {
  const opts = parseArgs();
  const scenarios = opts.scenarioFilter
    ? SCENARIOS.filter((s) => s.id === opts.scenarioFilter)
    : SCENARIOS;

  console.log(`forge eval — ${scenarios.length} scenarios × ${opts.runsPerScenario} runs`);
  if (opts.dryRun) {
    console.log("dry-run mode — no LLM calls will be made");
    for (const s of scenarios) {
      console.log(`  - ${s.id}: ${s.description}`);
    }
    return;
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("ANTHROPIC_API_KEY required to run real evals");
    process.exit(1);
  }

  const allResults = [];
  for (const scenario of scenarios) {
    console.log(`\nscenario ${scenario.id}`);
    const runs: Array<{ score: ScenarioScore; durationMs: number }> = [];
    for (let i = 0; i < opts.runsPerScenario; i++) {
      process.stdout.write(`  run ${i + 1}/${opts.runsPerScenario}... `);
      try {
        const result = await runOnce(scenario);
        runs.push(result);
        const pct = Math.round(
          (result.score.totalScore / result.score.maxTotalScore) * 100,
        );
        console.log(`${pct}% (${result.durationMs}ms)`);
      } catch (err) {
        console.log(`ERROR: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    if (runs.length === 0) continue;
    const agg = aggregate(scenario.id, runs);
    allResults.push(agg);
    console.log(
      `  mean ${Math.round((agg.meanScore / agg.maxScore) * 100)}% ± ${agg.stddevScore.toFixed(1)} pts`,
    );
  }

  const outDir = path.join(process.cwd(), ".forge", "evals");
  await fs.mkdir(outDir, { recursive: true });
  const outPath = path.join(outDir, `${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  await fs.writeFile(
    outPath,
    JSON.stringify({ runAt: new Date().toISOString(), opts, results: allResults }, null, 2),
  );
  console.log(`\nsnapshot written to ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
