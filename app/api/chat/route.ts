import { anthropic } from "@ai-sdk/anthropic";
import { convertToModelMessages, streamText, type UIMessage } from "ai";

export const runtime = "nodejs";
export const maxDuration = 60;

type ChatBody = {
  messages: UIMessage[];
};

export async function POST(req: Request): Promise<Response> {
  const { messages } = (await req.json()) as ChatBody;

  const result = streamText({
    model: anthropic("claude-sonnet-4-6"),
    system:
      "You are forge, a multi-agent debugging concierge. In Phase 1 you are only proving the streaming round-trip works. Respond concisely.",
    messages: await convertToModelMessages(messages),
  });

  return result.toUIMessageStreamResponse();
}
