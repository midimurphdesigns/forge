# forge

Multi-agent debugging concierge. Point it at a stack trace, it spawns four specialist subagents in parallel and ranks hypotheses by confidence.

Built on Vercel AI SDK 6 + Anthropic. Demonstrates parallel tool use, resumable streams, per-lane interrupt, speculative tool-input prefetch, Brier-score confidence calibration, prompt caching, and a graded eval harness.

## Architecture

- **Coordinator** (`lib/coordinator.ts`): bounded fan-out via `pLimit(4)` over `Promise.all`. Each lane catches its own errors and returns a typed `LaneOutcome` discriminated union, so the outer promise never rejects.
- **Four subagents** (`lib/agents/*.ts`): source-reader, blame-correlator, frequency-analyzer, repro-drafter. Each uses `generateText` (with tools) then `generateObject` (with schema) — two-pass pattern for reliable structured output from a tool-using loop.
- **Session store** (`lib/store.ts`): in-memory `Map<sessionId, SessionState>` with `globalThis` persistence across HMR reloads. Production swap to Upstash KV is one file.
- **SSE streaming** (`app/api/debug/route.ts`): POST kicks off an investigation and pipes lane:start / lane:done / lane:error / merge events. GET resumes by session id — replays buffered state to a refreshed tab.
- **Per-lane interrupt** (`app/api/debug/interrupt/route.ts`): POST sets an abort flag the coordinator polls at lane-task boundaries. Cooperative, not preemptive.
- **Speculator** (`lib/speculator.ts`): pre-fires likely next tool calls in the background while the LLM is reasoning. Tracks predictions / hits / misses.
- **Calibration** (`lib/calibration.ts`): per-lane Brier-score log. Weights are derived from `meanOutcome / meanPredicted`, clamped to [0.5, 1.5] to prevent overshoot. Applied at merge time.
- **Cost dashboard** (`lib/cost.ts`): per-call token usage captured, mapped to USD via per-model pricing including the 10% cache-read discount and 1.25x cache-write surcharge.
- **Eval harness** (`scripts/eval.ts`, `lib/eval/*.ts`): 5 reproducible scenarios with graded rubrics (file match, line-range IoU, top-suspect match, severity exact). N-runs aggregation produces mean + stddev so prompt tweaks can be evaluated for statistical significance.

## Local development

```sh
pnpm install
cp .env.example .env.local
# fill in ANTHROPIC_API_KEY at minimum
pnpm dev          # opens on :3000
```

Then visit `/` and click "run sample investigation." The page header documents
the input shape, the four lanes, and the concepts demonstrated.

## Eval runs

```sh
pnpm eval --dry-run                              # lists scenarios, no LLM calls
pnpm eval --scenario=auth-null-session --runs=3  # single scenario, 3 runs
pnpm eval --runs=3                               # full sweep (5 scenarios × 3 runs)
```

Snapshots written to `.forge/evals/<timestamp>.json` (gitignored). Calibration log accumulates in `.forge/calibration.jsonl`.

## Production deploy (Vercel)

The in-memory session store works on a single Node process. Vercel's serverless runtime runs many short-lived processes, so the in-memory store is **insufficient for production**. The Upstash adapter is wired for rate-limiting; full session-store-on-Upstash is a follow-up. Without Upstash env vars set, rate-limiting is silently disabled.

### Founder action steps

1. Create the Vercel project and attach `forge.kevinmurphywebdev.com`:
   - In Vercel: New Project → import from `midimurphdesigns/forge`
   - Domains tab → add `forge.kevinmurphywebdev.com`
   - DNS: CNAME `forge` → `cname.vercel-dns.com`
2. Create an Upstash Redis database:
   - Console → New Redis → Global, eviction enabled
   - Copy `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`
3. Set Vercel env vars (Production scope):
   - `ANTHROPIC_API_KEY` — required
   - `UPSTASH_REDIS_REST_URL` — required for rate-limit + daily cap
   - `UPSTASH_REDIS_REST_TOKEN` — required
   - `FORGE_ADMIN_KEY` — long random string; set as `forge_admin` cookie locally to bypass rate-limit
   - `FORGE_DAILY_USD_CAP` — defaults to 10
   - `GITHUB_TOKEN` — for future real-GitHub adapter (not used yet, fixtures only)
   - `SENTRY_AUTH_TOKEN` — for future real-Sentry adapter (not used yet)
4. Deploy.

### Guardrails

- **Rate limit**: 15 requests / hour per IP (sliding window).
- **Daily cap**: aggregate USD spend per UTC day; new investigations 429 once cap is reached.
- **Owner bypass**: `forge_admin=<FORGE_ADMIN_KEY>` cookie skips both checks.
- **Without Upstash**: guardrails are silently disabled. Don't deploy to production without Upstash.

## What's intentionally not done

- **GitHub / Sentry adapters are fixtures.** `lib/tools/github.ts` and `lib/tools/errors.ts` return canned data shaped like real responses. Wiring real APIs is a separate phase.
- **Session store still in-memory.** Production swap is `lib/store.ts` — replace `InMemoryStore` with an Upstash-backed impl; the `SessionStore` interface is shaped for this. Rate-limiting already uses Upstash; sessions don't yet.
- **AbortSignal is not plumbed into `generateText`.** Per-lane interrupt today is cooperative (checked at lane boundaries). True mid-stream cancellation needs `abortSignal` threaded through.
- **20 eval scenarios planned, 5 shipped.** The remaining 15 are a follow-up — five is enough to validate the rubric design and the n-runs aggregation; more scenarios are linear additions.

## Reading order

If you're new to this codebase:

1. `docs/AGENTS.md` — design contract for the subagent graph
2. `lib/types.ts` — the data model
3. `lib/agents/source-reader.ts` — simplest subagent
4. `lib/coordinator.ts` — the orchestration
5. `lib/store.ts` — persistence layer
6. `app/api/debug/route.ts` — the HTTP surface
7. `app/page.tsx` — the client

That sequence introduces concepts in order: data model → one agent → the fan-out → persistence → transport → UI.
