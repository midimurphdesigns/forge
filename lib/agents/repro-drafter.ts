import { anthropic } from "@ai-sdk/anthropic";
import { generateObject } from "ai";
import { z } from "zod";
import { extractUsage } from "@/lib/cost";
import { recordUsage } from "@/lib/store";
import type { DebugInput, ReproDrafterResult } from "@/lib/types";

const MODEL = "claude-sonnet-4-6";

const Schema = z.object({
  reproSteps: z.array(z.string()),
  reproCode: z.string().nullable(),
  reproEnvironment: z.string(),
  knownGaps: z.array(z.string()),
  confidence: z.number().min(0).max(1),
});

const SYSTEM = `You are repro-drafter, one of four debugging specialists. Your only job: draft a minimal local reproduction of the error from the stack trace alone.

Do NOT read the actual source code. Do NOT analyze frequency or blame. Other specialists handle those.

Be honest about what you cannot infer — populate knownGaps with the assumptions you had to make.`;

export async function runReproDrafter(
  input: DebugInput,
  sessionId?: string,
  signal?: AbortSignal,
): Promise<ReproDrafterResult> {
  const result = await generateObject({
    model: anthropic(MODEL),
    schema: Schema,
    messages: [
      {
        role: "system",
        content: SYSTEM,
        providerOptions: {
          anthropic: { cacheControl: { type: "ephemeral" } },
        },
      },
      {
        role: "user",
        content: `Stack trace:\n\n${input.stackTrace}\n\nDraft a minimal repro. Confidence reflects how reliably this repro would trigger the same error.`,
      },
    ],
    abortSignal: signal,
  });

  if (sessionId) {
    recordUsage(sessionId, extractUsage(result, "repro-drafter", MODEL));
  }

  return { lane: "repro-drafter", ...result.object };
}
