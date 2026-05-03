#!/usr/bin/env bun
import { join } from "node:path";

import { createTelegramGateway } from "@/channels/telegram";
import { loadAllowlist } from "@/channels/telegram-allowlist";
import { createAuditLogger } from "@/channels/telegram-audit";
import { createPairingStore } from "@/channels/telegram-pairing";
import { buildContext } from "@/core/context";
import { loadSkills } from "@/skills/loader";
import { resolveGatewayOpts } from "@/entry/gateway-opts";

async function main(): Promise<void> {
  const opts = resolveGatewayOpts(process.env);
  const ctx = await buildContext({ agentId: process.env["MOTE_AGENT_ID"] ?? "default" });
  const skills = await loadSkills(ctx.workspaceDir);

  const allowlist = await loadAllowlist(join(ctx.workspaceDir, "telegram-allowlist.json"));
  const pairing = createPairingStore();
  const audit = await createAuditLogger(join(ctx.workspaceDir, "telegram-audit.log"), {
    token: opts.token,
  });

  const ctrl = new AbortController();
  process.on("SIGINT", () => ctrl.abort());
  process.on("SIGTERM", () => ctrl.abort());

  const model = process.env["LLM_MODEL"] ?? "claude-sonnet-4-6";

  await createTelegramGateway(ctx, {
    token: opts.token,
    masterId: opts.masterId,
    skills,
    allowlist,
    pairing,
    audit,
    model,
    abort: ctrl.signal,
  });
}

if (import.meta.main) {
  main().catch((err: unknown) => {
    if (process.env["MOTE_DEBUG"] === "1") {
      console.error(err);
    } else {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`mote-gateway: ${msg}`);
    }
    process.exit(1);
  });
}
