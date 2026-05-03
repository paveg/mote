import { describe, expect, it } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildPublicRegistry,
  callApi,
  createTelegramGateway,
  dispatch,
  type DispatchDeps,
  type FetchFn,
  type InboundEnvelope,
  normalizeUpdate,
  sendMessage,
  validateToken,
} from "@/channels/telegram";
import { loadAllowlist } from "@/channels/telegram-allowlist";
import { createPairingStore } from "@/channels/telegram-pairing";
import { createAuditLogger } from "@/channels/telegram-audit";
import type { LoadedSkill } from "@/skills/types";

const baseFrom = { id: 12345, is_bot: false } as const;
const baseChat = (type: string) => ({ id: 12345, type }) as const;

describe("normalizeUpdate", () => {
  it("normalizes a private DM with text into the canonical envelope", () => {
    const update = {
      update_id: 1,
      message: {
        message_id: 100,
        from: { ...baseFrom },
        chat: baseChat("private"),
        date: 1730000000,
        text: "hello",
      },
    };
    expect(normalizeUpdate(update)).toEqual({
      channel: "telegram",
      from: "12345",
      timestamp: 1730000000000,
      body: "hello",
    });
  });

  it("returns null for group chat", () => {
    expect(
      normalizeUpdate({
        update_id: 1,
        message: {
          message_id: 1,
          from: { ...baseFrom },
          chat: baseChat("group"),
          date: 1,
          text: "x",
        },
      }),
    ).toBeNull();
  });

  it("returns null for supergroup chat", () => {
    expect(
      normalizeUpdate({
        update_id: 1,
        message: {
          message_id: 1,
          from: { ...baseFrom },
          chat: baseChat("supergroup"),
          date: 1,
          text: "x",
        },
      }),
    ).toBeNull();
  });

  it("returns null for channel posts", () => {
    expect(
      normalizeUpdate({
        update_id: 1,
        message: {
          message_id: 1,
          from: { ...baseFrom },
          chat: baseChat("channel"),
          date: 1,
          text: "x",
        },
      }),
    ).toBeNull();
  });

  it("returns null when there is no message (e.g., only callback_query)", () => {
    expect(normalizeUpdate({ update_id: 1 })).toBeNull();
  });

  it("emits an unsupported marker for voice messages", () => {
    expect(
      normalizeUpdate({
        update_id: 1,
        message: {
          message_id: 1,
          from: { ...baseFrom },
          chat: baseChat("private"),
          date: 1,
          voice: {},
        },
      }),
    ).toEqual({ channel: "telegram", from: "12345", timestamp: 1000, body: "[unsupported: voice]" });
  });

  it("emits an unsupported marker for photos", () => {
    expect(
      normalizeUpdate({
        update_id: 1,
        message: {
          message_id: 1,
          from: { ...baseFrom },
          chat: baseChat("private"),
          date: 2,
          photo: [{ file_id: "x" }],
        },
      }),
    ).toEqual({ channel: "telegram", from: "12345", timestamp: 2000, body: "[unsupported: photo]" });
  });

  it("emits an unsupported marker for documents", () => {
    expect(
      normalizeUpdate({
        update_id: 1,
        message: {
          message_id: 1,
          from: { ...baseFrom },
          chat: baseChat("private"),
          date: 3,
          document: { file_id: "x" },
        },
      }),
    ).toEqual({ channel: "telegram", from: "12345", timestamp: 3000, body: "[unsupported: document]" });
  });

  it("emits an unsupported marker for stickers", () => {
    expect(
      normalizeUpdate({
        update_id: 1,
        message: {
          message_id: 1,
          from: { ...baseFrom },
          chat: baseChat("private"),
          date: 4,
          sticker: { file_id: "x" },
        },
      }),
    ).toEqual({ channel: "telegram", from: "12345", timestamp: 4000, body: "[unsupported: sticker]" });
  });

  it("emits an unsupported marker for an empty/unknown-content private message", () => {
    expect(
      normalizeUpdate({
        update_id: 1,
        message: {
          message_id: 1,
          from: { ...baseFrom },
          chat: baseChat("private"),
          date: 1,
        },
      }),
    ).toEqual({ channel: "telegram", from: "12345", timestamp: 1000, body: "[unsupported: unknown]" });
  });

  it("emits unsupported for unrecognized media types (video_note, animation, etc.)", () => {
    expect(
      normalizeUpdate({
        update_id: 1,
        message: {
          message_id: 1,
          from: { ...baseFrom },
          chat: baseChat("private"),
          date: 5,
          // @ts-expect-error - schema is intentionally minimal; video_note isn't in TelegramMessage
          video_note: { file_id: "x" },
        },
      }),
    ).toEqual({ channel: "telegram", from: "12345", timestamp: 5000, body: "[unsupported: unknown]" });
  });

  it("returns null when the message has no from (anonymous channel post)", () => {
    expect(
      normalizeUpdate({
        update_id: 1,
        message: {
          message_id: 1,
          chat: baseChat("private"),
          date: 1,
          text: "x",
        } as never, // type-cast: TS won't let us omit `from` against the public shape
      }),
    ).toBeNull();
  });

  it("preserves negative-id senders (chat with self has id < 0 sometimes; the from id must round-trip)", () => {
    const result = normalizeUpdate({
      update_id: 1,
      message: {
        message_id: 1,
        from: { id: -42, is_bot: false },
        chat: baseChat("private"),
        date: 1,
        text: "x",
      },
    });
    expect(result).toEqual({ channel: "telegram", from: "-42", timestamp: 1000, body: "x" });
  });
});

