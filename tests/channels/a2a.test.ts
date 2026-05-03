import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createA2aApp, buildLogRedactor } from "@/channels/a2a";
import { SqliteState } from "@/core/state";
import { ensureWorkspace } from "@/core/workspace";
import { ToolRegistry } from "@/core/registry";
import type { AgentContext } from "@/core/context";
import type { LoadedSkill } from "@/skills/types";
import type { Provider } from "@/providers/types";

// Minimum AgentContext stub for tests. The A2A executor calls runLoop
// which calls provider.complete — here we return a fixed response so the
// actual LLM is never contacted in unit tests.
const stubCtx = (workspaceDir: string, state: SqliteState): AgentContext => ({
  agentId: "default",
  sessionId: "s_test",
  workspaceDir,
  registry: new ToolRegistry(),
  provider: {
    complete: async () => ({
      assistant: {
        role: "assistant",
        content: [{ type: "text", text: "ok" }],
        createdAt: Date.now(),
      },
      toolCalls: [],
      usage: { input: 0, output: 0 },
    }),
  } satisfies Provider,
  state,
  opts: {
    maxIterations: 5,
    budget: { remaining: 100, deduct: () => {} },
  },
  signal: new AbortController().signal,
  systemPrompt: () => "",
});

const STRONG_TOKEN = "a".repeat(32) + "BCDE1234"; // 40 chars

let fakeHome: string;
let workspaceDir: string;
let state: SqliteState;

beforeEach(async () => {
  fakeHome = await mkdtemp(join(tmpdir(), "mote-a2a-test-"));
  workspaceDir = await ensureWorkspace("default", fakeHome);
  state = new SqliteState(workspaceDir);
});

afterEach(async () => {
  state.close();
  await rm(fakeHome, { recursive: true, force: true });
});

test("createA2aApp throws when MOTE_A2A_TOKEN is missing", () => {
  expect(() =>
    createA2aApp(stubCtx(workspaceDir, state), {
      skills: [],
      taskStore: state.a2aTaskStore,
    }),
  ).toThrow(/MOTE_A2A_TOKEN is required/);
});

test("createA2aApp throws when token is too short", () => {
  expect(() =>
    createA2aApp(stubCtx(workspaceDir, state), {
      skills: [],
      taskStore: state.a2aTaskStore,
      token: "short",
    }),
  ).toThrow(/at least 32 characters/);
});

test("createA2aApp throws on token containing a denylist substring (case-insensitive)", () => {
  // Short token: still fails on length check
  expect(() =>
    createA2aApp(stubCtx(workspaceDir, state), {
      skills: [],
      taskStore: state.a2aTaskStore,
      token: "password",
    }),
  ).toThrow(); // throws for length < 32

  // A token padded to 32 chars that CONTAINS "changeme" now also throws
  // because the denylist uses substring matching (M1 fix).
  const paddedWithDenylistSubstring = "changeme".padEnd(32, "X");
  expect(() =>
    createA2aApp(stubCtx(workspaceDir, state), {
      skills: [],
      taskStore: state.a2aTaskStore,
      token: paddedWithDenylistSubstring,
    }),
  ).toThrow(/denylist/i);
});

test("createA2aApp accepts a strong token and returns a Hono app", () => {
  const app = createA2aApp(stubCtx(workspaceDir, state), {
    skills: [],
    taskStore: state.a2aTaskStore,
    token: STRONG_TOKEN,
  });
  expect(typeof app.fetch).toBe("function");
});

test("agent card lists ONLY mcp: public skills", async () => {
  const skills: LoadedSkill[] = [
    { name: "open", description: "o", body: "", path: "/o", mcp: "public" },
    { name: "shut", description: "s", body: "", path: "/s", mcp: "private" },
  ];
  const app = createA2aApp(stubCtx(workspaceDir, state), {
    skills,
    taskStore: state.a2aTaskStore,
    token: STRONG_TOKEN,
  });
  const res = await app.request("/.well-known/agent-card.json");
  expect(res.status).toBe(200);
  const card = await res.json() as { skills: Array<{ id: string }> };
  const skillNames = card.skills.map(s => s.id);
  expect(skillNames).toContain("open");
  expect(skillNames).not.toContain("shut");
});

test("agent card endpoint requires no auth", async () => {
  const app = createA2aApp(stubCtx(workspaceDir, state), {
    skills: [],
    taskStore: state.a2aTaskStore,
    token: STRONG_TOKEN,
  });
  const res = await app.request("/.well-known/agent-card.json");
  expect(res.status).toBe(200);
});

test("JSON-RPC requests without Authorization header are rejected", async () => {
  const app = createA2aApp(stubCtx(workspaceDir, state), {
    skills: [],
    taskStore: state.a2aTaskStore,
    token: STRONG_TOKEN,
  });
  const res = await app.request("/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "1",
      method: "message/send",
      params: {
        message: {
          kind: "message",
          messageId: "msg_1",
          role: "user",
          parts: [{ kind: "text", text: "hi" }],
        },
      },
    }),
  });
  expect(res.status).toBeGreaterThanOrEqual(400);
});

