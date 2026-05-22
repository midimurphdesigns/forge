/**
 * Representative eval snapshot for the live demo.
 *
 * Hand-curated to illustrate what `pnpm eval --runs=3` produces. Numbers
 * are shaped like real eval output (mean rubric % per scenario, stddev
 * in raw points, mean duration ms). The harness writes timestamped JSON
 * snapshots to `.forge/evals/` on every CLI run; this file is what the
 * demo page renders so visitors see the eval shape without spending
 * tokens on a fresh server-side run per visit.
 */

export type EvalScenarioResult = {
  scenarioId: string;
  description: string;
  runs: number;
  maxScore: number;
  meanScore: number;
  meanScorePct: number;
  stddevScore: number;
  meanDurationMs: number;
};

export type EvalSnapshot = {
  runAt: string;
  runsPerScenario: number;
  scenarios: EvalScenarioResult[];
  totalMeanScorePct: number;
};

export const EVAL_SNAPSHOT: EvalSnapshot = {
  runAt: "2026-05-20",
  runsPerScenario: 3,
  totalMeanScorePct: 78,
  scenarios: [
    {
      scenarioId: "auth-null-session",
      description: "Null session deref after migration removed null guard",
      runs: 3,
      maxScore: 360,
      meanScore: 312,
      meanScorePct: 87,
      stddevScore: 11.4,
      meanDurationMs: 22480,
    },
    {
      scenarioId: "checkout-undefined-price",
      description: "Undefined price field crash after price service refactor",
      runs: 3,
      maxScore: 360,
      meanScore: 286,
      meanScorePct: 79,
      stddevScore: 18.2,
      meanDurationMs: 24910,
    },
    {
      scenarioId: "rate-limit-loop",
      description: "Infinite retry loop after rate-limit threshold removed",
      runs: 3,
      maxScore: 360,
      meanScore: 268,
      meanScorePct: 74,
      stddevScore: 22.6,
      meanDurationMs: 26340,
    },
    {
      scenarioId: "cron-missed-schedule",
      description: "Cron job misses schedule due to off-by-one in cron expression",
      runs: 3,
      maxScore: 360,
      meanScore: 244,
      meanScorePct: 68,
      stddevScore: 24.1,
      meanDurationMs: 21070,
    },
    {
      scenarioId: "webhook-replay",
      description: "Webhook replay causes duplicate charge due to missing idempotency",
      runs: 3,
      maxScore: 360,
      meanScore: 296,
      meanScorePct: 82,
      stddevScore: 15.3,
      meanDurationMs: 25620,
    },
  ],
};
