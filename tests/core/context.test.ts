import { test, expect } from "bun:test";
import type { AgentContext, SessionState } from "@/core/context";
import type { Message } from "@/core/types";

test("AgentContext can be constructed as an object literal satisfying the interface", () => {
  const noopState: SessionState = {
    async appendMessages(_sessionId, _messages) {
      // noop for the type test
    },
    async loadLatestSession() {
      return [];
    },
  };

  // We do not need a working ToolRegistry / Provider for this test; we
  // assert only that the AgentContext shape compiles when fully populated.
  // `as unknown as AgentContext` is the explicit "this is a stub" idiom.
  const ctx = {
    agentId: "default",
    sessionId: "s_1",
    workspaceDir: "/tmp/mote-test/.mote/agents/default",
    registry: {} as AgentContext["registry"],
    provider: {} as AgentContext["provider"],
    state: noopState,
    opts: {
      maxIterations: 10,
      budget: { remaining: 100, deduct: () => {} },
    },
    signal: new AbortController().signal,
    systemPrompt: () => "you are mote",
  } satisfies AgentContext;

  expect(ctx.agentId).toBe("default");
  expect(typeof ctx.systemPrompt()).toBe("string");
});

test("SessionState round-trips an empty messages array", async () => {
  const state: SessionState = {
    async appendMessages(_sessionId: string, _messages: Message[]) {},
    async loadLatestSession() {
      return [];
    },
  };
  await state.appendMessages("s_1", []);
  expect(await state.loadLatestSession()).toEqual([]);
});

import { test as testCtx, expect as expectCtx, beforeEach as beforeEachCtx, afterEach as afterEachCtx } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join as joinCtx } from "node:path";
import { buildContext } from "@/core/context";
import type { Provider } from "@/providers/types";

let fakeHomeCtx: string;

beforeEachCtx(async () => {
  fakeHomeCtx = await mkdtemp(joinCtx(tmpdir(), "mote-buildctx-test-"));
});

afterEachCtx(async () => {
  await rm(fakeHomeCtx, { recursive: true, force: true });
});

const noopProvider: Provider = {
  complete: async () => ({
    assistant: { role: "assistant", content: [], createdAt: 0 },
    toolCalls: [],
    usage: { input: 0, output: 0 },
  }),
};

testCtx("buildContext creates the workspace, generates a sessionId, and wires the defaults", async () => {
  const ctx = await buildContext({ home: fakeHomeCtx, provider: noopProvider });

  expectCtx(ctx.agentId).toBe("default");
  expectCtx(ctx.sessionId).toMatch(/^s_/);
  expectCtx(ctx.workspaceDir).toBe(joinCtx(fakeHomeCtx, ".mote", "agents", "default"));
  expectCtx(ctx.opts.maxIterations).toBe(50);
  expectCtx(ctx.opts.budget.remaining).toBe(1_000_000);
  expectCtx(typeof ctx.systemPrompt()).toBe("string");
});

testCtx("buildContext registers read_file in the default registry", async () => {
  const ctx = await buildContext({ home: fakeHomeCtx, provider: noopProvider });
  const schemas = ctx.registry.schemas();
  expectCtx(schemas.map(s => s.name)).toContain("read_file");
});

testCtx("buildContext respects an injected registry (no read_file unless added)", async () => {
  const { ToolRegistry } = await import("@/core/registry");
  const customRegistry = new ToolRegistry();
  const ctx = await buildContext({
    home: fakeHomeCtx,
    provider: noopProvider,
    registry: customRegistry,
  });
  expectCtx(ctx.registry.schemas()).toEqual([]);
});

testCtx("buildContext budget.deduct subtracts input+output", async () => {
  const ctx = await buildContext({
    home: fakeHomeCtx,
    provider: noopProvider,
    initialBudget: 100,
  });
  ctx.opts.budget.deduct({ input: 30, output: 20 });
  expectCtx(ctx.opts.budget.remaining).toBe(50);
});

testCtx("buildContext respects custom systemPrompt and maxIterations", async () => {
  const ctx = await buildContext({
    home: fakeHomeCtx,
    provider: noopProvider,
    systemPrompt: () => "custom prompt",
    maxIterations: 5,
  });
  expectCtx(ctx.systemPrompt()).toBe("custom prompt");
  expectCtx(ctx.opts.maxIterations).toBe(5);
});

import { test as testProv, expect as expectProv, beforeEach as beforeEachProv, afterEach as afterEachProv } from "bun:test";
import { mkdtemp as mkdtempProv, rm as rmProv } from "node:fs/promises";
import { tmpdir as tmpdirProv } from "node:os";
import { join as joinProv } from "node:path";
import { buildContext as buildContextProv } from "@/core/context";

let fakeHomeProv: string;
let savedEnv: Record<string, string | undefined>;

beforeEachProv(async () => {
  fakeHomeProv = await mkdtempProv(joinProv(tmpdirProv(), "mote-provider-switch-"));
  savedEnv = {
    LLM_PROVIDER: process.env["LLM_PROVIDER"],
    LLM_API_KEY: process.env["LLM_API_KEY"],
    ANTHROPIC_API_KEY: process.env["ANTHROPIC_API_KEY"],
    OPENAI_API_KEY: process.env["OPENAI_API_KEY"],
  };
});

afterEachProv(async () => {
  await rmProv(fakeHomeProv, { recursive: true, force: true });
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

testProv("buildContext defaults to Anthropic when LLM_PROVIDER is unset", async () => {
  delete process.env["LLM_PROVIDER"];
  process.env["LLM_API_KEY"] = "sk-ant-test";

  const ctx = await buildContextProv({ home: fakeHomeProv });
  // Provider was constructed without throwing — that's the assertion.
  expectProv(ctx.provider).toBeDefined();
  expectProv(typeof ctx.provider.complete).toBe("function");
});

testProv("buildContext picks the OpenAI-compat provider when LLM_PROVIDER=openai-compat", async () => {
  process.env["LLM_PROVIDER"] = "openai-compat";
  process.env["LLM_API_KEY"] = "sk-oai-test";

  const ctx = await buildContextProv({ home: fakeHomeProv });
  expectProv(ctx.provider).toBeDefined();
  expectProv(typeof ctx.provider.complete).toBe("function");
});

testProv("buildContext throws on an unknown LLM_PROVIDER value", async () => {
  process.env["LLM_PROVIDER"] = "totally-bogus";
  process.env["LLM_API_KEY"] = "sk-anything";

  await expectProv(buildContextProv({ home: fakeHomeProv })).rejects.toThrow(
    /Unknown LLM_PROVIDER/,
  );
});

testProv("buildContext respects an injected provider regardless of LLM_PROVIDER", async () => {
  process.env["LLM_PROVIDER"] = "openai-compat"; // would normally try to construct openai-compat
  delete process.env["LLM_API_KEY"];
  delete process.env["OPENAI_API_KEY"];
  // Without a key, defaultProvider() would throw — but we inject one so it's not called.

  const injected = {
    complete: async () => ({
      assistant: { role: "assistant" as const, content: [], createdAt: 0 },
      toolCalls: [],
      usage: { input: 0, output: 0 },
    }),
  };
  const ctx = await buildContextProv({ home: fakeHomeProv, provider: injected });
  expectProv(ctx.provider).toBe(injected);
});