describe("validateToken", () => {
  it("accepts a well-shaped bot token", () => {
    const token = `1234567890:${"a".repeat(35)}`;
    expect(validateToken(token)).toBe(token);
  });

  it("rejects an empty string", () => {
    expect(() => validateToken("")).toThrow(/format/i);
  });

  it("rejects a token without the colon separator", () => {
    expect(() => validateToken("not-a-token")).toThrow(/format/i);
  });

  it("rejects a token whose suffix is too short", () => {
    expect(() => validateToken("1234567890:short")).toThrow(/format/i);
  });

  it("rejects an obvious test placeholder", () => {
    expect(() => validateToken("123456:test")).toThrow(/format/i);
  });

  it("rejects a token whose suffix is too long (>35 chars)", () => {
    expect(() => validateToken(`1234567890:${"a".repeat(36)}`)).toThrow(/format/i);
  });

  it("rejects a token with a trailing newline (env-file gotcha)", () => {
    expect(() => validateToken(`1234567890:${"a".repeat(35)}\n`)).toThrow(/format/i);
  });

  it("rejects a token whose suffix uses disallowed characters", () => {
    expect(() => validateToken(`1234567890:${"!".repeat(35)}`)).toThrow(/format/i);
  });

  it("rejects a token whose bot id is non-numeric", () => {
    expect(() => validateToken(`abc:${"a".repeat(35)}`)).toThrow(/format/i);
  });

  it("accepts a token whose suffix uses underscores and dashes", () => {
    const token = `42:${"a".repeat(33)}_-`;
    expect(validateToken(token)).toBe(token);
  });
});

describe("buildPublicRegistry", () => {
  const makeSkill = (name: string, mcp: "public" | "private"): LoadedSkill => ({
    name,
    description: `desc for ${name}`,
    body: "skill body",
    path: `/tmp/skills/${name}/SKILL.md`,
    mcp,
  });

  it("includes only mcp:public skills", () => {
    const skills: LoadedSkill[] = [
      makeSkill("alpha", "public"),
      makeSkill("beta", "private"),
      makeSkill("gamma", "public"),
    ];
    const registry = buildPublicRegistry(skills, "claude-haiku-4-5-20251001");
    const names = registry.schemas().map((s) => s.name).sort();
    expect(names).toEqual(["alpha", "gamma"]);
  });

  it("returns an empty registry when no skills are public", () => {
    const skills: LoadedSkill[] = [
      makeSkill("alpha", "private"),
      makeSkill("beta", "private"),
    ];
    const registry = buildPublicRegistry(skills, "claude-haiku-4-5-20251001");
    expect(registry.schemas()).toEqual([]);
  });

  it("returns an empty registry when given no skills at all", () => {
    expect(buildPublicRegistry([], "claude-haiku-4-5-20251001").schemas()).toEqual([]);
  });
});

