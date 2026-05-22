import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

export type RateLimitDecision = {
  allowed: boolean;
  remaining: number;
  reset: number;
  reason: "ok" | "rate-limited" | "daily-cap" | "owner-bypass" | "disabled";
};

const HAS_UPSTASH = Boolean(
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN,
);

const redis = HAS_UPSTASH ? Redis.fromEnv() : null;

const perIpLimiter = redis
  ? new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(15, "1 h"),
      analytics: true,
      prefix: "forge:rl:ip",
    })
  : null;

const DAILY_CAP_USD = Number(process.env.FORGE_DAILY_USD_CAP ?? "10");

function todayKey(): string {
  return `forge:cost:${new Date().toISOString().slice(0, 10)}`;
}

export async function recordSpend(usd: number): Promise<void> {
  if (!redis) return;
  await redis.incrbyfloat(todayKey(), usd);
  await redis.expire(todayKey(), 86400 * 2);
}

export async function checkRateLimit(
  ip: string,
  adminCookie: string | null,
): Promise<RateLimitDecision> {
  if (!HAS_UPSTASH) {
    return { allowed: true, remaining: -1, reset: 0, reason: "disabled" };
  }
  if (adminCookie && adminCookie === process.env.FORGE_ADMIN_KEY) {
    return { allowed: true, remaining: -1, reset: 0, reason: "owner-bypass" };
  }

  const todaySpendStr = redis ? await redis.get<string | number>(todayKey()) : null;
  const todaySpend = Number(todaySpendStr ?? 0);
  if (todaySpend >= DAILY_CAP_USD) {
    return { allowed: false, remaining: 0, reset: 0, reason: "daily-cap" };
  }

  if (!perIpLimiter) {
    return { allowed: true, remaining: -1, reset: 0, reason: "disabled" };
  }
  const result = await perIpLimiter.limit(ip);
  return {
    allowed: result.success,
    remaining: result.remaining,
    reset: result.reset,
    reason: result.success ? "ok" : "rate-limited",
  };
}
