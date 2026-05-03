import { ToolRegistry } from "@/core/registry";
import type { LoadedSkill } from "@/skills/types";
import { createSkillToolDefinition } from "@/skills/handler";
import { runLoop } from "@/core/loop";
import type { AgentContext } from "@/core/context";
import type { Allowlist } from "@/channels/telegram-allowlist";
import type { PairingStore } from "@/channels/telegram-pairing";
import type { AuditLogger } from "@/channels/telegram-audit";
import type { Message } from "@/core/types";

export interface InboundEnvelope {
  readonly channel: "telegram";
  readonly from: string;
  readonly timestamp: number;
  readonly body: string;
}

interface TelegramFrom {
  id: number;
  is_bot: boolean;
}

interface TelegramChat {
  id: number;
  type: string;
}

interface TelegramMessage {
  message_id: number;
  from?: TelegramFrom;
  chat: TelegramChat;
  date: number;
  text?: string;
  voice?: unknown;
  photo?: unknown;
  document?: unknown;
  sticker?: unknown;
}

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
}

export function normalizeUpdate(update: TelegramUpdate): InboundEnvelope | null {
  const msg = update.message;
  if (!msg) return null;
  if (msg.chat.type !== "private") return null;
  if (!msg.from) return null;

  const from = String(msg.from.id);
  const timestamp = msg.date * 1000;

  if (typeof msg.text === "string") {
    return { channel: "telegram", from, timestamp, body: msg.text };
  }
  if (msg.voice !== undefined) {
    return { channel: "telegram", from, timestamp, body: "[unsupported: voice]" };
  }
  if (msg.photo !== undefined) {
    return { channel: "telegram", from, timestamp, body: "[unsupported: photo]" };
  }
  if (msg.document !== undefined) {
    return { channel: "telegram", from, timestamp, body: "[unsupported: document]" };
  }
  if (msg.sticker !== undefined) {
    return { channel: "telegram", from, timestamp, body: "[unsupported: sticker]" };
  }
  return { channel: "telegram", from, timestamp, body: "[unsupported: unknown]" };
}

// Telegram bot token shape: "<bot_id>:<35-char suffix>" where the suffix
// uses [A-Za-z0-9_-]. Reject anything else fail-closed; the gateway entry
// must not start without a real token.
const TOKEN_PATTERN = /^\d+:[A-Za-z0-9_-]{35}$/;

export function validateToken(token: string): string {
  if (!TOKEN_PATTERN.test(token)) {
    throw new Error("MOTE_TELEGRAM_TOKEN format invalid (expected '<bot_id>:<35 char suffix>')");
  }
  return token;
}

// Minimal call-signature for the fetch injectable — avoids the `.preconnect`
// property that Bun attaches to the global `fetch` object.
export type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

// Telegram API wrapper. The ONLY place a token appears in a URL.
// Token is redacted from any thrown error and any log line.
//
// Telegram returns { ok: true, result: T } on success, { ok: false, description: string }
// on failure. We unwrap to T or throw with the description (token-stripped).
export async function callApi<T>(
  token: string,
  method: string,
  params: Record<string, unknown>,
  fetchImpl: FetchFn = fetch,
): Promise<T> {
  const url = `https://api.telegram.org/bot${token}/${method}`;
  const sanitizedUrl = `https://api.telegram.org/bot<redacted>/${method}`;
  const redact = (s: string): string =>
    token.length > 0 ? s.split(token).join("<redacted>") : s;

  let res: Response;
  try {
    res = await fetchImpl(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(params),
    });
  } catch (err) {
    const msg = redact((err as Error).message);
    throw new Error(`telegram fetch failed for ${sanitizedUrl}: ${msg}`);
  }

  let body: { ok: boolean; result?: T; description?: string; error_code?: number };
  try {
    body = (await res.json()) as typeof body;
  } catch (err) {
    const msg = redact((err as Error).message);
    throw new Error(`telegram bad json from ${sanitizedUrl} (status ${res.status}): ${msg}`);
  }

  if (!body.ok) {
    const desc = redact(body.description ?? "");
    throw new Error(
      `telegram api error from ${sanitizedUrl} (code ${body.error_code ?? "?"}): ${desc}`,
    );
  }

  if (body.result === undefined) {
    throw new Error(`telegram missing result from ${sanitizedUrl}`);
  }
  return body.result;
}

