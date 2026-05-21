import type { LaneName } from "@/lib/types";

export type UsageSample = {
  lane: LaneName | "coercion";
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
};

export type LaneCostBreakdown = {
  lane: LaneName | "coercion";
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  inputUsd: number;
  outputUsd: number;
  cacheReadUsd: number;
  cacheCreationUsd: number;
  totalUsd: number;
  cacheHitRate: number;
};

export type CostSummary = {
  perLane: LaneCostBreakdown[];
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheReadTokens: number;
  totalCacheCreationTokens: number;
  totalUsd: number;
  cacheHitRate: number;
};

/**
 * Anthropic Claude Sonnet 4.6 pricing (per million tokens, USD).
 * Source: anthropic.com/pricing. Cache reads are ~10x cheaper than fresh
 * inputs; cache writes are ~1.25x the fresh input price.
 */
const PRICING: Record<string, {
  input: number;
  output: number;
  cacheRead: number;
  cacheCreation: number;
}> = {
  "claude-sonnet-4-6": {
    input: 3.0,
    output: 15.0,
    cacheRead: 0.3,
    cacheCreation: 3.75,
  },
  "claude-opus-4-7": {
    input: 15.0,
    output: 75.0,
    cacheRead: 1.5,
    cacheCreation: 18.75,
  },
};

function priceFor(model: string) {
  return PRICING[model] ?? PRICING["claude-sonnet-4-6"];
}

export function tokensToUsd(model: string, sample: UsageSample): {
  inputUsd: number;
  outputUsd: number;
  cacheReadUsd: number;
  cacheCreationUsd: number;
} {
  const p = priceFor(model);
  return {
    inputUsd: (sample.inputTokens * p.input) / 1_000_000,
    outputUsd: (sample.outputTokens * p.output) / 1_000_000,
    cacheReadUsd: (sample.cacheReadTokens * p.cacheRead) / 1_000_000,
    cacheCreationUsd: (sample.cacheCreationTokens * p.cacheCreation) / 1_000_000,
  };
}

export class CostAccumulator {
  private samples: UsageSample[] = [];

  record(sample: UsageSample): void {
    this.samples.push(sample);
  }

  summarize(): CostSummary {
    const byLane = new Map<string, LaneCostBreakdown>();
    for (const s of this.samples) {
      const key = s.lane;
      const prior =
        byLane.get(key) ??
        ({
          lane: s.lane,
          inputTokens: 0,
          outputTokens: 0,
          cacheReadTokens: 0,
          cacheCreationTokens: 0,
          inputUsd: 0,
          outputUsd: 0,
          cacheReadUsd: 0,
          cacheCreationUsd: 0,
          totalUsd: 0,
          cacheHitRate: 0,
        } satisfies LaneCostBreakdown);
      const usd = tokensToUsd(s.model, s);
      const merged: LaneCostBreakdown = {
        lane: s.lane,
        inputTokens: prior.inputTokens + s.inputTokens,
        outputTokens: prior.outputTokens + s.outputTokens,
        cacheReadTokens: prior.cacheReadTokens + s.cacheReadTokens,
        cacheCreationTokens: prior.cacheCreationTokens + s.cacheCreationTokens,
        inputUsd: prior.inputUsd + usd.inputUsd,
        outputUsd: prior.outputUsd + usd.outputUsd,
        cacheReadUsd: prior.cacheReadUsd + usd.cacheReadUsd,
        cacheCreationUsd: prior.cacheCreationUsd + usd.cacheCreationUsd,
        totalUsd:
          prior.totalUsd +
          usd.inputUsd +
          usd.outputUsd +
          usd.cacheReadUsd +
          usd.cacheCreationUsd,
        cacheHitRate: 0,
      };
      const cacheableInput =
        merged.inputTokens + merged.cacheReadTokens + merged.cacheCreationTokens;
      merged.cacheHitRate =
        cacheableInput > 0 ? merged.cacheReadTokens / cacheableInput : 0;
      byLane.set(key, merged);
    }

    const perLane = Array.from(byLane.values());
    const totals = perLane.reduce(
      (acc, l) => ({
        totalInputTokens: acc.totalInputTokens + l.inputTokens,
        totalOutputTokens: acc.totalOutputTokens + l.outputTokens,
        totalCacheReadTokens: acc.totalCacheReadTokens + l.cacheReadTokens,
        totalCacheCreationTokens:
          acc.totalCacheCreationTokens + l.cacheCreationTokens,
        totalUsd: acc.totalUsd + l.totalUsd,
      }),
      {
        totalInputTokens: 0,
        totalOutputTokens: 0,
        totalCacheReadTokens: 0,
        totalCacheCreationTokens: 0,
        totalUsd: 0,
      },
    );
    const cacheable =
      totals.totalInputTokens +
      totals.totalCacheReadTokens +
      totals.totalCacheCreationTokens;
    const cacheHitRate = cacheable > 0 ? totals.totalCacheReadTokens / cacheable : 0;

    return {
      perLane,
      ...totals,
      cacheHitRate,
    };
  }
}

/**
 * Best-effort extraction of usage fields from an AI SDK 6 result. Anthropic
 * exposes inputTokens, outputTokens, cachedInputTokens (for cache reads).
 * Cache creation tokens come via a provider-metadata field. Fall back to 0
 * when fields are absent (different providers, different SDK versions).
 */
export function extractUsage(
  raw: unknown,
  lane: LaneName | "coercion",
  model: string,
): UsageSample {
  const result = raw as {
    usage?: {
      inputTokens?: number;
      outputTokens?: number;
      cachedInputTokens?: number;
      cacheCreationInputTokens?: number;
    };
    providerMetadata?: {
      anthropic?: {
        cacheCreationInputTokens?: number;
        cacheReadInputTokens?: number;
      };
    };
  };
  const usage = result.usage ?? {};
  const meta = result.providerMetadata?.anthropic ?? {};
  return {
    lane,
    model,
    inputTokens: usage.inputTokens ?? 0,
    outputTokens: usage.outputTokens ?? 0,
    cacheReadTokens:
      usage.cachedInputTokens ?? meta.cacheReadInputTokens ?? 0,
    cacheCreationTokens:
      usage.cacheCreationInputTokens ?? meta.cacheCreationInputTokens ?? 0,
  };
}
