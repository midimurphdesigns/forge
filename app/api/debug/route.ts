import { randomUUID } from "node:crypto";
import { getCalibration } from "@/lib/calibration";
import { runCoordinator, type ProgressEvent } from "@/lib/coordinator";
import { sessionStore } from "@/lib/store";
import type { DebugInput, LaneName, LaneResult } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 120;

type ResumeFrame =
  | { type: "session:resume"; sessionId: string }
  | { type: "lane:replay"; lane: LaneName; status: string; durationMs: number | null; result: LaneResult | null; error: string | null }
  | { type: "merge"; hypotheses: ReturnType<typeof emptyHypotheses>; totalDurationMs: number };

function emptyHypotheses(): Array<{
  title: string;
  description: string;
  supportingLanes: LaneName[];
  confidence: number;
}> {
  return [];
}

export async function POST(req: Request): Promise<Response> {
  const input = (await req.json()) as DebugInput;
  const sessionId = randomUUID();
  await sessionStore.create(sessionId);

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      const send = (event: ProgressEvent) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      };

      try {
        await runCoordinator(sessionId, input, send);
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ type: "fatal", reason })}\n\n`),
        );
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Forge-Session": sessionId,
    },
  });
}

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const sessionId = url.searchParams.get("sessionId");
  if (!sessionId) {
    return new Response("missing sessionId", { status: 400 });
  }

  const state = await sessionStore.get(sessionId);
  if (!state) {
    return new Response("session not found", { status: 404 });
  }

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      const send = (frame: ResumeFrame | { type: "fatal"; reason: string }) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(frame)}\n\n`));
      };

      send({ type: "session:resume", sessionId });

      for (const laneName of Object.keys(state.laneStatus) as LaneName[]) {
        send({
          type: "lane:replay",
          lane: laneName,
          status: state.laneStatus[laneName],
          durationMs: state.laneDurations[laneName] ?? null,
          result: state.laneResults[laneName] ?? null,
          error: state.laneErrors[laneName] ?? null,
        });
      }

      if (state.status === "complete" && state.totalDurationMs !== null) {
        const calibration = await getCalibration();
        controller.enqueue(
          new TextEncoder().encode(
            `data: ${JSON.stringify({
              type: "merge",
              hypotheses: state.hypotheses,
              totalDurationMs: state.totalDurationMs,
              speculatorMetrics: state.speculatorMetrics,
              calibration,
            })}\n\n`,
          ),
        );
      }

      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
