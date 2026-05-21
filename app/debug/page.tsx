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
    <main className="mx-auto flex min-h-screen max-w-5xl flex-col gap-8 p-8 font-mono">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold">forge / debug</h1>
        <p className="text-sm text-gray-500">
          parallel multi-agent investigation. resumable + per-lane interrupt.
        </p>
        {sessionId && (
          <p className="text-xs text-gray-500">
            session{" "}
            <span className="font-bold text-cyan-400">{sessionId.slice(0, 8)}</span>{" "}
            (refresh this page to resume)
          </p>
        )}
      </header>

      <section className="flex items-center gap-3">
        <button
          type="button"
          onClick={run}
          disabled={running}
          className="rounded bg-cyan-400 px-4 py-2 text-sm font-medium text-black disabled:opacity-50"
        >
          {running ? "investigating..." : "run sample investigation"}
        </button>
        {totalDurationMs !== null && (
          <span className="text-xs text-gray-500">wall-clock {totalDurationMs}ms</span>
        )}
        {speculatorMetrics && speculatorMetrics.predictions > 0 && (
          <span className="text-xs text-gray-500">
            speculator{" "}
            {speculatorMetrics.hits}/{speculatorMetrics.predictions} hit (
            {Math.round(
              (speculatorMetrics.hits / speculatorMetrics.predictions) * 100,
            )}
            %)
          </span>
        )}
      </section>

      <section className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {LANE_ORDER.map((laneName) => {
          const lane = lanes[laneName];
          const canInterrupt = lane.status === "running" && sessionId !== null;
          return (
            <article
              key={laneName}
              className="flex flex-col gap-2 rounded border border-gray-200 p-4 dark:border-gray-800"
            >
              <header className="flex items-baseline justify-between">
                <div>
                  <h2 className="text-sm font-bold">{laneName}</h2>
                  <p className="text-xs text-gray-500">{LANE_DESCRIPTIONS[laneName]}</p>
                </div>
                <div className="flex items-center gap-2">
                  <StatusBadge status={lane.status} durationMs={lane.durationMs} />
                  {canInterrupt && (
                    <button
                      type="button"
                      onClick={() => interrupt(laneName)}
                      className="text-[10px] uppercase text-red-400 underline underline-offset-2"
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
        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-bold">ranked hypotheses</h2>
          {hypotheses.map((h, i) => (
            <article
              key={i}
              className="rounded border border-cyan-400/40 bg-cyan-50/30 p-4 dark:bg-cyan-950/20"
            >
              <header className="flex items-baseline justify-between">
                <h3 className="text-sm font-bold">{h.title}</h3>
                <span className="text-xs text-gray-500">
                  conf {(h.confidence * 100).toFixed(0)}%
                </span>
              </header>
              <p className="mt-2 whitespace-pre-wrap text-xs text-gray-700 dark:text-gray-300">
                {h.description}
              </p>
              <footer className="mt-2 text-xs text-gray-500">
                supported by: {h.supportingLanes.join(", ")}
              </footer>
            </article>
          ))}
        </section>
      )}

      {fatal && (
        <section className="rounded border border-red-400 bg-red-50/30 p-4 dark:bg-red-950/20">
          <h2 className="text-sm font-bold text-red-700 dark:text-red-300">fatal</h2>
          <p className="text-xs text-red-700 dark:text-red-300">{fatal}</p>
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
      ? "text-cyan-400"
      : status === "running"
        ? "text-yellow-400"
        : status === "error"
          ? "text-red-400"
          : status === "aborted"
            ? "text-orange-400"
            : "text-gray-400";
  return (
    <span className={`text-xs uppercase ${color}`}>
      {status}
      {durationMs !== null && status !== "running" ? ` ${durationMs}ms` : ""}
    </span>
  );
}

function LaneBody({ lane }: { lane: LaneState }) {
  if (lane.status === "queued") {
    return <p className="text-xs text-gray-400">waiting...</p>;
  }
  if (lane.status === "running") {
    return <p className="text-xs text-gray-400">working...</p>;
  }
  if (lane.status === "error" || lane.status === "aborted") {
    return <p className="text-xs text-red-500">{lane.error ?? "no detail"}</p>;
  }
  if (lane.result) {
    return <ResultBody result={lane.result} />;
  }
  return null;
}

function ResultBody({ result }: { result: LaneResult }) {
  if (result.lane === "source-reader") {
    return (
      <div className="flex flex-col gap-1 text-xs">
        <div>
          <span className="text-gray-500">file:</span> {result.file}:
          {result.lineRange[0]}-{result.lineRange[1]}
        </div>
        <div>
          <span className="text-gray-500">conf:</span>{" "}
          {(result.confidence * 100).toFixed(0)}%
        </div>
        <pre className="mt-1 overflow-x-auto rounded bg-black/5 p-2 text-[10px] dark:bg-white/5">
          {result.snippet}
        </pre>
      </div>
    );
  }
  if (result.lane === "blame-correlator") {
    return (
      <div className="flex flex-col gap-1 text-xs">
        <div>
          <span className="text-gray-500">top suspect:</span>{" "}
          {result.topSuspect ?? "(none)"}
        </div>
        <div>
          <span className="text-gray-500">candidates:</span> {result.candidates.length}
        </div>
        <div>
          <span className="text-gray-500">conf:</span>{" "}
          {(result.confidence * 100).toFixed(0)}%
        </div>
      </div>
    );
  }
  if (result.lane === "frequency-analyzer") {
    return (
      <div className="flex flex-col gap-1 text-xs">
        <div>
          <span className="text-gray-500">severity:</span>{" "}
          {result.severityClass.toUpperCase()}
        </div>
        <div>
          <span className="text-gray-500">occurrences:</span> {result.totalOccurrences}
        </div>
        <div>
          <span className="text-gray-500">affected users:</span> {result.affectedUsers}
        </div>
        <div>
          <span className="text-gray-500">spike:</span>{" "}
          {result.spikeDetected ? "yes" : "no"}
        </div>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-1 text-xs">
      <div>
        <span className="text-gray-500">steps:</span> {result.reproSteps.length}
      </div>
      <div>
        <span className="text-gray-500">env:</span> {result.reproEnvironment}
      </div>
      <div>
        <span className="text-gray-500">conf:</span>{" "}
        {(result.confidence * 100).toFixed(0)}%
      </div>
      {result.knownGaps.length > 0 && (
        <div>
          <span className="text-gray-500">gaps:</span> {result.knownGaps.join("; ")}
        </div>
      )}
    </div>
  );
}
