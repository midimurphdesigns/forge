import pLimit from "p-limit";
import { runBlameCorrelator } from "@/lib/agents/blame-correlator";
import { runFrequencyAnalyzer } from "@/lib/agents/frequency-analyzer";
import { runReproDrafter } from "@/lib/agents/repro-drafter";
import { runSourceReader } from "@/lib/agents/source-reader";
import type {
  CoordinatorResult,
  DebugInput,
  Hypothesis,
  LaneName,
  LaneOutcome,
  LaneResult,
} from "@/lib/types";

type LaneRunner = (input: DebugInput) => Promise<LaneResult>;

const LANES: Array<{ name: LaneName; run: LaneRunner }> = [
  { name: "source-reader", run: runSourceReader },
  { name: "blame-correlator", run: runBlameCorrelator },
  { name: "frequency-analyzer", run: runFrequencyAnalyzer },
  { name: "repro-drafter", run: runReproDrafter },
];

export type ProgressEvent =
  | { type: "lane:start"; lane: LaneName }
  | { type: "lane:done"; lane: LaneName; durationMs: number; result: LaneResult }
  | { type: "lane:error"; lane: LaneName; durationMs: number; reason: string }
  | { type: "merge"; hypotheses: Hypothesis[]; totalDurationMs: number };

export async function runCoordinator(
  input: DebugInput,
  onProgress?: (event: ProgressEvent) => void,
): Promise<CoordinatorResult> {
  const limit = pLimit(4);
  const startedAt = Date.now();

  const outcomes = await Promise.all(
    LANES.map((lane) =>
      limit(async (): Promise<LaneOutcome> => {
        const laneStart = Date.now();
        onProgress?.({ type: "lane:start", lane: lane.name });
        try {
          const value = await lane.run(input);
          const durationMs = Date.now() - laneStart;
          onProgress?.({ type: "lane:done", lane: lane.name, durationMs, result: value });
          return { lane: lane.name, status: "fulfilled", value, durationMs };
        } catch (err) {
          const durationMs = Date.now() - laneStart;
          const reason = err instanceof Error ? err.message : String(err);
          onProgress?.({ type: "lane:error", lane: lane.name, durationMs, reason });
          return { lane: lane.name, status: "rejected", reason, durationMs };
        }
      }),
    ),
  );

  const hypotheses = mergeHypotheses(outcomes);
  const totalDurationMs = Date.now() - startedAt;
  onProgress?.({ type: "merge", hypotheses, totalDurationMs });

  return { outcomes, hypotheses, totalDurationMs };
}

function mergeHypotheses(outcomes: LaneOutcome[]): Hypothesis[] {
  const fulfilled = outcomes.flatMap((o) => (o.status === "fulfilled" ? [o.value] : []));

  const sourceReader = fulfilled.find(
    (r): r is Extract<LaneResult, { lane: "source-reader" }> => r.lane === "source-reader",
  );
  const blame = fulfilled.find(
    (r): r is Extract<LaneResult, { lane: "blame-correlator" }> =>
      r.lane === "blame-correlator",
  );
  const frequency = fulfilled.find(
    (r): r is Extract<LaneResult, { lane: "frequency-analyzer" }> =>
      r.lane === "frequency-analyzer",
  );
  const repro = fulfilled.find(
    (r): r is Extract<LaneResult, { lane: "repro-drafter" }> => r.lane === "repro-drafter",
  );

  const hypotheses: Hypothesis[] = [];

  if (sourceReader && blame?.topSuspect) {
    const supportingLanes: LaneName[] = ["source-reader", "blame-correlator"];
    if (frequency) supportingLanes.push("frequency-analyzer");
    hypotheses.push({
      title: `Regression in ${sourceReader.file}:${sourceReader.lineRange[0]}-${sourceReader.lineRange[1]} introduced by ${blame.topSuspect}`,
      description: `${sourceReader.reasoning}\n\nLikely cause: ${
        blame.candidates.find((c) => c.sha === blame.topSuspect)?.reasoning ?? "see top suspect commit"
      }`,
      supportingLanes,
      confidence: averageConfidence([
        sourceReader.confidence,
        blame.confidence,
        frequency?.confidence,
      ]),
    });
  } else if (sourceReader) {
    hypotheses.push({
      title: `Suspect code path: ${sourceReader.file}:${sourceReader.lineRange[0]}-${sourceReader.lineRange[1]}`,
      description: sourceReader.reasoning,
      supportingLanes: ["source-reader"],
      confidence: sourceReader.confidence,
    });
  }

  if (repro && repro.confidence >= 0.5) {
    hypotheses.push({
      title: "Reproduction available",
      description: `${repro.reproSteps.length} steps. Environment: ${repro.reproEnvironment}.${repro.knownGaps.length > 0 ? ` Gaps: ${repro.knownGaps.join("; ")}.` : ""}`,
      supportingLanes: ["repro-drafter"],
      confidence: repro.confidence * 0.6,
    });
  }

  if (frequency && frequency.severityClass !== "p3") {
    hypotheses.push({
      title: `Severity ${frequency.severityClass.toUpperCase()} — ${frequency.affectedUsers} users affected`,
      description: `${frequency.totalOccurrences} occurrences since ${frequency.firstSeen}.${frequency.spikeDetected ? " Active spike detected." : ""}`,
      supportingLanes: ["frequency-analyzer"],
      confidence: frequency.confidence,
    });
  }

  return hypotheses.sort((a, b) => b.confidence - a.confidence);
}

function averageConfidence(values: Array<number | undefined>): number {
  const present = values.filter((v): v is number => typeof v === "number");
  if (present.length === 0) return 0;
  return present.reduce((sum, v) => sum + v, 0) / present.length;
}
