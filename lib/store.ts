import { Redis } from "@upstash/redis";
import type { CostSummary, UsageSample } from "@/lib/cost";
import { CostAccumulator } from "@/lib/cost";
import type { CoordinatorResult, LaneName, LaneOutcome, LaneResult } from "@/lib/types";

const HAS_UPSTASH = Boolean(
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN,
);
const redis = HAS_UPSTASH ? Redis.fromEnv() : null;
const ABORT_KEY = (sessionId: string) => `forge:abort:${sessionId}`;

export type SessionStatus = "running" | "complete" | "aborted";

export type SpeculatorMetricsSnapshot = {
  predictions: number;
  hits: number;
  misses: number;
  inFlight: number;
};

export type SessionState = {
  sessionId: string;
  status: SessionStatus;
  startedAt: number;
  finishedAt: number | null;
  laneStatus: Record<LaneName, LaneStatus>;
  laneResults: Partial<Record<LaneName, LaneResult>>;
  laneErrors: Partial<Record<LaneName, string>>;
  laneDurations: Partial<Record<LaneName, number>>;
  outcomes: LaneOutcome[];
  hypotheses: CoordinatorResult["hypotheses"];
  totalDurationMs: number | null;
  abortedLanes: LaneName[];
  speculatorMetrics: SpeculatorMetricsSnapshot | null;
  cost: CostSummary | null;
};

export type LaneStatus = "queued" | "running" | "done" | "error" | "aborted";

export type SessionStore = {
  create(sessionId: string): Promise<SessionState>;
  get(sessionId: string): Promise<SessionState | null>;
  patch(
    sessionId: string,
    patch: (state: SessionState) => SessionState,
  ): Promise<SessionState>;
  delete(sessionId: string): Promise<void>;
};

const costAccumulators = new Map<string, CostAccumulator>();

export function recordUsage(sessionId: string, sample: UsageSample): void {
  let acc = costAccumulators.get(sessionId);
  if (!acc) {
    acc = new CostAccumulator();
    costAccumulators.set(sessionId, acc);
  }
  acc.record(sample);
}

export function summarizeCost(sessionId: string): CostSummary | null {
  return costAccumulators.get(sessionId)?.summarize() ?? null;
}

export function clearCost(sessionId: string): void {
  costAccumulators.delete(sessionId);
}

const INITIAL_LANE_STATUS: Record<LaneName, LaneStatus> = {
  "source-reader": "queued",
  "blame-correlator": "queued",
  "frequency-analyzer": "queued",
  "repro-drafter": "queued",
};

class InMemoryStore implements SessionStore {
  private sessions = new Map<string, SessionState>();
  private aborters = new Map<string, Set<LaneName>>();
  private controllers = new Map<string, Map<LaneName, AbortController>>();

  async create(sessionId: string): Promise<SessionState> {
    const state: SessionState = {
      sessionId,
      status: "running",
      startedAt: Date.now(),
      finishedAt: null,
      laneStatus: { ...INITIAL_LANE_STATUS },
      laneResults: {},
      laneErrors: {},
      laneDurations: {},
      outcomes: [],
      hypotheses: [],
      totalDurationMs: null,
      abortedLanes: [],
      speculatorMetrics: null,
      cost: null,
    };
    this.sessions.set(sessionId, state);
    return state;
  }

  async get(sessionId: string): Promise<SessionState | null> {
    return this.sessions.get(sessionId) ?? null;
  }

  async patch(
    sessionId: string,
    patch: (state: SessionState) => SessionState,
  ): Promise<SessionState> {
    const current = this.sessions.get(sessionId);
    if (!current) throw new Error(`session not found: ${sessionId}`);
    const next = patch(current);
    this.sessions.set(sessionId, next);
    return next;
  }

  async delete(sessionId: string): Promise<void> {
    this.sessions.delete(sessionId);
    this.aborters.delete(sessionId);
    this.controllers.delete(sessionId);
  }

  requestLaneAbort(sessionId: string, lane: LaneName): void {
    let set = this.aborters.get(sessionId);
    if (!set) {
      set = new Set();
      this.aborters.set(sessionId, set);
    }
    set.add(lane);
    const controller = this.controllers.get(sessionId)?.get(lane);
    if (controller && !controller.signal.aborted) {
      controller.abort();
    }
  }

  isLaneAborted(sessionId: string, lane: LaneName): boolean {
    return this.aborters.get(sessionId)?.has(lane) ?? false;
  }

  registerController(
    sessionId: string,
    lane: LaneName,
    controller: AbortController,
  ): void {
    let map = this.controllers.get(sessionId);
    if (!map) {
      map = new Map();
      this.controllers.set(sessionId, map);
    }
    map.set(lane, controller);
  }
}

const globalStore = (globalThis as { __forgeStore?: InMemoryStore }).__forgeStore;
const store = globalStore ?? new InMemoryStore();
if (!globalStore) (globalThis as { __forgeStore?: InMemoryStore }).__forgeStore = store;

export const sessionStore: SessionStore = store;

export function requestLaneAbort(sessionId: string, lane: LaneName): void {
  store.requestLaneAbort(sessionId, lane);
}

export async function requestLaneAbortUpstash(
  sessionId: string,
  lane: LaneName,
): Promise<void> {
  if (!redis) return;
  await redis.sadd(ABORT_KEY(sessionId), lane);
  await redis.expire(ABORT_KEY(sessionId), 600);
}

export async function isLaneAbortedUpstash(
  sessionId: string,
  lane: LaneName,
): Promise<boolean> {
  if (!redis) return false;
  const isMember = await redis.sismember(ABORT_KEY(sessionId), lane);
  return Boolean(isMember);
}

export function isLaneAborted(sessionId: string, lane: LaneName): boolean {
  return store.isLaneAborted(sessionId, lane);
}

export function registerLaneController(
  sessionId: string,
  lane: LaneName,
  controller: AbortController,
): void {
  store.registerController(sessionId, lane, controller);
}
