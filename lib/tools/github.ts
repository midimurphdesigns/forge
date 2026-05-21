import { tool } from "ai";
import { z } from "zod";
import type { Speculator } from "@/lib/speculator";

const FIXTURE_FILES: Record<string, string> = {
  "src/auth/session.ts": `import { cookies } from "next/headers";
import { db } from "@/lib/db";

export async function getSession() {
  const token = (await cookies()).get("session")?.value;
  if (!token) return null;

  // BUG: db.session can be undefined if the migration hasn't run
  const session = await db.session.findUnique({ where: { token } });
  return session.user;  // crash if session is null
}`,
};

export const rawExecutors = {
  fetch_file: async (args: Record<string, unknown>) => {
    const path = args.path as string;
    const content = FIXTURE_FILES[path];
    if (!content) return { error: `file not found: ${path}` };
    return { path, content, lineCount: content.split("\n").length };
  },
  fetch_directory: async (args: Record<string, unknown>) => {
    const path = args.path as string;
    if (path === "src/auth") {
      return { path, entries: ["session.ts", "middleware.ts", "providers.ts"] };
    }
    return { path, entries: [] };
  },
  git_log: async (args: Record<string, unknown>) => {
    return {
      path: args.path,
      commits: [
        {
          sha: "a3f1c92",
          author: "alice@example.com",
          date: "2026-05-20T10:14:00Z",
          summary: "refactor: extract session helper",
        },
        {
          sha: "1b8e44d",
          author: "bob@example.com",
          date: "2026-05-19T22:01:00Z",
          summary: "feat: add session migration",
        },
      ],
    };
  },
  git_diff: async (args: Record<string, unknown>) => {
    const sha = args.sha as string;
    if (sha === "a3f1c92") {
      return {
        sha,
        diff: `--- a/src/auth/session.ts
+++ b/src/auth/session.ts
@@ -8,5 +8,5 @@
-  if (!session) return null;
-  return session.user;
+  // simplified: trust the db
+  return session.user;`,
      };
    }
    return { sha, diff: "(no diff fixture for this sha)" };
  },
  git_blame: async (args: Record<string, unknown>) => {
    return {
      path: args.path,
      line: args.line,
      sha: "a3f1c92",
      author: "alice@example.com",
      date: "2026-05-20T10:14:00Z",
    };
  },
};

export function buildGithubTools(speculator?: Speculator) {
  if (speculator) {
    for (const [name, exec] of Object.entries(rawExecutors)) {
      speculator.registerExecutor(name, exec);
    }
  }

  const runVia = async (name: string, args: Record<string, unknown>) => {
    const result = speculator
      ? await speculator.consume(name, args)
      : await rawExecutors[name as keyof typeof rawExecutors](args);
    speculator?.speculate(name, args);
    return result;
  };

  return {
    fetch_file: tool({
      description:
        "Fetch a file from a GitHub repository at a specific commit SHA.",
      inputSchema: z.object({
        path: z.string(),
        ref: z.string(),
      }),
      execute: async (args) => runVia("fetch_file", args),
    }),
    fetch_directory: tool({
      description:
        "List the contents of a directory inside a GitHub repository at a specific commit SHA.",
      inputSchema: z.object({
        path: z.string(),
        ref: z.string(),
      }),
      execute: async (args) => runVia("fetch_directory", args),
    }),
    git_log: tool({
      description: "Return commits touching a path within a time window.",
      inputSchema: z.object({
        path: z.string(),
        since: z.string(),
        until: z.string(),
      }),
      execute: async (args) => runVia("git_log", args),
    }),
    git_diff: tool({
      description: "Return the diff for a single commit.",
      inputSchema: z.object({ sha: z.string() }),
      execute: async (args) => runVia("git_diff", args),
    }),
    git_blame: tool({
      description: "Return who last touched a specific line in a file.",
      inputSchema: z.object({
        path: z.string(),
        line: z.number().int().positive(),
      }),
      execute: async (args) => runVia("git_blame", args),
    }),
  };
}
