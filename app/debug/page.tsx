"use client";

import { useState } from "react";
import { SAMPLE_INPUT } from "@/lib/sample-input";
import type { Hypothesis, LaneName, LaneResult } from "@/lib/types";

type LaneStatus = "queued" | "running" | "done" | "error";

type LaneState = {
  status: LaneStatus;
  durationMs: number | null;
  result: LaneResult | null;
  error: string | null;
};

type ProgressEvent =
  | { type: "lane:start"; lane: LaneName }
  | { type: "lane:done"; lane: LaneName; durationMs: number; result: LaneResult }
  | { type: "lane:error"; lane: LaneName; durationMs: number; reason: string }
  | { type: "merge"; hypotheses: Hypothesis[]; totalDurationMs: number }
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
  const [running, setRunning] = useState(false);
  const [fatal, setFatal] = useState<string | null>(null);

  const run = async () => {
    setLanes(INITIAL_STATE);
    setHypotheses([]);
    setTotalDurationMs(null);
    setFatal(null);
    setRunning(true);

    try {
      const res = await fetch("/api/debug", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(SAMPLE_INPUT),
      });

      if (!res.ok || !res.body) {
        setFatal(`request failed: ${res.status} ${res.statusText}`);
        setRunning(false);
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

        for (const frame of frames) {
          if (!frame.startsWith("data: ")) continue;
          const json = frame.slice(6).trim();
          if (!json) continue;
          handleEvent(JSON.parse(json) as ProgressEvent);
        }
      }
    } catch (err) {
      setFatal(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(false);
    }
  };

  const handleEvent = (event: ProgressEvent) => {
    if (event.type === "lane:start") {
      setLanes((prev) => ({
        ...prev,
        [event.lane]: { ...prev[event.lane], status: "running" },
      }));
    } else if (event.type === "lane:done") {
      setLanes((prev) => ({
        ...prev,
        [event.lane]: {
          status: "done",
          durationMs: event.durationMs,
          result: event.result,
          error: null,
        },
      }));
    } else if (event.type === "lane:error") {
      setLanes((prev) => ({
        ...prev,
        [event.lane]: {
          status: "error",
          durationMs: event.durationMs,
          result: null,
          error: event.reason,
        },
      }));
    } else if (event.type === "merge") {
      setHypotheses(event.hypotheses);
      setTotalDurationMs(event.totalDurationMs);
    } else if (event.type === "fatal") {
      setFatal(event.reason);
    }
  };

  return (
    <main className="mx-auto flex min-h-screen max-w-5xl flex-col gap-8 p-8 font-mono">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold">forge / debug</h1>
        <p className="text-sm text-gray-500">
          parallel multi-agent investigation. four specialists fan out, coordinator ranks
          hypotheses.
        </p>
      </header>

      <section>
        <button
          type="button"
          onClick={run}
          disabled={running}
          className="rounded bg-cyan-400 px-4 py-2 text-sm font-medium text-black disabled:opacity-50"
        >
          {running ? "investigating..." : "run sample investigation"}
        </button>
        {totalDurationMs !== null && (
          <span className="ml-3 text-xs text-gray-500">
            wall-clock {totalDurationMs}ms
          </span>
        )}
      </section>

      <section className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {LANE_ORDER.map((laneName) => {
          const lane = lanes[laneName];
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
                <StatusBadge status={lane.status} durationMs={lane.durationMs} />
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
  if (lane.status === "error") {
    return <p className="text-xs text-red-500">{lane.error}</p>;
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
  // repro-drafter
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
