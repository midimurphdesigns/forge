# Agents — forge

This is the design contract for forge's agent graph. Read this before reading the code. Re-read it before any interview where forge comes up.

## The problem

A user pastes a stack trace, a Sentry issue URL, or a raw error log into forge. They want to know:

1. **Where in the code did this break?** (file + line range)
2. **When did it start breaking?** (correlate to recent commits)
3. **How bad is it?** (frequency, affected users, surface area)
4. **How do I reproduce it?** (minimal repro the user can run locally)

A naive LLM agent does this with one giant prompt: "here's a stack trace, figure it all out." That fails because the model has to context-switch between four reasoning modes, the prompt gets bloated with all the source files / commit log / metrics it might need, and the output is one monolithic hypothesis that's hard to grade.

forge's design: **specialize**. Four subagents, each with a tight system prompt, a focused tool set, and one job. A coordinator agent fans them out in parallel, merges their results, and ranks hypotheses.

## The four subagents

### 1. source-reader

**Job:** Given a stack trace, identify the relevant source file(s) and read the implicated code.

**Inputs:** stack trace (raw text), repo URL (owner/name), commit SHA (the deployed version at error time).

**Tools:**
- `fetch_file(path, ref)` — pull a file from GitHub at a specific commit
- `fetch_directory(path, ref)` — list contents of a directory (for resolving relative imports)

**Output (structured):**
```ts
{
  file: string;          // e.g. "src/auth/session.ts"
  lineRange: [number, number];  // [142, 178]
  snippet: string;       // the actual code at those lines
  surroundingContext: string;   // imports + nearby functions
  confidence: number;    // 0-1, how sure it is this is the right file
  reasoning: string;     // one-paragraph explanation
}
```

**Why isolated:** reading code is a focused task. If you mixed this with "also figure out who touched it recently," the model would start reasoning about authorship and stop reading carefully.

---

### 2. blame-correlator

**Job:** Given the stack trace and the time the error first occurred, find recent commits that could have caused it.

**Inputs:** stack trace, repo URL, error timestamp, deployed commit SHA.

**Tools:**
- `git_log(path, since, until)` — commits touching a path in a time window
- `git_diff(sha)` — diff for a single commit
- `git_blame(path, line)` — who last touched a specific line

**Output (structured):**
```ts
{
  candidates: Array<{
    sha: string;
    author: string;
    date: string;
    summary: string;       // commit subject
    relevance: number;     // 0-1
    reasoning: string;     // why this commit might be the cause
  }>;
  topSuspect: string | null;  // sha of most-likely cause
  confidence: number;
}
```

**Why isolated:** correlation is statistical reasoning. The model needs to weigh "this commit touched the file in question 2 hours before the error" vs "this commit is unrelated but landed same day." Mixing this with source-reading would dilute the prior probability calculations.

---

### 3. frequency-analyzer

**Job:** Quantify the blast radius. How often does this error fire, how many users hit it, is it spiking?

