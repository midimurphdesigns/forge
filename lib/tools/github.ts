import { tool } from "ai";
import { z } from "zod";

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

export const fetchFile = tool({
  description:
    "Fetch a file from a GitHub repository at a specific commit SHA. Returns the file contents as a string.",
  inputSchema: z.object({
    path: z.string().describe("Relative path inside the repo, e.g. src/auth/session.ts"),
    ref: z.string().describe("Commit SHA or branch name"),
  }),
  execute: async ({ path }) => {
    const content = FIXTURE_FILES[path];
    if (!content) {
      return { error: `file not found: ${path}` };
    }
    return { path, content, lineCount: content.split("\n").length };
  },
});

export const fetchDirectory = tool({
  description:
    "List the contents of a directory inside a GitHub repository at a specific commit SHA.",
  inputSchema: z.object({
    path: z.string().describe("Directory path, e.g. src/auth"),
    ref: z.string().describe("Commit SHA or branch name"),
  }),
  execute: async ({ path }) => {
    if (path === "src/auth") {
      return { path, entries: ["session.ts", "middleware.ts", "providers.ts"] };
    }
    return { path, entries: [] };
  },
});

export const gitLog = tool({
  description:
    "Return commits touching a path within a time window. Use this to find suspect commits near the error timestamp.",
  inputSchema: z.object({
    path: z.string(),
    since: z.string().describe("ISO timestamp"),
    until: z.string().describe("ISO timestamp"),
  }),
  execute: async ({ path }) => {
    return {
      path,
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
});

export const gitDiff = tool({
  description: "Return the diff for a single commit.",
  inputSchema: z.object({ sha: z.string() }),
  execute: async ({ sha }) => {
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
});

export const gitBlame = tool({
  description: "Return who last touched a specific line in a file.",
  inputSchema: z.object({
    path: z.string(),
    line: z.number().int().positive(),
  }),
  execute: async ({ path, line }) => {
    return {
      path,
      line,
      sha: "a3f1c92",
      author: "alice@example.com",
      date: "2026-05-20T10:14:00Z",
    };
  },
});
