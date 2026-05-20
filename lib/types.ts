export type DebugInput = {
  stackTrace: string;
  repoUrl: string;
  deployedSha: string;
  errorTimestamp: string;
  errorFingerprint: string;
};

export type SourceReaderResult = {
  lane: "source-reader";
  file: string;
  lineRange: [number, number];
  snippet: string;
  surroundingContext: string;
  confidence: number;
  reasoning: string;
};

export type BlameCandidate = {
  sha: string;
  author: string;
  date: string;
  summary: string;
  relevance: number;
  reasoning: string;
};

export type BlameCorrelatorResult = {
  lane: "blame-correlator";
  candidates: BlameCandidate[];
  topSuspect: string | null;
  confidence: number;
};

export type FrequencyAnalyzerResult = {
  lane: "frequency-analyzer";
  totalOccurrences: number;
  affectedUsers: number;
  firstSeen: string;
  spikeDetected: boolean;
  ratePerHour: number[];
  relatedFingerprints: string[];
  severityClass: "p0" | "p1" | "p2" | "p3";
  confidence: number;
};

export type ReproDrafterResult = {
  lane: "repro-drafter";
  reproSteps: string[];
  reproCode: string | null;
  reproEnvironment: string;
  knownGaps: string[];
  confidence: number;
};

export type LaneResult =
  | SourceReaderResult
  | BlameCorrelatorResult
  | FrequencyAnalyzerResult
  | ReproDrafterResult;

export type LaneName = LaneResult["lane"];

export type LaneOutcome =
  | { lane: LaneName; status: "fulfilled"; value: LaneResult; durationMs: number }
  | { lane: LaneName; status: "rejected"; reason: string; durationMs: number };

export type Hypothesis = {
  title: string;
  description: string;
  supportingLanes: LaneName[];
  confidence: number;
};

export type CoordinatorResult = {
  outcomes: LaneOutcome[];
  hypotheses: Hypothesis[];
  totalDurationMs: number;
};