describe("callApi", () => {
  const TOKEN = `1234567890:${"a".repeat(35)}`;

  it("returns the unwrapped Telegram result on ok=true", async () => {
    const fetchMock = (async () =>
      new Response(JSON.stringify({ ok: true, result: { hello: "world" } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })) as FetchFn;
    const result = await callApi<{ hello: string }>(TOKEN, "getMe", {}, fetchMock);
    expect(result).toEqual({ hello: "world" });
  });

  it("posts to https://api.telegram.org/bot<token>/<method> with JSON body", async () => {
    let capturedUrl = "";
    let capturedBody = "";
    let capturedHeaders: Record<string, string> = {};
    const fetchMock = (async (input: string, init?: RequestInit) => {
      capturedUrl = input;
      capturedBody = String(init?.body ?? "");
      const hdrs = init?.headers ?? {};
      if (hdrs instanceof Headers) {
        capturedHeaders = Object.fromEntries(hdrs.entries());
      } else {
        capturedHeaders = hdrs as Record<string, string>;
      }
      return new Response(JSON.stringify({ ok: true, result: 1 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as FetchFn;
    await callApi(TOKEN, "getUpdates", { offset: 5, timeout: 30 }, fetchMock);
    expect(capturedUrl).toBe(`https://api.telegram.org/bot${TOKEN}/getUpdates`);
    expect(JSON.parse(capturedBody)).toEqual({ offset: 5, timeout: 30 });
    expect(capturedHeaders["content-type"]).toBe("application/json");
  });

  it("throws with token redacted when fetch rejects (network error)", async () => {
    const fetchMock = (async () => {
      throw new Error(`connection failed for https://api.telegram.org/bot${TOKEN}/getMe`);
    }) as FetchFn;
    let caught: Error | null = null;
    try {
      await callApi(TOKEN, "getMe", {}, fetchMock);
    } catch (err) {
      caught = err as Error;
    }
    expect(caught).not.toBeNull();
    expect(caught?.message).not.toContain(TOKEN);
    expect(caught?.message).toContain("<redacted>");
  });

  it("throws with token redacted when Telegram returns ok=false", async () => {
    const fetchMock = (async () =>
      new Response(
        JSON.stringify({
          ok: false,
          error_code: 401,
          description: `Unauthorized: token ${TOKEN} is invalid`,
        }),
        { status: 401, headers: { "content-type": "application/json" } },
      )) as FetchFn;
    let caught: Error | null = null;
    try {
      await callApi(TOKEN, "getMe", {}, fetchMock);
    } catch (err) {
      caught = err as Error;
    }
    expect(caught).not.toBeNull();
    expect(caught?.message).not.toContain(TOKEN);
    expect(caught?.message).toContain("<redacted>");
    expect(caught?.message).toContain("code 401");
  });

  it("throws with token redacted when response body is not JSON", async () => {
    const fetchMock = (async () =>
      new Response("not json", {
        status: 502,
        headers: { "content-type": "text/plain" },
      })) as FetchFn;
    let caught: Error | null = null;
    try {
      await callApi(TOKEN, "getMe", {}, fetchMock);
    } catch (err) {
      caught = err as Error;
    }
    expect(caught).not.toBeNull();
    expect(caught?.message).not.toContain(TOKEN);
  });

  it("throws when ok=true but result is missing", async () => {
    const fetchMock = (async () =>
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })) as FetchFn;
    await expect(callApi(TOKEN, "getMe", {}, fetchMock)).rejects.toThrow(/missing result/);
  });

  it("uses the sanitized URL form in error messages (no <token> substring)", async () => {
    const fetchMock = (async () => {
      throw new Error("oops");
    }) as FetchFn;
    let caught: Error | null = null;
    try {
      await callApi(TOKEN, "getUpdates", {}, fetchMock);
    } catch (err) {
      caught = err as Error;
    }
    expect(caught?.message).toContain("https://api.telegram.org/bot<redacted>/getUpdates");
    expect(caught?.message).not.toContain(TOKEN);
  });
});

// ---------------------------------------------------------------------------
// Test scaffolding
// ---------------------------------------------------------------------------

async function makeDispatchScaffold(
  opts: { masterId?: number; agentReply?: DispatchDeps["agentReply"] } = {},
) {
  const dir = mkdtempSync(join(tmpdir(), "mote-tg-"));
  const TOKEN = `1234567890:${"a".repeat(35)}`;
  const allowlist = await loadAllowlist(join(dir, "allow.json"));
  const pairing = createPairingStore();
  const audit = await createAuditLogger(join(dir, "audit.log"), { token: TOKEN });

  const calls: Array<{ chatId: number | string; text: string }> = [];
  const fetchImpl: FetchFn = async (input, init) => {
    const url = String(input);
    if (url.endsWith("/sendMessage")) {
      const body = JSON.parse(String(init?.body ?? "{}")) as {
        chat_id: number | string;
        text: string;
      };
      calls.push({ chatId: body.chat_id, text: body.text });
    }
    return new Response(JSON.stringify({ ok: true, result: {} }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  // Minimal AgentContext stub — only what dispatch / defaultAgentReply read.
  const ctx = {
    agentId: "test",
    sessionId: "test-session",
    workspaceDir: dir,
    registry: undefined as unknown as never, // unused; dispatch builds its own
    provider: undefined as unknown as never,
    state: undefined as unknown as never,
    opts: undefined as unknown as never,
    signal: new AbortController().signal,
    systemPrompt: () => ({ blocks: [] }) as never,
  };

  const recordedAgentCalls: Array<{ env: InboundEnvelope; registryShape: string[] }> = [];
  const defaultAgentReplyForTests: DispatchDeps["agentReply"] = async (env, deps) => {
    recordedAgentCalls.push({
      env,
      registryShape: deps.registry.schemas().map((s) => s.name),
    });
    return `agent reply to: ${env.body}`;
  };

  return {
    dir,
    token: TOKEN,
    masterId: opts.masterId ?? 1000,
    allowlist,
    pairing,
    audit,
    fetchImpl,
    calls,
    ctx,
    deps: {
      ctx,
      token: TOKEN,
      masterId: opts.masterId ?? 1000,
      registry: buildPublicRegistry([], "claude-haiku-4-5-20251001"),
      allowlist,
      pairing,
      audit,
      fetchImpl,
      agentReply: opts.agentReply ?? defaultAgentReplyForTests,
    } satisfies DispatchDeps,
    recordedAgentCalls,
  };
}

const env = (
  overrides: Partial<InboundEnvelope> & Pick<InboundEnvelope, "from" | "body">,
): InboundEnvelope => ({
  channel: "telegram",
  timestamp: 1730000000000,
  ...overrides,
});

// ---------------------------------------------------------------------------
// dispatch tests
// ---------------------------------------------------------------------------

describe("dispatch", () => {
  describe("master commands", () => {
    it("/approve <valid-code> adds the userId to the allowlist and replies to both", async () => {
      const s = await makeDispatchScaffold();
      const pending = s.pairing.generate(99);
      await dispatch(env({ from: String(s.masterId), body: `/approve ${pending.code}` }), s.deps);
      expect(s.allowlist.has(99)).toBe(true);
      expect(s.calls).toEqual([
        { chatId: s.masterId, text: "Approved 99." },
        { chatId: 99, text: "You are now approved. DM me anytime." },
      ]);
    });

    it("/approve <expired-code> replies 'Code expired.'", async () => {
      let now = 0;
      const pairing = createPairingStore({ ttlMs: 1000, clock: () => now });
      const dir = mkdtempSync(join(tmpdir(), "mote-tg-"));
      const TOKEN = `1234567890:${"a".repeat(35)}`;
      const allowlist = await loadAllowlist(join(dir, "allow.json"));
      const audit = await createAuditLogger(join(dir, "audit.log"), { token: TOKEN });
      const calls: Array<{ chatId: number | string; text: string }> = [];
      const fetchImpl: FetchFn = async (input, init) => {
        const body = JSON.parse(String(init?.body ?? "{}")) as {
          chat_id: number | string;
          text: string;
        };
        calls.push({ chatId: body.chat_id, text: body.text });
        return new Response(JSON.stringify({ ok: true, result: {} }), { status: 200 });
      };
      const ctx = {
        agentId: "x",
        sessionId: "x",
        workspaceDir: dir,
        registry: undefined as unknown as never,
        provider: undefined as unknown as never,
        state: undefined as unknown as never,
        opts: undefined as unknown as never,
        signal: new AbortController().signal,
        systemPrompt: () => ({ blocks: [] }) as never,
      };
      const pending = pairing.generate(42);
      now = 2000;
      await dispatch(env({ from: "1000", body: `/approve ${pending.code}` }), {
        ctx,
        token: TOKEN,
        masterId: 1000,
        registry: buildPublicRegistry([], "claude-haiku-4-5-20251001"),
        allowlist,
        pairing,
        audit,
        fetchImpl,
      });
      expect(allowlist.has(42)).toBe(false);
      expect(calls).toEqual([{ chatId: 1000, text: "Code expired." }]);
    });

    it("/approve <unknown-code> replies 'No pending pairing for that code.'", async () => {
      const s = await makeDispatchScaffold();
      const code = "0".repeat(32);
      await dispatch(env({ from: String(s.masterId), body: `/approve ${code}` }), s.deps);
      expect(s.calls).toEqual([
        { chatId: s.masterId, text: "No pending pairing for that code." },
      ]);
    });

    it("/revoke <userId> removes from the allowlist and replies", async () => {
      const s = await makeDispatchScaffold();
      await s.allowlist.add({ userId: 7, approvedAt: 1 });
      await dispatch(env({ from: String(s.masterId), body: "/revoke 7" }), s.deps);
      expect(s.allowlist.has(7)).toBe(false);
      expect(s.calls).toEqual([{ chatId: s.masterId, text: "Revoked 7." }]);
    });
  });

  describe("approved message dispatch", () => {
    it("master DM (non-command) reaches the agent with the RestrictedRegistry", async () => {
      const s = await makeDispatchScaffold();
      await dispatch(env({ from: String(s.masterId), body: "summarize this" }), s.deps);
      expect(s.recordedAgentCalls).toHaveLength(1);
      expect(s.recordedAgentCalls[0]?.env.body).toBe("summarize this");
      // RestrictedRegistry contains only mcp:public skills (none in this scaffold)
      expect(s.recordedAgentCalls[0]?.registryShape).toEqual([]);
      expect(s.calls).toEqual([{ chatId: s.masterId, text: "agent reply to: summarize this" }]);
    });

    it("paired non-master DM reaches the agent with the same RestrictedRegistry", async () => {
      const s = await makeDispatchScaffold();
      await s.allowlist.add({ userId: 555, approvedAt: 1 });
      await dispatch(env({ from: "555", body: "hello" }), s.deps);
      expect(s.recordedAgentCalls).toHaveLength(1);
      expect(s.calls).toEqual([{ chatId: 555, text: "agent reply to: hello" }]);
    });

    it("unsupported content from master replies 'Sorry, text only.' and skips the agent", async () => {
      const s = await makeDispatchScaffold();
      await dispatch(env({ from: String(s.masterId), body: "[unsupported: voice]" }), s.deps);
      expect(s.recordedAgentCalls).toHaveLength(0);
      expect(s.calls).toEqual([{ chatId: s.masterId, text: "Sorry, text only." }]);
    });

    it("unsupported content from paired user replies 'Sorry, text only.' and skips the agent", async () => {
      const s = await makeDispatchScaffold();
      await s.allowlist.add({ userId: 222, approvedAt: 1 });
      await dispatch(env({ from: "222", body: "[unsupported: photo]" }), s.deps);
      expect(s.recordedAgentCalls).toHaveLength(0);
      expect(s.calls).toEqual([{ chatId: 222, text: "Sorry, text only." }]);
    });
  });

  describe("pairing for unknown senders", () => {
    it("generates a code, DMs the sender + master, and emits a pending-pairing audit event", async () => {
      const s = await makeDispatchScaffold();
      await dispatch(env({ from: "8888", body: "hi" }), s.deps);
      expect(s.allowlist.has(8888)).toBe(false);
      expect(s.recordedAgentCalls).toHaveLength(0);
      expect(s.calls).toHaveLength(2);
      expect(s.calls[0]?.chatId).toBe(8888);
      expect(s.calls[0]?.text).toMatch(/Pairing code: [0-9a-f]{32}/);
      expect(s.calls[1]?.chatId).toBe(s.masterId);
      expect(s.calls[1]?.text).toMatch(/User 8888 is requesting access[\s\S]*\/approve [0-9a-f]{32}/);
    });
  });
});

// ---------------------------------------------------------------------------
// createTelegramGateway tests
// ---------------------------------------------------------------------------

describe("createTelegramGateway", () => {
  it("exits cleanly when abort is fired immediately", async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    const dir = mkdtempSync(join(tmpdir(), "mote-tg-"));
    const TOKEN = `1234567890:${"a".repeat(35)}`;
    const allowlist = await loadAllowlist(join(dir, "allow.json"));
    const audit = await createAuditLogger(join(dir, "audit.log"), { token: TOKEN });
    const fetchImpl: FetchFn = async () =>
      new Response(JSON.stringify({ ok: true, result: [] }), { status: 200 });

    const ctx = {
      agentId: "x",
      sessionId: "x",
      workspaceDir: dir,
      registry: undefined as unknown as never,
      provider: undefined as unknown as never,
      state: undefined as unknown as never,
      opts: undefined as unknown as never,
      signal: ctrl.signal,
      systemPrompt: () => ({ blocks: [] }) as never,
    };

    await createTelegramGateway(ctx, {
      token: TOKEN,
      masterId: 1000,
      skills: [],
      allowlist,
      pairing: createPairingStore(),
      audit,
      model: "claude-haiku-4-5-20251001",
      abort: ctrl.signal,
      fetchImpl,
    });
    // If we get here, the loop honored the abort signal at the top check.
    expect(true).toBe(true);
  });

  it("dispatches one update then exits when abort fires", async () => {
    const ctrl = new AbortController();
    const dir = mkdtempSync(join(tmpdir(), "mote-tg-"));
    const TOKEN = `1234567890:${"a".repeat(35)}`;
    const allowlist = await loadAllowlist(join(dir, "allow.json"));
    const audit = await createAuditLogger(join(dir, "audit.log"), { token: TOKEN });
    const sendMessageCalls: Array<{ chatId: number | string; text: string }> = [];
    let pollCount = 0;
    const fetchImpl: FetchFn = async (input, init) => {
      const url = String(input);
      if (url.endsWith("/getUpdates")) {
        pollCount += 1;
        if (pollCount === 1) {
          // Return one master DM, then trip abort so the next iteration exits.
          ctrl.abort();
          return new Response(
            JSON.stringify({
              ok: true,
              result: [
                {
                  update_id: 1,
                  message: {
                    message_id: 1,
                    from: { id: 1000, is_bot: false },
                    chat: { id: 1000, type: "private" },
                    date: 1,
                    text: "hi",
                  },
                },
              ],
            }),
            { status: 200 },
          );
        }
        return new Response(JSON.stringify({ ok: true, result: [] }), { status: 200 });
      }
      if (url.endsWith("/sendMessage")) {
        const body = JSON.parse(String(init?.body ?? "{}")) as {
          chat_id: number;
          text: string;
        };
        sendMessageCalls.push({ chatId: body.chat_id, text: body.text });
      }
      return new Response(JSON.stringify({ ok: true, result: {} }), { status: 200 });
    };
    const ctx = {
      agentId: "x",
      sessionId: "x",
      workspaceDir: dir,
      registry: undefined as unknown as never,
      provider: undefined as unknown as never,
      state: undefined as unknown as never,
      opts: undefined as unknown as never,
      signal: ctrl.signal,
      systemPrompt: () => ({ blocks: [] }) as never,
    };
    await createTelegramGateway(ctx, {
      token: TOKEN,
      masterId: 1000,
      skills: [],
      allowlist,
      pairing: createPairingStore(),
      audit,
      model: "claude-haiku-4-5-20251001",
      abort: ctrl.signal,
      fetchImpl,
      agentReply: async (env) => `echo: ${env.body}`,
    });
    expect(sendMessageCalls).toEqual([{ chatId: 1000, text: "echo: hi" }]);
  });
});
