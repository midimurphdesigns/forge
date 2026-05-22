import type { Metadata } from "next";
import { geistMono, instrumentSerif, spaceGrotesk } from "@/lib/fonts";
import Cursor from "@/components/Cursor";
import "./globals.css";

export const metadata: Metadata = {
  title: "forge — multi-agent debugging concierge",
  description:
    "Point it at a stack trace, it spawns four specialist subagents in parallel and ranks hypotheses by confidence. Built on Vercel AI SDK + Anthropic.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${spaceGrotesk.variable} ${geistMono.variable} ${instrumentSerif.variable}`}
    >
      <head>
        <link
          rel="preload"
          href="/fonts/migra/Migra-Italic-Regular.woff2"
          as="font"
          type="font/woff2"
          crossOrigin="anonymous"
        />
      </head>
      <body className="flex min-h-screen flex-col">
        <Cursor />
        {children}
      </body>
    </html>
  );
}
