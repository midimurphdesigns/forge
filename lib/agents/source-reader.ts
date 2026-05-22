import { anthropic } from "@ai-sdk/anthropic";
import { generateObject, generateText, stepCountIs } from "ai";
import { z } from "zod";
import { extractUsage } from "@/lib/cost";
import { Speculator } from "@/lib/speculator";
import { recordUsage, sessionStore } from "@/lib/store";
import { buildGithubTools } from "@/lib/tools/github";
import type { DebugInput, SourceReaderResult } from "@/lib/types";

const MODEL = "claude-sonnet-4-6";

const Schema = z.object({
  file: z.string(),
  lineRangeStart: z.number().int(),
  lineRangeEnd: z.number().int(),
  snippet: z.string(),
  surroundingContext: z.string(),
  confidence: z.number().min(0).max(1),
  reasoning: z.string(),
});

const SYSTEM = `You are source-reader, one of four debugging specialists. Your only job: identify the implicated source file(s) from a stack trace and read the code at the relevant lines.

Do NOT speculate about blame, frequency, or repro steps. Other specialists handle those. Stay focused on reading code accurately.

When you call fetch_file or fetch_directory, use the repo's deployed SHA as ref.

After gathering enough context, produce your final answer.`;

export async function runSourceReader(
  input: DebugInput,
  sessionId?: string,
  signal?: AbortSignal,
): Promise<SourceReaderResult> {
  const speculator = new Speculator();

  speculator.registerRule({
    trigger: { tool: "fetch_directory", args: { path: "src/auth" } },
    predict: [
      {
        tool: "fetch_file",
        args: { path: "src/auth/session.ts", ref: input.deployedSha },
      },
    ],
  });

  const tools = buildGithubTools(speculator);

  const investigation = await generateText({
    model: anthropic(MODEL),
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
        content: `Stack trace:\n\n${input.stackTrace}\n\nRepo: ${input.repoUrl}\nDeployed SHA: ${input.deployedSha}\n\nIdentify the file and line range most likely responsible. Read the code, capture the snippet and surrounding context.`,
      },
    ],
    tools: {
      fetch_file: tools.fetch_file,
      fetch_directory: tools.fetch_directory,
    },
    stopWhen: stepCountIs(6),
    abortSignal: signal,
  });

  if (sessionId) {
    recordUsage(sessionId, extractUsage(investigation, "source-reader", MODEL));
  }

  const coercion = await generateObject({
    model: anthropic(MODEL),
    schema: Schema,
    system:
      "You are coercing source-reader's investigation into a structured result. Be faithful to the investigation; do not invent details.",
    prompt: `Investigation transcript:\n\n${investigation.text}\n\nProduce the structured SourceReaderResult.`,
    abortSignal: signal,
  });

  if (sessionId) {
    recordUsage(sessionId, extractUsage(coercion, "coercion", MODEL));
  }

  if (sessionId) {
    const m = speculator.getMetrics();
    await sessionStore.patch(sessionId, (s) => ({
      ...s,
      speculatorMetrics: {
        ...(s.speculatorMetrics ?? { predictions: 0, hits: 0, misses: 0, inFlight: 0 }),
        predictions: (s.speculatorMetrics?.predictions ?? 0) + m.predictions,
        hits: (s.speculatorMetrics?.hits ?? 0) + m.hits,
        misses: (s.speculatorMetrics?.misses ?? 0) + m.misses,
        inFlight: m.inFlight,
      },
    }));
  }

  const { lineRangeStart, lineRangeEnd, ...rest } = coercion.object;
  return {
    lane: "source-reader",
    ...rest,
    lineRange: [lineRangeStart, lineRangeEnd] as [number, number],
  };
}
