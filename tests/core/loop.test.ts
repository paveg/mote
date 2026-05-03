import { test, expect, mock, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runLoop } from "@/core/loop";
import { ToolRegistry } from "@/core/registry";
import { SqliteState } from "@/core/state";
import { ensureWorkspace } from "@/core/workspace";
import * as v from "valibot";
import type { AgentContext } from "@/core/context";
import type {
  CompletionRequest,
  CompletionResponse,
  Provider,
} from "@/providers/types";
import type { Message, IterationBudget, Usage } from "@/core/types";

let fakeHome: string;
let workspaceDir: string;

beforeEach(async () => {
  fakeHome = await mkdtemp(join(tmpdir(), "mote-loop-test-"));
  workspaceDir = await ensureWorkspace("default", fakeHome);
});

afterEach(async () => {
  await rm(fakeHome, { recursive: true, force: true });
});

// Mutable budget for test inspection.
function makeBudget(initial = 1_000_000): IterationBudget & {
  spent: Usage[];
} {
  let remaining = initial;
  const spent: Usage[] = [];
  return {
    get remaining() {
      return remaining;
    },
    deduct: (usage: Usage) => {
      spent.push(usage);
      remaining -= usage.input + usage.output;
    },
    spent,
  };
}

// Builds a Provider whose complete() returns a queued sequence of responses.
function scriptedProvider(responses: CompletionResponse[]): Provider & {
  calls: CompletionRequest[];
} {
  const calls: CompletionRequest[] = [];
  let i = 0;
  const provider: Provider = {
    complete: async (req) => {
      calls.push(req);
      const next = responses[i++];
      if (!next) throw new Error("scripted provider: ran out of responses");
      return next;
    },
  };
  return Object.assign(provider, { calls });
}

function makeContext(
  override: Partial<AgentContext> & {
    provider: Provider;
    registry?: ToolRegistry;
    budget?: IterationBudget;
    signal?: AbortSignal;
    maxIterations?: number;
  },
): AgentContext {
  const registry = override.registry ?? new ToolRegistry();
  const budget = override.budget ?? makeBudget();
  const signal = override.signal ?? new AbortController().signal;
  const state = new SqliteState(workspaceDir);
  return {
    agentId: "default",
    sessionId: "s_test",
    workspaceDir,
    registry,
    state,
    opts: {
      maxIterations: override.maxIterations ?? 10,
      budget,
    },
    signal,
    systemPrompt: () => "you are mote",
    ...override,
  } as AgentContext;
}

const textMessage = (role: "assistant" | "user", text: string): Message => ({
  role,
  content: [{ type: "text", text }],
  createdAt: 0,
});

// --- happy paths ---------------------------------------------------------

test("runLoop returns immediately when the assistant produces no tool calls", async () => {
  const provider = scriptedProvider([
    {
      assistant: textMessage("assistant", "hello"),
      toolCalls: [],
      usage: { input: 5, output: 3 },
    },
  ]);
  const ctx = makeContext({ provider });

  const result = await runLoop([textMessage("user", "hi")], ctx);

  expect(result.iter).toBe(0); // loop never increments because tool calls were empty
  expect(result.messages).toHaveLength(2); // initial user + assistant
  const last = result.messages[result.messages.length - 1];
  if (!last || last.content[0]?.type !== "text") throw new Error("bad shape");
  expect(last.content[0].text).toBe("hello");
  expect(provider.calls).toHaveLength(1);
});

test("runLoop dispatches a tool call, feeds the result back, and ends on the next no-tool turn", async () => {
  const registry = new ToolRegistry();
  registry.register({
    name: "echo",
    description: "echo",
    schema: v.object({ msg: v.string() }),
    handler: async (args) => `echo:${args.msg}`,
  });

  const provider = scriptedProvider([
    {
      assistant: {
        role: "assistant",
        content: [
          {
            type: "tool_use",
            id: "tu_1",
            name: "echo",
            input: { msg: "ping" },
          },
        ],
        createdAt: 0,
      },
      toolCalls: [{ id: "tu_1", name: "echo", args: { msg: "ping" } }],
      usage: { input: 5, output: 5 },
    },
    {
      assistant: textMessage("assistant", "got pong"),
      toolCalls: [],
      usage: { input: 3, output: 4 },
    },
  ]);
  const ctx = makeContext({ provider, registry });

  const result = await runLoop([textMessage("user", "echo ping")], ctx);

  // sequence: [user, assistant(tool_use), user(tool_result), assistant(text)]
  expect(result.messages).toHaveLength(4);
  expect(result.iter).toBe(1);

  const toolResultMsg = result.messages[2];
  if (!toolResultMsg || toolResultMsg.content[0]?.type !== "tool_result")
    throw new Error("expected tool_result message at index 2");
  expect(toolResultMsg.content[0].toolUseId).toBe("tu_1");
  expect(toolResultMsg.content[0].content).toBe("echo:ping");

  expect(provider.calls).toHaveLength(2);
});

