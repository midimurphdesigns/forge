import { promises as fs } from "node:fs";
import path from "node:path";
import type { LaneName } from "@/lib/types";

export type CalibrationRecord = {
  lane: LaneName;
  predicted: number;
  outcome: 0 | 1;
  timestamp: string;
  sessionId: string;
};

export type LaneCalibration = {
  lane: LaneName;
  sampleCount: number;
  brierScore: number | null;
  meanPredicted: number;
  meanOutcome: number;
  weight: number;
};

const DATA_DIR = path.join(process.cwd(), ".forge");
const LOG_PATH = path.join(DATA_DIR, "calibration.jsonl");

let writeDisabled = false;

async function ensureDir(): Promise<boolean> {
  if (writeDisabled) return false;
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
    return true;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "EROFS" || code === "EACCES" || code === "ENOENT") {
      writeDisabled = true;
      return false;
    }
    throw err;
  }
}

export async function logOutcome(record: CalibrationRecord): Promise<void> {
  const ok = await ensureDir();
  if (!ok) return;
  try {
    const line = JSON.stringify(record) + "\n";
    await fs.appendFile(LOG_PATH, line, "utf8");
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "EROFS" || code === "EACCES") {
      writeDisabled = true;
      return;
    }
    throw err;
  }
}

export async function readRecords(): Promise<CalibrationRecord[]> {
  try {
    const text = await fs.readFile(LOG_PATH, "utf8");
    return text
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line) as CalibrationRecord);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "EACCES") return [];
    throw err;
  }
}

export async function getCalibration(): Promise<Record<LaneName, LaneCalibration>> {
  const records = await readRecords();
  const lanes: LaneName[] = [
    "source-reader",
    "blame-correlator",
    "frequency-analyzer",
    "repro-drafter",
  ];

  const stats: Record<LaneName, LaneCalibration> = {} as Record<LaneName, LaneCalibration>;

  for (const lane of lanes) {
    const laneRecords = records.filter((r) => r.lane === lane);
    if (laneRecords.length === 0) {
      stats[lane] = {
        lane,
        sampleCount: 0,
        brierScore: null,
        meanPredicted: 0,
        meanOutcome: 0,
        weight: 1.0,
      };
      continue;
    }
    const n = laneRecords.length;
    const brier =
      laneRecords.reduce((sum, r) => sum + (r.predicted - r.outcome) ** 2, 0) / n;
    const meanPredicted = laneRecords.reduce((sum, r) => sum + r.predicted, 0) / n;
    const meanOutcome = laneRecords.reduce((sum, r) => sum + r.outcome, 0) / n;
    const weight = computeWeight(meanPredicted, meanOutcome, n);
    stats[lane] = {
      lane,
      sampleCount: n,
      brierScore: brier,
      meanPredicted,
      meanOutcome,
      weight,
    };
  }
  return stats;
}

function computeWeight(meanPredicted: number, meanOutcome: number, n: number): number {
  if (n < 3) return 1.0;
  if (meanPredicted <= 0) return 1.0;
  const ratio = meanOutcome / meanPredicted;
  return Math.max(0.5, Math.min(1.5, ratio));
}
