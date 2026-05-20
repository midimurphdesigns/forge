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
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 p-8 font-mono">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold">forge</h1>
        <p className="text-sm text-gray-500">
          phase 1: streaming round-trip sanity check
        </p>
        <a
          href="/debug"
          className="text-xs text-cyan-400 underline underline-offset-2"
        >
          → multi-agent debug surface
        </a>
      </header>

      <section className="flex flex-1 flex-col gap-4">
        {messages.map((m) => (
          <div key={m.id} className="flex flex-col gap-1">
            <div className="text-xs uppercase text-gray-500">{m.role}</div>
            <div className="whitespace-pre-wrap text-sm">
              {m.parts.map((part, i) =>
                part.type === "text" ? <span key={i}>{part.text}</span> : null,
              )}
            </div>
          </div>
        ))}
        {status === "streaming" && (
          <div className="text-xs text-gray-400">streaming...</div>
        )}
      </section>

      <form onSubmit={onSubmit} className="flex gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          className="flex-1 rounded border border-gray-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-cyan-400"
          placeholder="say something..."
          disabled={status === "streaming"}
        />
        <button
          type="submit"
          disabled={status === "streaming" || !input.trim()}
          className="rounded bg-cyan-400 px-4 py-2 text-sm font-medium text-black disabled:opacity-50"
        >
          send
        </button>
      </form>
    </main>
  );
}