// --- stop conditions -----------------------------------------------------

test("runLoop stops at maxIterations even if the model keeps requesting tools", async () => {
  const registry = new ToolRegistry();
  registry.register({
    name: "echo",
    description: "echo",
    schema: v.object({}),
    handler: async () => "ok",
  });

  // Always return a tool call — the loop must stop us.
  const looper = (id: string) => ({
    assistant: {
      role: "assistant" as const,
      content: [
        { type: "tool_use" as const, id, name: "echo", input: {} },
      ],
      createdAt: 0,
    },
    toolCalls: [{ id, name: "echo", args: {} }],
    usage: { input: 1, output: 1 },
  });

  const provider = scriptedProvider([
    looper("tu_1"),
    looper("tu_2"),
    looper("tu_3"),
    looper("tu_4"), // should never be reached if maxIterations=3
  ]);
  const ctx = makeContext({ provider, maxIterations: 3 });

  const result = await runLoop([textMessage("user", "loop")], ctx);

  expect(result.iter).toBe(3);
  expect(provider.calls).toHaveLength(3);
});

test("runLoop stops when the budget is exhausted", async () => {
  const provider = scriptedProvider([
    {
      assistant: {
        role: "assistant",
        content: [
          { type: "tool_use", id: "tu_1", name: "x", input: {} },
        ],
        createdAt: 0,
      },
      toolCalls: [{ id: "tu_1", name: "x", args: {} }],
      usage: { input: 50, output: 50 }, // consumes the entire budget
    },
  ]);
  const registry = new ToolRegistry();
  registry.register({
    name: "x",
    description: "x",
    schema: v.object({}),
    handler: async () => "ok",
  });
  const budget = makeBudget(100);
  const ctx = makeContext({ provider, registry, budget });

  await runLoop([textMessage("user", "go")], ctx);

  // Provider was called once, budget was deducted to 0, loop did not call again.
  expect(provider.calls).toHaveLength(1);
});

test("runLoop stops when signal.aborted becomes true between iterations", async () => {
  const controller = new AbortController();
  const provider = scriptedProvider([
    {
      assistant: {
        role: "assistant",
        content: [
          { type: "tool_use", id: "tu_1", name: "x", input: {} },
        ],
        createdAt: 0,
      },
      toolCalls: [{ id: "tu_1", name: "x", args: {} }],
      usage: { input: 1, output: 1 },
    },
  ]);
  const registry = new ToolRegistry();
  registry.register({
    name: "x",
    description: "x",
    schema: v.object({}),
    handler: async () => {
      controller.abort();
      return "ok";
    },
  });
  const ctx = makeContext({ provider, registry, signal: controller.signal });

  const result = await runLoop([textMessage("user", "go")], ctx);

  // Provider called once. The handler aborted; the second iteration's while
  // condition trips on signal.aborted and the loop exits.
  expect(provider.calls).toHaveLength(1);
  expect(result.iter).toBe(1);
});

// --- error path: registry returns a string error, loop forwards it -------

test("runLoop forwards registry error strings as tool_result content (no throw)", async () => {
  const provider = scriptedProvider([
    {
      assistant: {
        role: "assistant",
        content: [
          {
            type: "tool_use",
            id: "tu_1",
            name: "missing",
            input: {},
          },
        ],
        createdAt: 0,
      },
      toolCalls: [{ id: "tu_1", name: "missing", args: {} }],
      usage: { input: 1, output: 1 },
    },
    {
      assistant: textMessage("assistant", "noted"),
      toolCalls: [],
      usage: { input: 1, output: 1 },
    },
  ]);
  const ctx = makeContext({ provider });

  const result = await runLoop([textMessage("user", "try missing tool")], ctx);

  const toolResultMsg = result.messages[2];
  if (!toolResultMsg || toolResultMsg.content[0]?.type !== "tool_result")
    throw new Error("expected tool_result");
  expect(toolResultMsg.content[0].content).toMatch(/^\[error\] unknown tool: missing/);
  expect(result.iter).toBe(1);
});

// --- persistence path ----------------------------------------------------

test("runLoop appends each new message to state immediately", async () => {
  const provider = scriptedProvider([
    {
      assistant: textMessage("assistant", "hello"),
      toolCalls: [],
      usage: { input: 1, output: 1 },
    },
  ]);
  const ctx = makeContext({ provider });

  await runLoop([textMessage("user", "hi")], ctx);

  // Reload from disk and confirm the assistant message landed
  const reloaded = await ctx.state.loadLatestSession();
  expect(reloaded).toHaveLength(1); // initial user message was caller's; loop only persists what the model produced
  const block = reloaded[0]?.content[0];
  if (!block || block.type !== "text") throw new Error("expected text");
  expect(block.text).toBe("hello");
});

// --- memory nudge --------------------------------------------------------

import { MemoryNudge as MemoryNudgeForLoop } from "@/core/memory-nudge";

