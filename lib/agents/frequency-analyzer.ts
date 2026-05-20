import { anthropic } from "@ai-sdk/anthropic";
import { generateObject, generateText, stepCountIs } from "ai";
import { z } from "zod";
import {
  queryAffectedUsers,
  queryErrors,
  queryHourlyRate,
  queryRelatedErrors,
} from "@/lib/tools/errors";
import type { DebugInput, FrequencyAnalyzerResult } from "@/lib/types";

const Schema = z.object({
  totalOccurrences: z.number().int().nonnegative(),
  affectedUsers: z.number().int().nonnegative(),
  firstSeen: z.string(),
  spikeDetected: z.boolean(),
  ratePerHour: z.array(z.number().int().nonnegative()),
  relatedFingerprints: z.array(z.string()),
  severityClass: z.enum(["p0", "p1", "p2", "p3"]),
  confidence: z.number().min(0).max(1),
});

const SYSTEM = `You are frequency-analyzer, one of four debugging specialists. Your only job: quantify the blast radius — how often this error fires, how many users are hit, whether it is spiking, and how severe.

Do NOT read source code. Do NOT correlate commits. Other specialists handle those. Stay focused on the numbers.

Severity rubric:
- p0: >500 affected users OR spike >5x baseline
- p1: 100-500 users OR clear sustained spike
- p2: 10-100 users, no spike
- p3: <10 users`;

export async function runFrequencyAnalyzer(
  input: DebugInput,
): Promise<FrequencyAnalyzerResult> {
  const investigation = await generateText({
    model: anthropic("claude-sonnet-4-6"),
    system: SYSTEM,
    prompt: `Error fingerprint: ${input.errorFingerprint}\nFirst observed: ${input.errorTimestamp}\n\nQuery the error metrics, decide severity, return the structured report.`,
    tools: {
      query_errors: queryErrors,
      query_affected_users: queryAffectedUsers,
      query_hourly_rate: queryHourlyRate,
      query_related_errors: queryRelatedErrors,
    },
    stopWhen: stepCountIs(6),
  });

  const { object } = await generateObject({
    model: anthropic("claude-sonnet-4-6"),
    schema: Schema,
    system:
      "You are coercing frequency-analyzer's investigation into a structured result. Be faithful to the numbers in the transcript.",
    prompt: `Investigation transcript:\n\n${investigation.text}\n\nProduce the structured FrequencyAnalyzerResult.`,
  });

  return { lane: "frequency-analyzer", ...object };
}
