import { ToolRegistry } from "@/core/registry";
import type { LoadedSkill } from "@/skills/types";
import { createSkillToolDefinition } from "@/skills/handler";

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