test("runLoop injects a system-role nudge message at the configured interval", async () => {
  const looper = (id: string) => ({
    assistant: {
      role: "assistant" as const,
      content: [{ type: "tool_use" as const, id, name: "echo", input: {} }],
      createdAt: 0,
    },
    toolCalls: [{ id, name: "echo", args: {} }],
    usage: { input: 1, output: 1 },
  });
  const provider = scriptedProvider([
    looper("tu_1"),
    looper("tu_2"),
    {
      assistant: textMessage("assistant", "done"),
      toolCalls: [],
      usage: { input: 1, output: 1 },
    },
  ]);

  const registry = new ToolRegistry();
  registry.register({
    name: "echo",
    description: "echo",
    schema: v.object({}),
    handler: async () => "ok",
  });

  const baseCtx = makeContext({ provider, registry, maxIterations: 10 });
  const ctxWithNudge: typeof baseCtx = {
    ...baseCtx,
    memoryNudge: new MemoryNudgeForLoop(2),
  };

  const result = await runLoop(
    [textMessage("user", "trigger nudge")],
    ctxWithNudge,
  );

  // After 2 completed iterations, a system-role nudge message should
  // be present. The assistant's third response is the natural-end turn.
  const systemMessages = result.messages.filter(m => m.role === "system");
  expect(systemMessages.length).toBeGreaterThanOrEqual(1);
  const block = systemMessages[0]?.content[0];
  if (!block || block.type !== "text") throw new Error("expected text block");
  expect(block.text).toContain("memory_append");
});

test("runLoop does NOT inject a nudge when no MemoryNudge is configured", async () => {
  const provider = scriptedProvider([
    {
      assistant: textMessage("assistant", "no tools"),
      toolCalls: [],
      usage: { input: 1, output: 1 },
    },
  ]);
  const ctx = makeContext({ provider });
  const result = await runLoop([textMessage("user", "hi")], ctx);
  expect(result.messages.filter(m => m.role === "system")).toHaveLength(0);
});

// --- boundary: maxIterations 0/1, initial=[], budget edge cases -----------

test("runLoop with maxIterations:0 returns immediately without calling the provider", async () => {
  const provider = scriptedProvider([]); // empty — fail if accessed
  const ctx = makeContext({ provider, maxIterations: 0 });
  const result = await runLoop([textMessage("user", "hi")], ctx);
  expect(result.iter).toBe(0);
  expect(result.messages).toHaveLength(1); // only the initial user message
  expect(provider.calls).toHaveLength(0);
});

test("runLoop with maxIterations:1 fires exactly once when the model keeps requesting tools", async () => {
  const registry = new ToolRegistry();
  registry.register({
    name: "x",
    description: "x",
    schema: v.object({}),
    handler: async () => "ok",
  });
  const provider = scriptedProvider([
    {
      assistant: {
        role: "assistant",
        content: [{ type: "tool_use", id: "tu_1", name: "x", input: {} }],
        createdAt: 0,
      },
      toolCalls: [{ id: "tu_1", name: "x", args: {} }],
      usage: { input: 1, output: 1 },
    },
  ]);
  const ctx = makeContext({ provider, registry, maxIterations: 1 });
  const result = await runLoop([textMessage("user", "go")], ctx);
  expect(result.iter).toBe(1);
  expect(provider.calls).toHaveLength(1);
});

test("runLoop accepts an empty initial message array", async () => {
  const provider = scriptedProvider([
    {
      assistant: textMessage("assistant", "hi"),
      toolCalls: [],
      usage: { input: 1, output: 1 },
    },
  ]);
  const ctx = makeContext({ provider });
  const result = await runLoop([], ctx);
  expect(result.iter).toBe(0);
  expect(result.messages).toHaveLength(1);
  expect(result.messages[0]?.role).toBe("assistant");
});

test("runLoop with budget.remaining=0 at entry never calls the provider", async () => {
  const provider = scriptedProvider([]);
  const budget = makeBudget(0);
  const ctx = makeContext({ provider, budget });
  const result = await runLoop([textMessage("user", "hi")], ctx);
  expect(result.iter).toBe(0);
  expect(provider.calls).toHaveLength(0);
});

test("runLoop stops once budget goes negative after a deduction", async () => {
  const registry = new ToolRegistry();
  registry.register({
    name: "x",
    description: "x",
    schema: v.object({}),
    handler: async () => "ok",
  });
  const provider = scriptedProvider([
    {
      assistant: {
        role: "assistant",
        content: [{ type: "tool_use", id: "tu_1", name: "x", input: {} }],
        createdAt: 0,
      },
      toolCalls: [{ id: "tu_1", name: "x", args: {} }],
      usage: { input: 60, output: 0 }, // takes remaining 50 below 0
    },
  ]);
  const budget = makeBudget(50);
  const ctx = makeContext({ provider, registry, budget });
  await runLoop([textMessage("user", "go")], ctx);
  expect(provider.calls).toHaveLength(1); // first call ran, but loop exits before second
});
