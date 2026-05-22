"use client";

import { useEffect, useState } from "react";
import { SAMPLE_INPUT } from "@/lib/sample-input";
import type { Hypothesis, LaneName, LaneResult } from "@/lib/types";

type LaneStatus = "queued" | "running" | "done" | "error" | "aborted";

type LaneState = {
  status: LaneStatus;
  durationMs: number | null;
  result: LaneResult | null;
  error: string | null;
};

type SpeculatorMetrics = {
  predictions: number;
  hits: number;
  misses: number;
  inFlight: number;
};

type LaneCalibration = {
  lane: LaneName;
  sampleCount: number;
  brierScore: number | null;
  meanPredicted: number;
  meanOutcome: number;
  weight: number;
};

type CalibrationMap = Record<LaneName, LaneCalibration>;

type LaneCostBreakdown = {
  lane: LaneName | "coercion";
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  inputUsd: number;
  outputUsd: number;
  cacheReadUsd: number;
  cacheCreationUsd: number;
  totalUsd: number;
  cacheHitRate: number;
};

type CostSummary = {
  perLane: LaneCostBreakdown[];
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheReadTokens: number;
  totalCacheCreationTokens: number;
  totalUsd: number;
  cacheHitRate: number;
};

type Frame =
  | { type: "session:open"; sessionId: string }
  | { type: "session:resume"; sessionId: string }
  | { type: "lane:start"; lane: LaneName }
  | { type: "lane:done"; lane: LaneName; durationMs: number; result: LaneResult }
  | { type: "lane:error"; lane: LaneName; durationMs: number; reason: string }
  | { type: "lane:aborted"; lane: LaneName; durationMs: number }
  | {
      type: "lane:replay";
      lane: LaneName;
      status: LaneStatus;
      durationMs: number | null;
      result: LaneResult | null;
      error: string | null;
    }
  | {
      type: "merge";
      hypotheses: Hypothesis[];
      totalDurationMs: number;
      speculatorMetrics: SpeculatorMetrics | null;
      calibration: CalibrationMap;
      cost: CostSummary | null;
    }
  | { type: "fatal"; reason: string };

const LANE_ORDER: LaneName[] = [
  "source-reader",
  "blame-correlator",
  "frequency-analyzer",
  "repro-drafter",
];

const LANE_DESCRIPTIONS: Record<LaneName, string> = {
  "source-reader": "reads the implicated source file",
  "blame-correlator": "ranks suspect commits",
  "frequency-analyzer": "quantifies blast radius",
  "repro-drafter": "drafts a minimal repro",
};

const INITIAL_STATE: Record<LaneName, LaneState> = {
  "source-reader": { status: "queued", durationMs: null, result: null, error: null },
  "blame-correlator": { status: "queued", durationMs: null, result: null, error: null },
  "frequency-analyzer": { status: "queued", durationMs: null, result: null, error: null },
  "repro-drafter": { status: "queued", durationMs: null, result: null, error: null },
};

