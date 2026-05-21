import { requestLaneAbort, sessionStore } from "@/lib/store";
import type { LaneName } from "@/lib/types";

export const runtime = "nodejs";

type InterruptBody = {
  sessionId: string;
  lane: LaneName;
};

export async function POST(req: Request): Promise<Response> {
  const { sessionId, lane } = (await req.json()) as InterruptBody;
  const state = await sessionStore.get(sessionId);
  if (!state) {
    return Response.json({ error: "session not found" }, { status: 404 });
  }
  requestLaneAbort(sessionId, lane);
  return Response.json({ ok: true });
}
