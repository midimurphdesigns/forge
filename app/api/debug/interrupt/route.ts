import { requestLaneAbort, requestLaneAbortUpstash } from "@/lib/store";
import type { LaneName } from "@/lib/types";

export const runtime = "nodejs";

type InterruptBody = {
  sessionId: string;
  lane: LaneName;
};

export async function POST(req: Request): Promise<Response> {
  const { sessionId, lane } = (await req.json()) as InterruptBody;
  // Set both signals. On localhost the in-memory flag is what the
  // coordinator sees; on Vercel the interrupt POST and the running
  // coordinator are on different instances, so we also write to
  // Upstash and the coordinator polls it during the LLM call.
  requestLaneAbort(sessionId, lane);
  await requestLaneAbortUpstash(sessionId, lane);
  return Response.json({ ok: true });
}
