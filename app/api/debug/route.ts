import { randomUUID } from "node:crypto";
import { getCalibration } from "@/lib/calibration";
import { runCoordinator, type ProgressEvent } from "@/lib/coordinator";
import { checkRateLimit, recordSpend } from "@/lib/rateLimit";
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
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    "anonymous";
  const adminCookie = req.headers
    .get("cookie")
    ?.split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith("forge_admin="))
    ?.slice("forge_admin=".length) ?? null;

  const decision = await checkRateLimit(ip, adminCookie);
  if (!decision.allowed) {
    return Response.json(
      { error: decision.reason },
      {
        status: 429,
        headers: {
          "X-RateLimit-Remaining": String(decision.remaining),
          "X-RateLimit-Reset": String(decision.reset),
        },
      },
    );
  }

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
        const result = await runCoordinator(sessionId, input, send);
        const totalUsd = result.outcomes
          .filter((o) => o.status === "fulfilled")
          .reduce((s) => s, 0);
        const finalState = await sessionStore.get(sessionId);
        if (finalState?.cost) {
          await recordSpend(finalState.cost.totalUsd);
        }
        void totalUsd;
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
              cost: state.cost,
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
