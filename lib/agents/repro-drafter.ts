import { anthropic } from "@ai-sdk/anthropic";
import { generateObject } from "ai";
import { z } from "zod";
import type { DebugInput, ReproDrafterResult } from "@/lib/types";

const Schema = z.object({
  reproSteps: z.array(z.string()),
  reproCode: z.string().nullable(),
  reproEnvironment: z.string(),
  knownGaps: z.array(z.string()),
  confidence: z.number().min(0).max(1),
});

export async function runReproDrafter(input: DebugInput): Promise<ReproDrafterResult> {
  const { object } = await generateObject({
    model: anthropic("claude-sonnet-4-6"),
    schema: Schema,
    system: `You are repro-drafter, one of four debugging specialists. Your only job: draft a minimal local reproduction of the error from the stack trace alone.

Do NOT read the actual source code. Do NOT analyze frequency or blame. Other specialists handle those.

Be honest about what you cannot infer — populate knownGaps with the assumptions you had to make.`,
    prompt: `Stack trace:\n\n${input.stackTrace}\n\nDraft a minimal repro. Confidence reflects how reliably this repro would trigger the same error.`,
  });

  return { lane: "repro-drafter", ...object };
}