**Inputs:** error fingerprint (a hash of the stack trace's stable parts), time window.

**Tools:**
- `query_errors(fingerprint, since, until)` — error occurrences over time
- `query_affected_users(fingerprint, since, until)` — distinct users hitting it
- `query_related_errors(fingerprint)` — errors with similar fingerprints (might be variants of the same bug)

**Output (structured):**
```ts
{
  totalOccurrences: number;
  affectedUsers: number;
  firstSeen: string;       // ISO timestamp
  spikeDetected: boolean;
  ratePerHour: number[];   // last 24h, hourly buckets
  relatedFingerprints: string[];
  severityClass: "p0" | "p1" | "p2" | "p3";
  confidence: number;
}
```

**Why isolated:** this is a data-analysis task. The model is essentially building a small report from query results. If you mixed this with source-reading, the model would get distracted reasoning about the code instead of the numbers.

---

### 4. repro-drafter

**Job:** Draft a minimal reproduction the user can run locally.

**Inputs:** stack trace, the source snippet from source-reader (when available — this one CAN wait on a peer if we want, but in phase 1 it runs independently with just the stack trace).

**Tools:** none (pure reasoning). Optionally `fetch_file` if it wants to look at adjacent code.

**Output (structured):**
```ts
{
  reproSteps: string[];           // numbered steps
  reproCode: string | null;       // minimal code snippet
  reproEnvironment: string;       // "node 20+, postgres 15"
  knownGaps: string[];            // things it couldn't infer
  confidence: number;
}
```

**Why isolated:** drafting a repro is creative synthesis. The model needs room to think about what could trigger this, not be anchored to one explanation.

---

## The coordinator

**Job:** Fan out to all four subagents in parallel, collect their results, merge into ranked hypotheses, stream status to the UI.

**Pseudocode:**
```ts
const limit = pLimit(4);  // bound concurrency
const results = await Promise.allSettled([
  limit(() => runSourceReader(input)),
  limit(() => runBlameCorrelator(input)),
  limit(() => runFrequencyAnalyzer(input)),
  limit(() => runReproDrafter(input)),
]);

const hypotheses = mergeHypotheses(results);  // calibration-aware
return rank(hypotheses);
```

**Failure handling:**
- `allSettled` instead of `all` so one bad lane doesn't kill the run.
- Each lane has its own retry policy (1 retry on transient errors, no retry on 4xx).
- Coordinator gets `{status: 'fulfilled', value} | {status: 'rejected', reason}` for each lane and decides whether to surface the failure or downweight that lane in the merge.

**Concurrency bounding:**
- `pLimit(4)` is fine for a single request. For multi-request safety, the actual Anthropic call lives behind a global semaphore set to (e.g.) 8 concurrent calls across the whole process. Beyond that, calls queue rather than fan out and hit rate limits.

**Merge strategy:**
- Each subagent returns a confidence. Coordinator weighs by historical calibration (phase 4 — Brier score logging tells us source-reader is overconfident, downweight by 0.8x).
- Output is a ranked list: `[{hypothesis, supportingEvidence: [...lanes that supported it], confidence}, ...]`.

---

## Why this design beats a single big agent

| Concern | Single agent | forge graph |
|---|---|---|
| Latency | Sequential reasoning, ~12s | Parallel, ~3s |
| Independence of evidence | Each step contaminates the next | Each lane forms its own hypothesis |
| Cost shaping | All-or-nothing | Can short-circuit when one lane returns "irrelevant" |
| Failure isolation | One bad reasoning step poisons the answer | One bad lane is dropped or downweighted |
| Eval-ability | Hard to grade — output is one blob | Each lane's output is structured and gradable |
| Streaming UX | One long stream | Four lanes the user can read in parallel |

## What this design costs

- **More LLM calls per run.** 1 coordinator + 4 subagents = 5x the call count of a single-agent baseline. Mitigated by prompt-caching the shared source context and routing the coordinator to a cheaper model (Haiku for routing/merging, Sonnet for the specialist work).
- **More complexity.** Three failure surfaces (lane failure, coordinator failure, merge logic bugs) instead of one.
- **Harder to debug.** When the answer is wrong, you need lane-by-lane traces to know which subagent missed.

The trade is worth it for an interview demo *because* it produces a richer surface to discuss. A single-agent baseline is one paragraph in the blog post. forge is a whole architecture section.

---

## Phase-by-phase delivery (mapping to harness tasks)

| Phase | Task IDs | What lands |
|---|---|---|
| 1 | #1 | scaffold + streaming round-trip ✅ |
| 2 | #2, #3, #4 | this doc + coordinator + 4 subagents + parallel UI |
| 3 | #5, #6 | resumable streams + per-lane interrupt |
| 4 | #7, #8 | speculative prefetch + Brier calibration |
| 5 | #9, #10 | eval harness (20 scenarios + scoreboard) |
| 6 | #11 | prompt caching + cost dashboard |
| 7 | #12, #13, #14, #15 | deploy + quiz + blog + portfolio entry |
