import type { DebugInput } from "@/lib/types";

export type Scenario = {
  id: string;
  description: string;
  input: DebugInput;
  groundTruth: {
    file: string;
    lineRange: [number, number];
    topSuspectSha: string;
    severityClass: "p0" | "p1" | "p2" | "p3";
    reproExpected: boolean;
  };
  fixtureFiles: Record<string, string>;
};

export const SCENARIOS: Scenario[] = [
  {
    id: "auth-null-session",
    description: "Null session deref after migration removed null guard",
    input: {
      stackTrace: `TypeError: Cannot read properties of null (reading 'user')
    at getSession (src/auth/session.ts:13:18)
    at handler (src/app/api/me/route.ts:8:24)`,
      repoUrl: "midimurphdesigns/forge-demo",
      deployedSha: "a3f1c92",
      errorTimestamp: "2026-05-20T14:08:00Z",
      errorFingerprint: "e2d4f17",
    },
    groundTruth: {
      file: "src/auth/session.ts",
      lineRange: [11, 14],
      topSuspectSha: "a3f1c92",
      severityClass: "p1",
      reproExpected: true,
    },
    fixtureFiles: {
      "src/auth/session.ts": `import { cookies } from "next/headers";
import { db } from "@/lib/db";

export async function getSession() {
  const token = (await cookies()).get("session")?.value;
  if (!token) return null;
  const session = await db.session.findUnique({ where: { token } });
  return session.user;
}`,
    },
  },
  {
    id: "checkout-undefined-price",
    description: "Undefined price field crash after price service refactor",
    input: {
      stackTrace: `TypeError: Cannot read properties of undefined (reading 'cents')
    at formatPrice (src/lib/checkout.ts:42:31)
    at CheckoutCard (src/components/CheckoutCard.tsx:18:15)`,
      repoUrl: "midimurphdesigns/forge-demo",
      deployedSha: "b8f203e",
      errorTimestamp: "2026-05-20T16:33:00Z",
      errorFingerprint: "c91a4d2",
    },
    groundTruth: {
      file: "src/lib/checkout.ts",
      lineRange: [40, 45],
      topSuspectSha: "b8f203e",
      severityClass: "p0",
      reproExpected: true,
    },
    fixtureFiles: {
      "src/lib/checkout.ts": `import { getPrice } from "@/lib/pricing";

export function formatPrice(productId: string, locale: string) {
  const price = getPrice(productId);
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: "USD",
  }).format(price.cents / 100);
}`,
    },
  },
  {
    id: "rate-limit-loop",
    description: "Infinite retry loop after rate-limit threshold removed",
    input: {
      stackTrace: `Error: Maximum call stack size exceeded
    at retryWithBackoff (src/lib/http.ts:67:9)
    at retryWithBackoff (src/lib/http.ts:67:9)`,
      repoUrl: "midimurphdesigns/forge-demo",
      deployedSha: "c41a82f",
      errorTimestamp: "2026-05-20T18:12:00Z",
      errorFingerprint: "d72b8e1",
    },
    groundTruth: {
      file: "src/lib/http.ts",
      lineRange: [60, 75],
      topSuspectSha: "c41a82f",
      severityClass: "p2",
      reproExpected: true,
    },
    fixtureFiles: {
      "src/lib/http.ts": `export async function retryWithBackoff(fn: () => Promise<unknown>) {
  let attempt = 0;
  while (true) {
    try {
      return await fn();
    } catch (err) {
      attempt++;
      await new Promise((r) => setTimeout(r, 100 * attempt));
      return retryWithBackoff(fn);
    }
  }
}`,
    },
  },
  {
    id: "cron-missed-schedule",
    description: "Cron job misses schedule due to off-by-one in cron expression",
    input: {
      stackTrace: `Error: cron expression did not match scheduled time
    at validateSchedule (src/jobs/scheduler.ts:28:11)`,
      repoUrl: "midimurphdesigns/forge-demo",
      deployedSha: "d72ef91",
      errorTimestamp: "2026-05-20T20:00:00Z",
      errorFingerprint: "e83a7b9",
    },
    groundTruth: {
      file: "src/jobs/scheduler.ts",
      lineRange: [25, 32],
      topSuspectSha: "d72ef91",
      severityClass: "p3",
      reproExpected: false,
    },
    fixtureFiles: {
      "src/jobs/scheduler.ts": `import { CronExpressionParser } from "cron-parser";

export function validateSchedule(expr: string) {
  const parsed = CronExpressionParser.parse(expr);
  const next = parsed.next().toDate();
  const now = new Date();
  if (next.getHours() === now.getHours() + 1) {
    throw new Error("cron expression did not match scheduled time");
  }
}`,
    },
  },
  {
    id: "webhook-replay",
    description: "Webhook replay causes duplicate charge due to missing idempotency",
    input: {
      stackTrace: `Error: duplicate charge for intent pi_abc123
    at processWebhook (src/api/webhooks/stripe.ts:54:13)
    at handler (src/app/api/webhooks/stripe/route.ts:11:20)`,
      repoUrl: "midimurphdesigns/forge-demo",
      deployedSha: "f93c01a",
      errorTimestamp: "2026-05-20T22:45:00Z",
      errorFingerprint: "f94c128",
    },
    groundTruth: {
      file: "src/api/webhooks/stripe.ts",
      lineRange: [48, 60],
      topSuspectSha: "f93c01a",
      severityClass: "p0",
      reproExpected: true,
    },
    fixtureFiles: {
      "src/api/webhooks/stripe.ts": `import { stripe } from "@/lib/stripe";
import { db } from "@/lib/db";

export async function processWebhook(event: { id: string; data: unknown }) {
  const intent = (event.data as { object: { id: string } }).object;
  const existing = await db.charge.findUnique({ where: { intentId: intent.id } });
  await db.charge.create({
    data: { intentId: intent.id, status: "succeeded" },
  });
  if (existing) {
    throw new Error(\`duplicate charge for intent \${intent.id}\`);
  }
}`,
    },
  },
];

export function findScenario(fingerprint: string): Scenario | undefined {
  return SCENARIOS.find((s) => s.input.errorFingerprint === fingerprint);
}
