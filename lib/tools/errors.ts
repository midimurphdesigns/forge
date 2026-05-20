import { tool } from "ai";
import { z } from "zod";

export const queryErrors = tool({
  description: "Return the total occurrences of an error fingerprint within a time window.",
  inputSchema: z.object({
    fingerprint: z.string(),
    since: z.string(),
    until: z.string(),
  }),
  execute: async ({ fingerprint }) => ({
    fingerprint,
    totalOccurrences: 1247,
    firstSeen: "2026-05-20T10:22:00Z",
    lastSeen: "2026-05-20T14:08:00Z",
  }),
});

export const queryAffectedUsers = tool({
  description: "Return the distinct number of users hitting this error in the window.",
  inputSchema: z.object({
    fingerprint: z.string(),
    since: z.string(),
    until: z.string(),
  }),
  execute: async ({ fingerprint }) => ({
    fingerprint,
    affectedUsers: 184,
  }),
});

export const queryHourlyRate = tool({
  description: "Return per-hour occurrence counts over the last 24h for an error fingerprint.",
  inputSchema: z.object({ fingerprint: z.string() }),
  execute: async ({ fingerprint }) => ({
    fingerprint,
    ratePerHour: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 14, 87, 142, 188, 201, 219, 196],
  }),
});

export const queryRelatedErrors = tool({
  description: "Return error fingerprints with similar stack-trace shape.",
  inputSchema: z.object({ fingerprint: z.string() }),
  execute: async ({ fingerprint }) => ({
    fingerprint,
    relatedFingerprints: ["f8a3b22", "9c14ee0"],
  }),
});
