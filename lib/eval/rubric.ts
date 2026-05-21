import type { CoordinatorResult, LaneName, LaneResult } from "@/lib/types";
import type { Scenario } from "@/lib/eval/scenarios";

export type LaneScore = {
  lane: LaneName;
  componentScores: Record<string, number>;
  total: number;
  maxTotal: number;
  brierOutcome: 0 | 1;
};

export type ScenarioScore = {
  scenarioId: string;
  laneScores: LaneScore[];
  totalScore: number;
  maxTotalScore: number;
};

const SOURCE_READER_WEIGHTS = {
  fileMatch: 40,
  lineRangeIoU: 20,
  hasSnippet: 15,
  hasReasoning: 25,
};

const BLAME_WEIGHTS = {
  topSuspectMatch: 60,
  hasCandidates: 20,
  hasReasoning: 20,
};

const FREQUENCY_WEIGHTS = {
  severityMatch: 60,
  hasMetrics: 40,
};

const REPRO_WEIGHTS = {
  hasSteps: 50,
  envSpecified: 30,
  acknowledgesGaps: 20,
};

export function scoreSourceReader(
  result: Extract<LaneResult, { lane: "source-reader" }>,
  gt: Scenario["groundTruth"],
): LaneScore {
  const fileMatch = result.file === gt.file ? SOURCE_READER_WEIGHTS.fileMatch : 0;
  const iou = lineRangeIoU(result.lineRange, gt.lineRange);
  const lineRangeIoUPts = iou * SOURCE_READER_WEIGHTS.lineRangeIoU;
  const hasSnippet =
    result.snippet.length > 0 ? SOURCE_READER_WEIGHTS.hasSnippet : 0;
  const hasReasoning =
    result.reasoning.length > 20 ? SOURCE_READER_WEIGHTS.hasReasoning : 0;

  const brierOutcome: 0 | 1 = fileMatch > 0 && iou >= 0.5 ? 1 : 0;
  return {
    lane: "source-reader",
    componentScores: {
      fileMatch,
      lineRangeIoU: lineRangeIoUPts,
      hasSnippet,
      hasReasoning,
    },
    total: fileMatch + lineRangeIoUPts + hasSnippet + hasReasoning,
    maxTotal: sum(Object.values(SOURCE_READER_WEIGHTS)),
    brierOutcome,
  };
}

export function scoreBlameCorrelator(
  result: Extract<LaneResult, { lane: "blame-correlator" }>,
  gt: Scenario["groundTruth"],
): LaneScore {
  const topSuspectMatch =
    result.topSuspect === gt.topSuspectSha ? BLAME_WEIGHTS.topSuspectMatch : 0;
  const hasCandidates =
    result.candidates.length > 0 ? BLAME_WEIGHTS.hasCandidates : 0;
  const hasReasoning =
    result.candidates.every((c) => c.reasoning.length > 10)
      ? BLAME_WEIGHTS.hasReasoning
      : 0;
  const brierOutcome: 0 | 1 = topSuspectMatch > 0 ? 1 : 0;
  return {
    lane: "blame-correlator",
    componentScores: { topSuspectMatch, hasCandidates, hasReasoning },
    total: topSuspectMatch + hasCandidates + hasReasoning,
    maxTotal: sum(Object.values(BLAME_WEIGHTS)),
    brierOutcome,
  };
}

export function scoreFrequencyAnalyzer(
  result: Extract<LaneResult, { lane: "frequency-analyzer" }>,
  gt: Scenario["groundTruth"],
): LaneScore {
  const severityMatch =
    result.severityClass === gt.severityClass ? FREQUENCY_WEIGHTS.severityMatch : 0;
  const hasMetrics =
    result.totalOccurrences > 0 && result.affectedUsers >= 0
      ? FREQUENCY_WEIGHTS.hasMetrics
      : 0;
  const brierOutcome: 0 | 1 = severityMatch > 0 ? 1 : 0;
  return {
    lane: "frequency-analyzer",
    componentScores: { severityMatch, hasMetrics },
    total: severityMatch + hasMetrics,
    maxTotal: sum(Object.values(FREQUENCY_WEIGHTS)),
    brierOutcome,
  };
}

export function scoreReproDrafter(
  result: Extract<LaneResult, { lane: "repro-drafter" }>,
  gt: Scenario["groundTruth"],
): LaneScore {
  const hasSteps = result.reproSteps.length > 0 ? REPRO_WEIGHTS.hasSteps : 0;
  const envSpecified =
    result.reproEnvironment.length > 0 ? REPRO_WEIGHTS.envSpecified : 0;
  const acknowledgesGaps =
    result.knownGaps.length > 0 ? REPRO_WEIGHTS.acknowledgesGaps : 0;
  const total = hasSteps + envSpecified + acknowledgesGaps;
  const brierOutcome: 0 | 1 = gt.reproExpected
    ? total >= REPRO_WEIGHTS.hasSteps + REPRO_WEIGHTS.envSpecified
      ? 1
      : 0
    : 1;
  return {
    lane: "repro-drafter",
    componentScores: { hasSteps, envSpecified, acknowledgesGaps },
    total,
    maxTotal: sum(Object.values(REPRO_WEIGHTS)),
    brierOutcome,
  };
}

export function scoreScenario(
  scenario: Scenario,
  coordinatorResult: CoordinatorResult,
): ScenarioScore {
  const laneScores: LaneScore[] = [];
  for (const outcome of coordinatorResult.outcomes) {
    if (outcome.status !== "fulfilled") continue;
    const result = outcome.value;
    if (result.lane === "source-reader") {
      laneScores.push(scoreSourceReader(result, scenario.groundTruth));
    } else if (result.lane === "blame-correlator") {
      laneScores.push(scoreBlameCorrelator(result, scenario.groundTruth));
    } else if (result.lane === "frequency-analyzer") {
      laneScores.push(scoreFrequencyAnalyzer(result, scenario.groundTruth));
    } else if (result.lane === "repro-drafter") {
      laneScores.push(scoreReproDrafter(result, scenario.groundTruth));
    }
  }
  return {
    scenarioId: scenario.id,
    laneScores,
    totalScore: laneScores.reduce((s, l) => s + l.total, 0),
    maxTotalScore: laneScores.reduce((s, l) => s + l.maxTotal, 0),
  };
}

function lineRangeIoU(
  predicted: [number, number],
  truth: [number, number],
): number {
  const intersectStart = Math.max(predicted[0], truth[0]);
  const intersectEnd = Math.min(predicted[1], truth[1]);
  const intersect = Math.max(0, intersectEnd - intersectStart + 1);
  const unionStart = Math.min(predicted[0], truth[0]);
  const unionEnd = Math.max(predicted[1], truth[1]);
  const union = unionEnd - unionStart + 1;
  if (union <= 0) return 0;
  return intersect / union;
}

function sum(values: number[]): number {
  return values.reduce((s, v) => s + v, 0);
}