// Build the RestrictedRegistry handed to runLoop for an inbound Telegram
// dispatch (ADR-0012 D5, mirrors ADR-0011 D4 for A2A). Only mcp:public
// skills appear; built-in tools (read_file / memory_* / search_sessions)
// are deliberately absent so a Telegram caller cannot reach them.
export function buildPublicRegistry(
  skills: readonly LoadedSkill[],
  model: string,
): ToolRegistry {
  const registry = new ToolRegistry();
  for (const skill of skills) {
    if (skill.mcp !== "public") continue;
    registry.register(createSkillToolDefinition(skill, { model }));
  }
  return registry;
}

// ---------------------------------------------------------------------------
// sendMessage
// ---------------------------------------------------------------------------

export async function sendMessage(
  token: string,
  chatId: number | string,
  text: string,
  fetchImpl: FetchFn = fetch,
): Promise<void> {
  await callApi(token, "sendMessage", { chat_id: chatId, text }, fetchImpl);
}

// ---------------------------------------------------------------------------
// dispatch
// ---------------------------------------------------------------------------

export interface DispatchDeps {
  readonly ctx: AgentContext;
  readonly token: string;
  readonly masterId: number;
  readonly registry: ToolRegistry;
  readonly allowlist: Allowlist;
  readonly pairing: PairingStore;
  readonly audit: AuditLogger;
  readonly fetchImpl?: FetchFn;
  // Test seam: override the agent dispatch. Default invokes runLoop with a
  // per-call AgentContext whose registry is the RestrictedRegistry.
  readonly agentReply?: (env: InboundEnvelope, deps: DispatchDeps) => Promise<string>;
}

async function defaultAgentReply(env: InboundEnvelope, deps: DispatchDeps): Promise<string> {
  const restrictedCtx: AgentContext = {
    ...deps.ctx,
    registry: deps.registry,
    sessionId: `telegram_${env.from}_${env.timestamp}`,
  };
  const userMessage: Message = {
    role: "user",
    content: [{ type: "text", text: env.body }],
    createdAt: env.timestamp,
  };
  try {
    const result = await runLoop([userMessage], restrictedCtx);
    const texts: string[] = [];
    for (const msg of result.messages) {
      if (msg.role === "assistant") {
        for (const block of msg.content) {
          if (block.type === "text") texts.push(block.text);
        }
      }
    }
    return texts.join("") || "(no response)";
  } catch (err) {
    if (process.env["MOTE_DEBUG"] === "1") {
      console.error("[telegram dispatch] runLoop error:", err);
    }
    return `Internal error: ${(err as Error).message.replace(deps.token, "<redacted>")}`;
  }
}

