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
    async searchSessions(_query, _limit) {
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
    async searchSessions(_query: string, _limit?: number) {
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
  // systemPrompt now returns SystemPrompt (string | SystemSection[])
  const promptResult = ctx.systemPrompt();
  const promptText = typeof promptResult === "string"
    ? promptResult
    : promptResult.map(s => s.text).join("\n\n");
  expectCtx(typeof promptText).toBe("string");
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

import { test as testM1, expect as expectM1, beforeEach as beforeEachM1, afterEach as afterEachM1 } from "bun:test";
import { mkdtemp as mkdtempM1, rm as rmM1, writeFile as writeFileM1, mkdir as mkdirM1 } from "node:fs/promises";
import { tmpdir as tmpdirM1 } from "node:os";
import { join as joinM1 } from "node:path";
import { buildContext as buildContextM1 } from "@/core/context";
import type { Provider as ProviderM1 } from "@/providers/types";

const noopProviderM1: ProviderM1 = {
  complete: async () => ({
    assistant: { role: "assistant", content: [], createdAt: 0 },
    toolCalls: [],
    usage: { input: 0, output: 0 },
  }),
};

let fakeHomeM1: string;

beforeEachM1(async () => {
  fakeHomeM1 = await mkdtempM1(joinM1(tmpdirM1(), "mote-m1-buildctx-"));
});

afterEachM1(async () => {
  await rmM1(fakeHomeM1, { recursive: true, force: true });
});

testM1("buildContext registers loaded skills alongside read_file in the default registry", async () => {
  const skillsDir = joinM1(fakeHomeM1, ".mote/agents/default/skills/hello");
  await mkdirM1(skillsDir, { recursive: true });
  await writeFileM1(
    joinM1(skillsDir, "SKILL.md"),
    `---\nname: hello\ndescription: Say hello\n---\nReply with hi.`,
  );

  const ctx = await buildContextM1({ home: fakeHomeM1, provider: noopProviderM1 });
  const names = ctx.registry.schemas().map((s) => s.name).sort();
  expectM1(names).toEqual(["hello", "memory_append", "memory_edit", "read_file", "search_sessions"]);
});

testM1("buildContext default systemPrompt includes SOUL.md when present", async () => {
  const dir = joinM1(fakeHomeM1, ".mote/agents/default");
  await mkdirM1(dir, { recursive: true });
  await writeFileM1(joinM1(dir, "SOUL.md"), "I value brevity.");

  const ctx = await buildContextM1({ home: fakeHomeM1, provider: noopProviderM1 });
  const promptResult = ctx.systemPrompt();
  const promptText = typeof promptResult === "string"
    ? promptResult
    : promptResult.map(s => s.text).join("\n\n");
  expectM1(promptText).toContain("You are mote");
  expectM1(promptText).toContain("I value brevity.");
});

testM1("buildContext default systemPrompt includes MEMORY.md when present", async () => {
  const dir = joinM1(fakeHomeM1, ".mote/agents/default");
  await mkdirM1(dir, { recursive: true });
  await writeFileM1(joinM1(dir, "MEMORY.md"), "User prefers tea over coffee.");

  const ctx = await buildContextM1({ home: fakeHomeM1, provider: noopProviderM1 });
  const promptResult = ctx.systemPrompt();
  const promptText = typeof promptResult === "string"
    ? promptResult
    : promptResult.map(s => s.text).join("\n\n");
  expectM1(promptText).toContain("User prefers tea over coffee.");
});

testM1("buildContext systemPrompt falls back to base when SOUL/MEMORY are absent", async () => {
  const ctx = await buildContextM1({ home: fakeHomeM1, provider: noopProviderM1 });
  const promptResult = ctx.systemPrompt();
  const promptText = typeof promptResult === "string"
    ? promptResult
    : promptResult.map(s => s.text).join("\n\n");
  expectM1(promptText).toBe("You are mote, a minimal personal AI agent.");
});

testM1("buildContext does NOT auto-register skills when an injected registry is provided", async () => {
  const skillsDir = joinM1(fakeHomeM1, ".mote/agents/default/skills/hello");
  await mkdirM1(skillsDir, { recursive: true });
  await writeFileM1(
    joinM1(skillsDir, "SKILL.md"),
    `---\nname: hello\ndescription: Say hello\n---\nbody`,
  );

  const { ToolRegistry } = await import("@/core/registry");
  const customRegistry = new ToolRegistry();
  const ctx = await buildContextM1({
    home: fakeHomeM1,
    provider: noopProviderM1,
    registry: customRegistry,
  });
  expectM1(ctx.registry.schemas()).toEqual([]);
});

import { test as testM2, expect as expectM2, beforeEach as beforeEachM2, afterEach as afterEachM2 } from "bun:test";
import { mkdtemp as mkdtempM2, rm as rmM2 } from "node:fs/promises";
import { tmpdir as tmpdirM2 } from "node:os";
import { join as joinM2 } from "node:path";
import { buildContext as buildContextM2 } from "@/core/context";
import type { Provider as ProviderM2 } from "@/providers/types";

const noopProviderM2: ProviderM2 = {
  complete: async () => ({
    assistant: { role: "assistant", content: [], createdAt: 0 },
    toolCalls: [],
    usage: { input: 0, output: 0 },
  }),
};

let fakeHomeM2: string;

beforeEachM2(async () => {
  fakeHomeM2 = await mkdtempM2(joinM2(tmpdirM2(), "mote-m2-buildctx-"));
});

afterEachM2(async () => {
  await rmM2(fakeHomeM2, { recursive: true, force: true });
});

testM2("buildContext registers search_sessions in the default registry", async () => {
  const ctx = await buildContextM2({ home: fakeHomeM2, provider: noopProviderM2 });
  const names = ctx.registry.schemas().map(s => s.name).sort();
  expectM2(names).toContain("search_sessions");
});

import { test as testM2b, expect as expectM2b, beforeEach as beforeEachM2b, afterEach as afterEachM2b } from "bun:test";
import { mkdtemp as mkdtempM2b, rm as rmM2b } from "node:fs/promises";
import { tmpdir as tmpdirM2b } from "node:os";
import { join as joinM2b } from "node:path";
import { buildContext as buildContextM2b } from "@/core/context";
import type { Provider as ProviderM2b } from "@/providers/types";

const noopProviderM2b: ProviderM2b = {
  complete: async () => ({
    assistant: { role: "assistant", content: [], createdAt: 0 },
    toolCalls: [],
    usage: { input: 0, output: 0 },
  }),
};

let fakeHomeM2b: string;
beforeEachM2b(async () => {
  fakeHomeM2b = await mkdtempM2b(joinM2b(tmpdirM2b(), "mote-m2b-buildctx-"));
});
afterEachM2b(async () => {
  await rmM2b(fakeHomeM2b, { recursive: true, force: true });
});

testM2b("buildContext registers memory_append and memory_edit by default", async () => {
  const ctx = await buildContextM2b({ home: fakeHomeM2b, provider: noopProviderM2b });
  const names = ctx.registry.schemas().map(s => s.name);
  expectM2b(names).toContain("memory_append");
  expectM2b(names).toContain("memory_edit");
});

testM2b("buildContext exposes a MemoryNudge with default interval 10", async () => {
  const ctx = await buildContextM2b({ home: fakeHomeM2b, provider: noopProviderM2b });
  expectM2b(ctx.memoryNudge).toBeDefined();
  // Internal: fire 9 times, expect null; 10th should fire
  for (let i = 0; i < 9; i++) expectM2b(ctx.memoryNudge!.shouldFire()).toBeNull();
  expectM2b(ctx.memoryNudge!.shouldFire()).not.toBeNull();
});

testM2b("buildContext respects opts.memoryNudgeInterval", async () => {
  const ctx = await buildContextM2b({
    home: fakeHomeM2b,
    provider: noopProviderM2b,
    memoryNudgeInterval: 2,
  });
  expectM2b(ctx.memoryNudge!.shouldFire()).toBeNull();
  expectM2b(ctx.memoryNudge!.shouldFire()).not.toBeNull();
});

testM2b("memoryNudgeInterval=0 disables the nudge", async () => {
  const ctx = await buildContextM2b({
    home: fakeHomeM2b,
    provider: noopProviderM2b,
    memoryNudgeInterval: 0,
  });
  for (let i = 0; i < 100; i++) {
    expectM2b(ctx.memoryNudge!.shouldFire()).toBeNull();
  }
});