// Token redaction canary: the bearer token must NEVER appear in any
// error response body (ADR-0011 D3).
test("REGRESSION: bearer token never appears in error response bodies", async () => {
  const CANARY = "CANARY-DO-NOT-LEAK-1234567890abcdefghij"; // 40 chars, no denylist substring
  const app = createA2aApp(stubCtx(workspaceDir, state), {
    skills: [],
    taskStore: state.a2aTaskStore,
    token: CANARY,
  });
  // Send a malformed request that triggers an error response
  const res = await app.request("/", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${CANARY}`,
    },
    body: "{ broken json",
  });
  const body = await res.text();
  expect(body).not.toContain(CANARY);
});

// ── F2: buildLogRedactor must actually mutate the Authorization header ──────

test("F2: buildLogRedactor replaces Authorization header with Bearer <redacted>", async () => {
  const TOKEN = "x".repeat(32);
  const capturedHeaders: Headers[] = [];

  // Build a minimal mock Hono Context with a mutable Headers object.
  const mutableHeaders = new Headers({ authorization: `Bearer ${TOKEN}` });
  const mockCtx = {
    req: {
      raw: {
        headers: mutableHeaders,
      },
    },
    set: () => {},
  } as unknown as import("hono").Context;

  const middleware = buildLogRedactor();
  await middleware(mockCtx, async () => {
    capturedHeaders.push(mockCtx.req.raw.headers);
  });

  expect(capturedHeaders.length).toBe(1);
  const authValue = capturedHeaders[0]?.get("authorization");
  expect(authValue).toBe("Bearer <redacted>");
  expect(authValue).not.toContain(TOKEN);
});

// ── F8: authMiddleware must use allowlist (protect all except agent card) ────

test("F8: rejects unauthenticated POST // (path-normalization bypass attempt)", async () => {
  const app = createA2aApp(stubCtx(workspaceDir, state), {
    skills: [],
    taskStore: state.a2aTaskStore,
    token: STRONG_TOKEN,
  });
  const res = await app.request("//", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  expect(res.status).toBe(401);
});

test("F8: rejects unauthenticated GET /v1/something (any non-agent-card route)", async () => {
  const app = createA2aApp(stubCtx(workspaceDir, state), {
    skills: [],
    taskStore: state.a2aTaskStore,
    token: STRONG_TOKEN,
  });
  const res = await app.request("/v1/something", {
    method: "GET",
  });
  expect(res.status).toBe(401);
});

test("F8: permits unauthenticated GET /.well-known/agent-card.json (already passed, stays green)", async () => {
  const app = createA2aApp(stubCtx(workspaceDir, state), {
    skills: [],
    taskStore: state.a2aTaskStore,
    token: STRONG_TOKEN,
  });
  const res = await app.request("/.well-known/agent-card.json");
  expect(res.status).toBe(200);
});

// ── M1: TOKEN_DENYLIST must use substring match ──────────────────────────────

test("M1: rejects MOTE_A2A_TOKEN that contains a denylisted substring at length 32+", () => {
  // "testtesttesttesttesttesttesttest" is 32 chars and contains "test"
  expect(() =>
    createA2aApp(stubCtx(workspaceDir, state), {
      skills: [],
      taskStore: state.a2aTaskStore,
      token: "testtesttesttesttesttesttesttest",
    }),
  ).toThrow(/denylist/i);
});

test("M1: rejects MOTE_A2A_TOKEN that contains 'changeme' as a substring", () => {
  // 32+ chars, contains "changeme"
  expect(() =>
    createA2aApp(stubCtx(workspaceDir, state), {
      skills: [],
      taskStore: state.a2aTaskStore,
      token: "changeme1234567890123456789012345",
    }),
  ).toThrow(/denylist/i);
});

test("M1: accepts a 32+ char token that doesn't match any denylisted substring", () => {
  // Use a random-looking token with no denylist substrings
  const safeToken = "Zq9mK2rX8vLpNw7bAcDe3FgHiJoUsY6T"; // 32 chars
  expect(() =>
    createA2aApp(stubCtx(workspaceDir, state), {
      skills: [],
      taskStore: state.a2aTaskStore,
      token: safeToken,
    }),
  ).not.toThrow();
});

// ── M2: a2a-worker must not mutate process.env ───────────────────────────────

test("M2: a2a-worker does not mutate process.env when handling a request", async () => {
  const worker = await import("@/entry/a2a-worker");

  // Save exact env state before the call.
  const keysBefore = new Set(Object.keys(process.env));
  const tokenBefore = process.env["MOTE_A2A_TOKEN"];
  const modelBefore = process.env["LLM_MODEL"];
  const apiKeyBefore = process.env["LLM_API_KEY"];

  const env = {
    MOTE_A2A_TOKEN: STRONG_TOKEN,
    LLM_API_KEY: "sk-test-key-for-unit-test",
    LLM_PROVIDER: "anthropic",
    LLM_MODEL: "claude-sonnet-4-6",
    LLM_BASE_URL: undefined,
    MOTE_A2A_URL: "http://localhost:8787",
    MOTE_A2A_MAX_BODY: undefined,
  };

  const req = new Request("http://localhost:8787/.well-known/agent-card.json");
  await worker.default.fetch(req, env as Parameters<typeof worker.default.fetch>[1]);

  // process.env must be bitwise identical to what it was before the call.
  expect(process.env["MOTE_A2A_TOKEN"]).toBe(tokenBefore);
  expect(process.env["LLM_MODEL"]).toBe(modelBefore);
  expect(process.env["LLM_API_KEY"]).toBe(apiKeyBefore);
  // No new keys added.
  const keysAfter = new Set(Object.keys(process.env));
  for (const key of keysAfter) {
    expect(keysBefore.has(key)).toBe(true);
  }
});
