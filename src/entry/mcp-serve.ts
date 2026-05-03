#!/usr/bin/env bun
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { buildContext } from "@/core/context";
import { loadSkills } from "@/skills/loader";
import { createMoteMcpServer } from "@/mcp/server";
import { writeLlmsTxt } from "@/mcp/llms-txt";

async function main(): Promise<void> {
  const ctx = await buildContext({});
  const skills = await loadSkills(ctx.workspaceDir);

  // Regenerate llms.txt at startup so it reflects the current skill list.
  await writeLlmsTxt(ctx.workspaceDir, skills);

  const { server } = createMoteMcpServer(ctx, skills);
  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Keep the process alive — server.connect's promise resolves once the
  // transport is wired but the connection lives on stdin events. Without
  // this, the process would exit. Listening for SIGINT lets the operator
  // close cleanly.
  await new Promise<void>(resolve => {
    process.once("SIGINT", () => resolve());
  });

  await server.close();
}

if (import.meta.main) {
  main().catch((err: unknown) => {
    if (process.env["MOTE_DEBUG"] === "1") {
      console.error(err);
    } else {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`mote-mcp: ${msg}`);
    }
    process.exit(1);
  });
}
