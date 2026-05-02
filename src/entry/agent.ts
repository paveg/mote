#!/usr/bin/env bun
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";

import { buildContext } from "@/core/context";
import { runLoop } from "@/core/loop";
import type { Message } from "@/core/types";

async function main(): Promise<void> {
  const controller = new AbortController();
  const ctx = await buildContext({ signal: controller.signal });

  // Resume from the latest persisted session if any. Per-CLI-launch
  // session continuity is M0-style "open the most recent jsonl";
  // M2 will replace this with proper session selection over SQLite.
  const history: Message[] = await ctx.state.loadLatestSession();
  if (history.length > 0) {
    process.stdout.write(`(resumed ${history.length} prior messages)\n`);
  }

  // SIGINT once → graceful shutdown signal. Twice → hard exit so a runaway
  // session can't lock the user out.
  let sigintCount = 0;
  process.on("SIGINT", () => {
    sigintCount += 1;
    if (sigintCount === 1) {
      controller.abort();
      process.stdout.write("\n(interrupting; press Ctrl+C again to force quit)\n");
    } else {
      process.exit(130);
    }
  });

  const rl = createInterface({ input: stdin, output: stdout });

  // Accumulate the live conversation across user turns. Each turn calls
  // runLoop with the entire history so the model sees full context.
  const messages: Message[] = [...history];

  while (!controller.signal.aborted) {
    let line: string;
    try {
      line = (await rl.question("> ")).trim();
    } catch {
      // readline aborts when stdin closes (EOF) — exit cleanly.
      break;
    }

    if (line === "") continue;
    if (line === "/exit") break;

    // Slash command: if the line starts with "/" and the name matches a
    // registered tool, rewrite the user input to a natural-language directive
    // so the LLM can invoke the tool via the manifest. Unknown slash commands
    // are reported and the loop continues without contaminating the conversation.
    if (line.startsWith("/")) {
      const name = line.slice(1).trim();
      const known = ctx.registry.schemas().some((s) => s.name === name);
      if (!known) {
        process.stdout.write(`unknown command: /${name}\n`);
        continue;
      }
      line = `Please execute the ${name} skill.`;
    }

    const userMessage: Message = {
      role: "user",
      content: [{ type: "text", text: line }],
      createdAt: Date.now(),
    };
    messages.push(userMessage);
    await ctx.state.appendMessages(ctx.sessionId, [userMessage]);

    const result = await runLoop(messages, ctx);
    // runLoop returns the full message list; assign it back so the next turn
    // sees the assistant + tool_result messages it produced.
    messages.length = 0;
    messages.push(...result.messages);

    // Print any text from the latest assistant message
    const last = messages[messages.length - 1];
    if (last && last.role === "assistant") {
      for (const block of last.content) {
        if (block.type === "text") {
          process.stdout.write(block.text + "\n");
        }
      }
    }
  }

  rl.close();
}

if (import.meta.main) main().catch((err: unknown) => {
  // Errors from the agent loop / provider / registry surface here. Print a
  // sanitized message; full stack only in MOTE_DEBUG=1 mode for development.
  if (process.env["MOTE_DEBUG"] === "1") {
    console.error(err);
  } else {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`mote: ${msg}`);
  }
  process.exit(1);
});
