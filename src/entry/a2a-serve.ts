#!/usr/bin/env bun
import { buildContext } from "@/core/context";
import { loadSkills } from "@/skills/loader";
import { createA2aApp } from "@/channels/a2a";
import { parseA2aServeOpts } from "@/entry/a2a-opts";
import type { SqliteState } from "@/core/state";

async function main(): Promise<void> {
  const opts = parseA2aServeOpts();
  const ctx = await buildContext({});
  const skills = await loadSkills(ctx.workspaceDir);

  const taskStore = (ctx.state as SqliteState).a2aTaskStore;

  const app = createA2aApp(ctx, {
    skills,
    taskStore,
  });

  // Bun.serve with TLS if configured.
  const serveOpts: Parameters<typeof Bun.serve>[0] = {
    fetch: app.fetch,
    port: opts.port,
    hostname: opts.bind,
  };

  if (opts.tls) {
    const fs = await import("node:fs/promises");
    const cert = await fs.readFile(opts.tls.cert, "utf8");
    const key = await fs.readFile(opts.tls.key, "utf8");
    (serveOpts as { tls: { cert: string; key: string } }).tls = { cert, key };
  }

  const server = Bun.serve(serveOpts);
  process.stdout.write(
    `mote a2a-serve listening on ${opts.tls ? "https" : "http"}://${opts.bind}:${server.port}\n`,
  );

  await new Promise<void>(resolve => {
    process.once("SIGINT", () => resolve());
  });
  server.stop();
}

if (import.meta.main) {
  main().catch((err: unknown) => {
    if (process.env["MOTE_DEBUG"] === "1") {
      console.error(err);
    } else {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`mote-a2a-serve: ${msg}`);
    }
    process.exit(1);
  });
}
