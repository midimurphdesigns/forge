"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { useState } from "react";

export default function Home() {
  const { messages, sendMessage, status } = useChat({
    transport: new DefaultChatTransport({ api: "/api/chat" }),
  });
  const [input, setInput] = useState("");

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || status === "streaming") return;
    sendMessage({ text: input });
    setInput("");
  };

  return (
    <main className="relative z-10 mx-auto flex min-h-screen w-full max-w-2xl flex-col gap-10 px-6 py-16">
      <header className="flex flex-col gap-3">
        <h1 className="font-display text-[88px] leading-[0.95] tracking-tight">forge</h1>
        <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--color-ink-muted)]">
          phase 1 — streaming round-trip
        </p>
        <a
          href="/debug"
          className="mt-2 inline-flex items-center gap-2 text-sm text-[var(--color-accent)]"
        >
          <span>multi-agent debug surface</span>
          <span aria-hidden>→</span>
        </a>
      </header>

      <section className="flex flex-1 flex-col gap-5">
        {messages.map((m) => (
          <div key={m.id} className="flex flex-col gap-1">
            <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-ink-faint)]">
              {m.role}
            </div>
            <div className="whitespace-pre-wrap text-[15px] leading-relaxed text-[var(--color-ink)]">
              {m.parts.map((part, i) =>
                part.type === "text" ? <span key={i}>{part.text}</span> : null,
              )}
            </div>
          </div>
        ))}
        {status === "streaming" && (
          <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-ink-faint)]">
            streaming...
          </div>
        )}
      </section>

      <form onSubmit={onSubmit} className="flex gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          className="flex-1 rounded border border-[var(--color-divider)] bg-[var(--color-canvas-elev-1)] px-3 py-2 text-sm text-[var(--color-ink)] outline-none transition-colors focus:border-[var(--color-accent)]"
          placeholder="say something..."
          disabled={status === "streaming"}
        />
        <button
          type="submit"
          disabled={status === "streaming" || !input.trim()}
          className="rounded border border-[var(--color-accent)] bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-[var(--color-canvas)] transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          send
        </button>
      </form>
    </main>
  );
}
