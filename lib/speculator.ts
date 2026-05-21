type CacheKey = string;

type CacheEntry = {
  promise: Promise<unknown>;
  createdAt: number;
};

export type SpeculatorMetrics = {
  predictions: number;
  hits: number;
  misses: number;
  inFlight: number;
};

type PredictionRule = {
  trigger: { tool: string; args: Record<string, unknown> };
  predict: Array<{ tool: string; args: Record<string, unknown> }>;
};

export class Speculator {
  private cache = new Map<CacheKey, CacheEntry>();
  private metrics: SpeculatorMetrics = {
    predictions: 0,
    hits: 0,
    misses: 0,
    inFlight: 0,
  };
  private executors = new Map<string, (args: Record<string, unknown>) => Promise<unknown>>();
  private rules: PredictionRule[] = [];

  registerExecutor(tool: string, executor: (args: Record<string, unknown>) => Promise<unknown>) {
    this.executors.set(tool, executor);
  }

  registerRule(rule: PredictionRule) {
    this.rules.push(rule);
  }

  /**
   * Called when a real tool call resolves. Checks the cache for a hit. If hit,
   * returns the cached promise; if miss, executes fresh.
   */
  async consume(tool: string, args: Record<string, unknown>): Promise<unknown> {
    const key = cacheKey(tool, args);
    const cached = this.cache.get(key);
    if (cached) {
      this.cache.delete(key);
      this.metrics.hits++;
      return cached.promise;
    }

    const executor = this.executors.get(tool);
    if (!executor) {
      throw new Error(`no executor registered for ${tool}`);
    }
    this.metrics.misses++;
    return executor(args);
  }

  /**
   * Called after a real tool call resolves. Looks at the call shape, finds
   * matching prediction rules, and fires the predicted next calls in the
   * background so their results land in the cache.
   */
  speculate(tool: string, args: Record<string, unknown>): void {
    for (const rule of this.rules) {
      if (rule.trigger.tool !== tool) continue;
      if (!argsMatch(rule.trigger.args, args)) continue;

      for (const next of rule.predict) {
        const key = cacheKey(next.tool, next.args);
        if (this.cache.has(key)) continue;

        const executor = this.executors.get(next.tool);
        if (!executor) continue;

        this.metrics.predictions++;
        this.metrics.inFlight++;
        const promise = executor(next.args)
          .catch((err: unknown) => ({ __speculationError: String(err) }))
          .finally(() => {
            this.metrics.inFlight--;
          });
        this.cache.set(key, { promise, createdAt: Date.now() });
      }
    }
  }

  getMetrics(): SpeculatorMetrics {
    return { ...this.metrics };
  }

  clear(): void {
    this.cache.clear();
  }
}

function cacheKey(tool: string, args: Record<string, unknown>): CacheKey {
  return `${tool}:${stableStringify(args)}`;
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(",")}}`;
}

function argsMatch(
  pattern: Record<string, unknown>,
  actual: Record<string, unknown>,
): boolean {
  for (const k of Object.keys(pattern)) {
    if (pattern[k] === "*") continue;
    if (pattern[k] !== actual[k]) return false;
  }
  return true;
}
