import { anthropic } from "@ai-sdk/anthropic";
import { generateObject, generateText, stepCountIs } from "ai";
import { z } from "zod";
import { buildGithubTools } from "@/lib/tools/github";
import type { BlameCorrelatorResult, DebugInput } from "@/lib/types";

const Schema = z.object({
  candidates: z.array(
    z.object({
      sha: z.string(),
      author: z.string(),
      date: z.string(),
      summary: z.string(),
      relevance: z.number().min(0).max(1),
      reasoning: z.string(),
    }),
  ),
  topSuspect: z.string().nullable(),
  confidence: z.number().min(0).max(1),
});

const SYSTEM = `You are blame-correlator, one of four debugging specialists. Your only job: find recent commits that could have caused the error and rank them by relevance.

Do NOT analyze the code's correctness in detail. Do NOT estimate user impact. Other specialists handle those. Stay focused on commit correlation.

Use git_log to find commits in a window around the error timestamp, git_diff to inspect candidates, and git_blame when you need to verify who touched a specific line.`;

export async function runBlameCorrelator(input: DebugInput): Promise<BlameCorrelatorResult> {
  const tools = buildGithubTools();

  const investigation = await generateText({
    model: anthropic("claude-sonnet-4-6"),
    system: SYSTEM,
    prompt: `Error timestamp: ${input.errorTimestamp}\nDeployed SHA: ${input.deployedSha}\nRepo: ${input.repoUrl}\nStack trace excerpt:\n\n${input.stackTrace.split("\n").slice(0, 6).join("\n")}\n\nFind suspect commits in the 48h preceding the error timestamp. Rank by relevance.`,
    tools: {
      git_log: tools.git_log,
      git_diff: tools.git_diff,
      git_blame: tools.git_blame,
    },
    stopWhen: stepCountIs(8),
  });

  const { object } = await generateObject({
    model: anthropic("claude-sonnet-4-6"),
    schema: Schema,
    system:
      "You are coercing blame-correlator's investigation into a structured result. Be faithful; do not invent commit SHAs that did not appear in the transcript.",
    prompt: `Investigation transcript:\n\n${investigation.text}\n\nProduce the structured BlameCorrelatorResult.`,
  });

  return { lane: "blame-correlator", ...object };
}
