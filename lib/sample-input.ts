import type { DebugInput } from "@/lib/types";

export const SAMPLE_INPUT: DebugInput = {
  stackTrace: `TypeError: Cannot read properties of null (reading 'user')
    at getSession (src/auth/session.ts:13:18)
    at handler (src/app/api/me/route.ts:8:24)
    at Object.eval (next/server/route-modules/app-route)
    at async wrapped (next/server/instrumentation)`,
  repoUrl: "midimurphdesigns/forge-demo",
  deployedSha: "a3f1c92",
  errorTimestamp: "2026-05-20T14:08:00Z",
  errorFingerprint: "e2d4f17",
};