export async function dispatch(env: InboundEnvelope, deps: DispatchDeps): Promise<void> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const fromId = Number.parseInt(env.from, 10);
  const isMaster = fromId === deps.masterId;

  // Master command parsing
  if (isMaster) {
    const approveMatch = env.body.match(/^\/approve\s+([0-9a-f]{32})\b/);
    if (approveMatch) {
      const code = approveMatch[1] as string;
      const result = deps.pairing.redeem(code);
      if (result.ok) {
        await deps.allowlist.add({ userId: result.userId, approvedAt: Date.now() });
        await deps.audit.log({ type: "approved", from: result.userId, bytes: 0 });
        await sendMessage(deps.token, deps.masterId, `Approved ${result.userId}.`, fetchImpl);
        await sendMessage(
          deps.token,
          result.userId,
          "You are now approved. DM me anytime.",
          fetchImpl,
        );
        return;
      }
      if (result.reason === "expired") {
        await deps.audit.log({ type: "rejected", from: deps.masterId, reason: "code expired" });
        await sendMessage(deps.token, deps.masterId, "Code expired.", fetchImpl);
        return;
      }
      // not_found
      await deps.audit.log({ type: "rejected", from: deps.masterId, reason: "code not found" });
      await sendMessage(deps.token, deps.masterId, "No pending pairing for that code.", fetchImpl);
      return;
    }

    const revokeMatch = env.body.match(/^\/revoke\s+(-?\d+)\b/);
    if (revokeMatch) {
      const targetId = Number.parseInt(revokeMatch[1] as string, 10);
      await deps.allowlist.remove(targetId);
      await deps.audit.log({ type: "rejected", from: targetId, reason: "revoked by master" });
      await sendMessage(deps.token, deps.masterId, `Revoked ${targetId}.`, fetchImpl);
      return;
    }

    // master regular DM falls through to the approved-dispatch path below
  }

  // Allowlist gate (master is auto-allowed, even if not yet in the file)
  if (!isMaster && !deps.allowlist.has(fromId)) {
    const pending = deps.pairing.generate(fromId);
    await deps.audit.log({ type: "pending-pairing", from: fromId, code: pending.code });
    await sendMessage(
      deps.token,
      fromId,
      `Pairing code: ${pending.code}\nAsk the operator to approve.`,
      fetchImpl,
    );
    await sendMessage(
      deps.token,
      deps.masterId,
      `User ${fromId} is requesting access.\nReply: /approve ${pending.code}`,
      fetchImpl,
    );
    return;
  }

  // Approved message — log + reply
  await deps.audit.log({ type: "approved", from: fromId, bytes: env.body.length });

  // Unsupported content reply
  if (env.body.startsWith("[unsupported:")) {
    await sendMessage(deps.token, fromId, "Sorry, text only.", fetchImpl);
    return;
  }

  // Agent dispatch — RestrictedRegistry per ADR-0012 D5
  const agentReply = deps.agentReply ?? defaultAgentReply;
  const reply = await agentReply(env, deps);
  await sendMessage(deps.token, fromId, reply, fetchImpl);
}

// ---------------------------------------------------------------------------
// createTelegramGateway
// ---------------------------------------------------------------------------

export interface CreateGatewayOpts {
  readonly token: string;
  readonly masterId: number;
  readonly skills: readonly LoadedSkill[];
  readonly allowlist: Allowlist;
  readonly pairing: PairingStore;
  readonly audit: AuditLogger;
  readonly model: string;
  readonly abort?: AbortSignal;
  readonly fetchImpl?: FetchFn;
  readonly pollTimeoutSec?: number; // default 30
  readonly agentReply?: DispatchDeps["agentReply"];
}

export async function createTelegramGateway(
  ctx: AgentContext,
  opts: CreateGatewayOpts,
): Promise<void> {
  const token = validateToken(opts.token);
  const fetchImpl = opts.fetchImpl ?? fetch;
  const pollTimeoutSec = opts.pollTimeoutSec ?? 30;
  const registry = buildPublicRegistry(opts.skills, opts.model);

  let offset = 0;
  while (!opts.abort?.aborted) {
    let updates: TelegramUpdate[];
    try {
      updates = await callApi<TelegramUpdate[]>(
        token,
        "getUpdates",
        { offset, timeout: pollTimeoutSec },
        fetchImpl,
      );
    } catch (err) {
      // The error message is already token-redacted by callApi.
      console.error(`[telegram] getUpdates failed: ${(err as Error).message}`);
      // Brief back-off so a flaky network does not hot-loop.
      await new Promise((r) => setTimeout(r, 1000));
      continue;
    }

    for (const update of updates) {
      offset = Math.max(offset, update.update_id + 1);
      const env = normalizeUpdate(update);
      if (!env) continue;
      try {
        await dispatch(env, {
          ctx,
          token,
          masterId: opts.masterId,
          registry,
          allowlist: opts.allowlist,
          pairing: opts.pairing,
          audit: opts.audit,
          fetchImpl,
          ...(opts.agentReply ? { agentReply: opts.agentReply } : {}),
        });
      } catch (err) {
        const msg = (err as Error).message.replace(token, "<redacted>");
        console.error(`[telegram] dispatch failed: ${msg}`);
      }
    }
  }
}