export default function DebugPage() {
  const [lanes, setLanes] = useState<Record<LaneName, LaneState>>(INITIAL_STATE);
  const [hypotheses, setHypotheses] = useState<Hypothesis[]>([]);
  const [totalDurationMs, setTotalDurationMs] = useState<number | null>(null);
  const [speculatorMetrics, setSpeculatorMetrics] = useState<SpeculatorMetrics | null>(
    null,
  );
  const [calibration, setCalibration] = useState<CalibrationMap | null>(null);
  const [cost, setCost] = useState<CostSummary | null>(null);
  const [running, setRunning] = useState(false);
  const [fatal, setFatal] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const existing = params.get("sessionId");
    if (existing) {
      void resume(existing);
    }
  }, []);

  const updateUrl = (id: string) => {
    const url = new URL(window.location.href);
    url.searchParams.set("sessionId", id);
    window.history.replaceState(null, "", url.toString());
  };

  const clearUrl = () => {
    const url = new URL(window.location.href);
    url.searchParams.delete("sessionId");
    window.history.replaceState(null, "", url.toString());
  };

  const handleFrame = (frame: Frame) => {
    if (frame.type === "session:open" || frame.type === "session:resume") {
      setSessionId(frame.sessionId);
      updateUrl(frame.sessionId);
    } else if (frame.type === "lane:start") {
      setLanes((prev) => ({
        ...prev,
        [frame.lane]: { ...prev[frame.lane], status: "running" },
      }));
    } else if (frame.type === "lane:done") {
      setLanes((prev) => ({
        ...prev,
        [frame.lane]: {
          status: "done",
          durationMs: frame.durationMs,
          result: frame.result,
          error: null,
        },
      }));
    } else if (frame.type === "lane:error") {
      setLanes((prev) => ({
        ...prev,
        [frame.lane]: {
          status: "error",
          durationMs: frame.durationMs,
          result: null,
          error: frame.reason,
        },
      }));
    } else if (frame.type === "lane:aborted") {
      setLanes((prev) => ({
        ...prev,
        [frame.lane]: {
          status: "aborted",
          durationMs: frame.durationMs,
          result: null,
          error: "aborted by user",
        },
      }));
    } else if (frame.type === "lane:replay") {
      setLanes((prev) => ({
        ...prev,
        [frame.lane]: {
          status: frame.status,
          durationMs: frame.durationMs,
          result: frame.result,
          error: frame.error,
        },
      }));
    } else if (frame.type === "merge") {
      setHypotheses(frame.hypotheses);
      setTotalDurationMs(frame.totalDurationMs);
      setSpeculatorMetrics(frame.speculatorMetrics);
      setCalibration(frame.calibration);
      setCost(frame.cost);
    } else if (frame.type === "fatal") {
      setFatal(frame.reason);
    }
  };

  const consumeStream = async (res: Response) => {
    if (!res.ok || !res.body) {
      setFatal(`request failed: ${res.status} ${res.statusText}`);
      return;
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const frames = buffer.split("\n\n");
      buffer = frames.pop() ?? "";

      for (const raw of frames) {
        if (!raw.startsWith("data: ")) continue;
        const json = raw.slice(6).trim();
        if (!json) continue;
        handleFrame(JSON.parse(json) as Frame);
      }
    }
  };

  const run = async () => {
    setLanes(INITIAL_STATE);
    setHypotheses([]);
    setTotalDurationMs(null);
    setSpeculatorMetrics(null);
    setCalibration(null);
    setCost(null);
    setFatal(null);
    setRunning(true);
    clearUrl();
    setSessionId(null);
    try {
      const res = await fetch("/api/debug", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(SAMPLE_INPUT),
      });
      await consumeStream(res);
    } catch (err) {
      setFatal(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(false);
    }
  };

  const resume = async (id: string) => {
    setLanes(INITIAL_STATE);
    setHypotheses([]);
    setTotalDurationMs(null);
    setSpeculatorMetrics(null);
    setCalibration(null);
    setCost(null);
    setFatal(null);
    setRunning(true);
    try {
      const res = await fetch(`/api/debug?sessionId=${encodeURIComponent(id)}`);
      await consumeStream(res);
    } catch (err) {
      setFatal(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(false);
    }
  };

  const interrupt = async (lane: LaneName) => {
    if (!sessionId) return;
    await fetch("/api/debug/interrupt", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId, lane }),
    });
  };

  return (
    <main className="relative z-10 mx-auto flex min-h-screen w-full max-w-5xl flex-col gap-10 px-6 py-16">
      <header className="flex flex-col gap-3">
        <h1 className="font-display text-[88px] leading-[0.95] tracking-tight">
          forge <span className="text-[var(--color-ink-faint)]">/ debug</span>
        </h1>
        <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--color-ink-muted)]">
          parallel multi-agent investigation · resumable · per-lane interrupt
        </p>
        {sessionId && (
          <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--color-ink-faint)]">
            session{" "}
            <span className="text-[var(--color-accent)]">{sessionId.slice(0, 8)}</span>{" "}
            · refresh to resume
          </p>
        )}
      </header>

      <section className="flex flex-wrap items-center gap-4">
        <button
          type="button"
          onClick={run}
          disabled={running}
          className="rounded border border-[var(--color-accent)] bg-[var(--color-accent)] px-5 py-2.5 text-sm font-medium text-[var(--color-canvas)] transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          {running ? "investigating..." : "run sample investigation"}
        </button>
        {totalDurationMs !== null && (
          <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--color-ink-muted)]">
            wall-clock {totalDurationMs}ms
          </span>
        )}
        {speculatorMetrics && speculatorMetrics.predictions > 0 && (
          <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--color-ink-muted)]">
            speculator {speculatorMetrics.hits}/{speculatorMetrics.predictions} (
            {Math.round((speculatorMetrics.hits / speculatorMetrics.predictions) * 100)}
            %)
          </span>
        )}
      </section>

      <section className="grid grid-cols-1 gap-5 md:grid-cols-2">
        {LANE_ORDER.map((laneName) => {
          const lane = lanes[laneName];
          const canInterrupt = lane.status === "running" && sessionId !== null;
          return (
            <article
              key={laneName}
              className="flex flex-col gap-3 rounded border border-[var(--color-divider)] bg-[var(--color-canvas-elev-1)] p-5"
            >
              <header className="flex items-baseline justify-between gap-3">
                <div className="flex flex-col gap-1">
                  <h2 className="font-mono text-sm font-bold text-[var(--color-ink)]">
                    {laneName}
                  </h2>
                  <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-ink-faint)]">
                    {LANE_DESCRIPTIONS[laneName]}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <StatusBadge status={lane.status} durationMs={lane.durationMs} />
                  {canInterrupt && (
                    <button
                      type="button"
                      onClick={() => interrupt(laneName)}
                      className="font-mono text-[10px] uppercase tracking-[0.18em] text-red-400 underline underline-offset-2"
                    >
                      stop
                    </button>
                  )}
                </div>
              </header>
              <LaneBody lane={lane} />
            </article>
          );
        })}
      </section>

      {hypotheses.length > 0 && (
        <section className="flex flex-col gap-4">
          <h2 className="font-display text-[40px] leading-none tracking-tight">
            ranked hypotheses
          </h2>
          {hypotheses.map((h, i) => (
            <article
              key={i}
              className="rounded border-l-2 border-[var(--color-accent)] bg-[var(--color-canvas-elev-1)] p-5"
            >
              <header className="flex items-baseline justify-between gap-3">
                <h3 className="text-sm font-medium text-[var(--color-ink)]">
                  {h.title}
                </h3>
                <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-accent)]">
                  conf {(h.confidence * 100).toFixed(0)}%
                </span>
              </header>
              <p className="mt-3 whitespace-pre-wrap text-[13px] leading-relaxed text-[var(--color-ink-muted)]">
                {h.description}
              </p>
              <footer className="mt-3 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-ink-faint)]">
                supported by: {h.supportingLanes.join(" · ")}
              </footer>
            </article>
          ))}
        </section>
      )}

      {calibration && (
        <section className="flex flex-col gap-3">
          <h2 className="font-display text-[40px] leading-none tracking-tight">
            calibration
          </h2>
          <p className="text-[13px] leading-relaxed text-[var(--color-ink-muted)]">
            Brier score per lane (lower is better; 0 = perfect, 0.25 = uncalibrated). Weight is applied to confidence on next run.
          </p>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {LANE_ORDER.map((laneName) => {
              const c = calibration[laneName];
              return (
                <div
                  key={laneName}
                  className="rounded border border-[var(--color-divider)] bg-[var(--color-canvas-elev-1)] p-4"
                >
                  <div className="font-mono text-sm font-bold text-[var(--color-ink)]">
                    {laneName}
                  </div>
                  <div className="mt-1 font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--color-ink-muted)]">
                    samples {c.sampleCount} · brier{" "}
                    {c.brierScore === null ? "—" : c.brierScore.toFixed(3)} · weight{" "}
                    {c.weight.toFixed(2)}
                  </div>
                  <div className="mt-1 font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--color-ink-faint)]">
                    predicted {c.meanPredicted.toFixed(2)} vs outcome{" "}
                    {c.meanOutcome.toFixed(2)}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {cost && cost.perLane.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="font-display text-[40px] leading-none tracking-tight">cost</h2>
          <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--color-ink-muted)]">
            ${cost.totalUsd.toFixed(4)} total · {cost.totalInputTokens.toLocaleString()}{" "}
            input · {cost.totalOutputTokens.toLocaleString()} output ·{" "}
            {cost.totalCacheReadTokens.toLocaleString()} cache-read ·{" "}
            {Math.round(cost.cacheHitRate * 100)}% hit rate
          </p>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {cost.perLane.map((l) => (
              <div
                key={l.lane}
                className="rounded border border-[var(--color-divider)] bg-[var(--color-canvas-elev-1)] p-4"
              >
                <div className="font-mono text-sm font-bold text-[var(--color-ink)]">
                  {l.lane}
                </div>
                <div className="mt-1 font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--color-ink-muted)]">
                  ${l.totalUsd.toFixed(4)} · in {l.inputTokens.toLocaleString()} · out{" "}
                  {l.outputTokens.toLocaleString()}
                </div>
                <div className="mt-1 font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--color-ink-faint)]">
                  cache: read {l.cacheReadTokens.toLocaleString()} · write{" "}
                  {l.cacheCreationTokens.toLocaleString()} · hit{" "}
                  {Math.round(l.cacheHitRate * 100)}%
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {fatal && (
        <section className="rounded border-l-2 border-red-400 bg-red-950/20 p-4">
          <h2 className="font-mono text-[11px] uppercase tracking-[0.18em] text-red-300">
            fatal
          </h2>
          <p className="mt-2 text-[13px] text-red-200">{fatal}</p>
        </section>
      )}
    </main>
  );
}

function StatusBadge({
  status,
  durationMs,
}: {
  status: LaneStatus;
  durationMs: number | null;
}) {
  const color =
    status === "done"
      ? "text-[var(--color-accent)]"
      : status === "running"
        ? "text-yellow-400"
        : status === "error"
          ? "text-red-400"
          : status === "aborted"
            ? "text-orange-400"
            : "text-[var(--color-ink-faint)]";
  return (
    <span
      className={`font-mono text-[10px] uppercase tracking-[0.18em] ${color}`}
    >
      {status}
      {durationMs !== null && status !== "running" ? ` ${durationMs}ms` : ""}
    </span>
  );
}

function LaneBody({ lane }: { lane: LaneState }) {
  if (lane.status === "queued") {
    return (
      <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--color-ink-faint)]">
        waiting...
      </p>
    );
  }
  if (lane.status === "running") {
    return (
      <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-yellow-400">
        working...
      </p>
    );
  }
  if (lane.status === "error" || lane.status === "aborted") {
    return (
      <p className="text-[12px] text-red-300">{lane.error ?? "no detail"}</p>
    );
  }
  if (lane.result) {
    return <ResultBody result={lane.result} />;
  }
  return null;
}

const META_LABEL =
  "font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-ink-faint)]";

function ResultBody({ result }: { result: LaneResult }) {
  if (result.lane === "source-reader") {
    return (
      <div className="flex flex-col gap-2 text-[13px] text-[var(--color-ink-muted)]">
        <div>
          <span className={META_LABEL}>file</span> {result.file}:
          {result.lineRange[0]}-{result.lineRange[1]}
        </div>
        <div>
          <span className={META_LABEL}>conf</span>{" "}
          <span className="text-[var(--color-accent)]">
            {(result.confidence * 100).toFixed(0)}%
          </span>
        </div>
        <pre className="mt-1 overflow-x-auto rounded border border-[var(--color-divider)] bg-[var(--color-canvas)] p-3 font-mono text-[10px] leading-relaxed text-[var(--color-ink-muted)]">
          {result.snippet}
        </pre>
      </div>
    );
  }
  if (result.lane === "blame-correlator") {
    return (
      <div className="flex flex-col gap-2 text-[13px] text-[var(--color-ink-muted)]">
        <div>
          <span className={META_LABEL}>top suspect</span>{" "}
          <span className="font-mono text-[var(--color-accent)]">
            {result.topSuspect ?? "(none)"}
          </span>
        </div>
        <div>
          <span className={META_LABEL}>candidates</span> {result.candidates.length}
        </div>
        <div>
          <span className={META_LABEL}>conf</span>{" "}
          <span className="text-[var(--color-accent)]">
            {(result.confidence * 100).toFixed(0)}%
          </span>
        </div>
      </div>
    );
  }
  if (result.lane === "frequency-analyzer") {
    return (
      <div className="flex flex-col gap-2 text-[13px] text-[var(--color-ink-muted)]">
        <div>
          <span className={META_LABEL}>severity</span>{" "}
          <span className="font-mono text-[var(--color-accent)]">
            {result.severityClass.toUpperCase()}
          </span>
        </div>
        <div>
          <span className={META_LABEL}>occurrences</span> {result.totalOccurrences}
        </div>
        <div>
          <span className={META_LABEL}>affected users</span> {result.affectedUsers}
        </div>
        <div>
          <span className={META_LABEL}>spike</span>{" "}
          {result.spikeDetected ? "yes" : "no"}
        </div>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2 text-[13px] text-[var(--color-ink-muted)]">
      <div>
        <span className={META_LABEL}>steps</span> {result.reproSteps.length}
      </div>
      <div>
        <span className={META_LABEL}>env</span> {result.reproEnvironment}
      </div>
      <div>
        <span className={META_LABEL}>conf</span>{" "}
        <span className="text-[var(--color-accent)]">
          {(result.confidence * 100).toFixed(0)}%
        </span>
      </div>
      {result.knownGaps.length > 0 && (
        <div>
          <span className={META_LABEL}>gaps</span> {result.knownGaps.join("; ")}
        </div>
      )}
    </div>
  );
}
