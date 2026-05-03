import { test, expect, describe, it } from "bun:test";
import { createSkillToolDefinition } from "@/skills/handler";
import type { LoadedSkill } from "@/skills/types";
import type { Provider } from "@/providers/types";
import type { AgentContext } from "@/core/context";
import type { IterationBudget, Usage } from "@/core/types";

const skill: LoadedSkill = {
  name: "hello",
  description: "Say hello",
  body: "Reply with the literal text 'hi from skill'.",
  path: "/tmp/skills/hello/SKILL.md",
  mcp: "private",
};

const stubCtx = (provider: Provider): AgentContext =>
  ({
    agentId: "default",
    sessionId: "s_test",
    workspaceDir: "/tmp/test",
    registry: {} as AgentContext["registry"],
    provider,
    state: {
      async appendMessages(_s: string, _m: unknown[]) {},
      async loadLatestSession() { return []; },
      async searchSessions(_q: string, _l?: number) { return []; },
      async listSessions() { return []; },
      async getSession(_id: string, _limit: number) { return { messages: [], truncated: false }; },
    },
    opts: {
      maxIterations: 5,
      budget: { remaining: 100, deduct: () => {} },
    },
    signal: new AbortController().signal,
    systemPrompt: () => "irrelevant",
  }) as AgentContext;

test("createSkillToolDefinition surfaces the skill name + description on the ToolDefinition", () => {
  const provider: Provider = {
    complete: async () => ({
      assistant: { role: "assistant", content: [], createdAt: 0 },
      toolCalls: [],
      usage: { input: 0, output: 0 },
    }),
  };
  void provider;

  const def = createSkillToolDefinition(skill, { model: "claude-sonnet-4-6" });
  expect(def.name).toBe("hello");
  expect(def.description).toBe("Say hello");
});

test("handler sends skill.body as system, args as a user message, and no tools", async () => {
  let captured: any = null;
  const provider: Provider = {
    complete: async (req) => {
      captured = req;
      return {
        assistant: {
          role: "assistant",
          content: [{ type: "text", text: "hi from skill" }],
          createdAt: 0,
        },
        toolCalls: [],
        usage: { input: 1, output: 2 },
      };
    },
  };

  const def = createSkillToolDefinition(skill, { model: "claude-sonnet-4-6" });
  const result = await def.handler({ greeting: "hi" }, stubCtx(provider));

  expect(result).toBe('<skill-output skill="hello">\nhi from skill\n</skill-output>');
  expect(captured.system).toBe("Reply with the literal text 'hi from skill'.");
  expect(captured.tools).toEqual([]);
  expect(captured.model).toBe("claude-sonnet-4-6");
  expect(captured.messages).toHaveLength(1);
  expect(captured.messages[0].role).toBe("user");
  // The args object should appear in the user message text as JSON
  expect(captured.messages[0].content[0].text).toContain('"greeting": "hi"');
});

test("handler returns a placeholder string when the skill produces no text", async () => {
  const provider: Provider = {
    complete: async () => ({
      assistant: { role: "assistant", content: [], createdAt: 0 },
      toolCalls: [],
      usage: { input: 0, output: 0 },
    }),
  };
  const def = createSkillToolDefinition(skill, { model: "claude-sonnet-4-6" });
  const result = await def.handler({}, stubCtx(provider));
  expect(result).toBe('<skill-output skill="hello">\n(skill produced no text output)\n</skill-output>');
});

test("handler concatenates multiple text blocks", async () => {
  const provider: Provider = {
    complete: async () => ({
      assistant: {
        role: "assistant",
        content: [
          { type: "text", text: "part 1" },
          { type: "text", text: " " },
          { type: "text", text: "part 2" },
        ],
        createdAt: 0,
      },
      toolCalls: [],
      usage: { input: 0, output: 0 },
    }),
  };
  const def = createSkillToolDefinition(skill, { model: "claude-sonnet-4-6" });
  const result = await def.handler({}, stubCtx(provider));
  expect(result).toBe('<skill-output skill="hello">\npart 1 part 2\n</skill-output>');
});

test("handler uses generic prompt when args is empty", async () => {
  let captured: any = null;
  const provider: Provider = {
    complete: async (req) => {
      captured = req;
      return {
        assistant: {
          role: "assistant",
          content: [{ type: "text", text: "ok" }],
          createdAt: 0,
        },
        toolCalls: [],
        usage: { input: 0, output: 0 },
      };
    },
  };
  const def = createSkillToolDefinition(skill, { model: "claude-sonnet-4-6" });
  await def.handler({}, stubCtx(provider));
  expect(captured.messages[0].content[0].text).toBe("Execute the skill.");
});

// ── Helpers for F3/F5 tests ──────────────────────────────────────────────────

function makeTrackingBudget(initialRemaining: number): IterationBudget & { calls: Usage[] } {
  const calls: Usage[] = [];
  let remaining = initialRemaining;
  return {
    get remaining() { return remaining; },
    deduct(usage: Usage) {
      remaining -= usage.input + usage.output;
      calls.push(usage);
    },
    calls,
  };
}

function stubCtxWithBudget(provider: Provider, budget: IterationBudget): AgentContext {
  return {
    agentId: "default",
    sessionId: "s_test",
    workspaceDir: "/tmp/test",
    registry: {} as AgentContext["registry"],
    provider,
    state: {
      async appendMessages(_s: string, _m: unknown[]) {},
      async loadLatestSession() { return []; },
      async searchSessions(_q: string, _l?: number) { return []; },
      async listSessions() { return []; },
      async getSession(_id: string, _limit: number) { return { messages: [], truncated: false }; },
    },
    opts: {
      maxIterations: 5,
      budget,
    },
    signal: new AbortController().signal,
    systemPrompt: () => "irrelevant",
  } as AgentContext;
}

// ── F3: budget deduct + pre-check ─────────────────────────────────────────────

describe("createSkillToolDefinition — F3 budget", () => {
  it("calls ctx.opts.budget.deduct after a successful sub-call", async () => {
    const budget = makeTrackingBudget(1000);
    const provider: Provider = {
      complete: async () => ({
        assistant: { role: "assistant", content: [{ type: "text", text: "ok" }], createdAt: 0 },
        toolCalls: [],
        usage: { input: 100, output: 50 },
      }),
    };
    const def = createSkillToolDefinition(skill, { model: "claude-sonnet-4-6" });
    await def.handler({}, stubCtxWithBudget(provider, budget));
    expect(budget.calls).toHaveLength(1);
    expect(budget.calls[0]).toEqual({ input: 100, output: 50 });
    expect(budget.remaining).toBe(850);
  });

  it("returns [error] when budget.remaining <= 0 without invoking provider", async () => {
    const budget = makeTrackingBudget(0);
    let providerCalled = false;
    const provider: Provider = {
      complete: async () => {
        providerCalled = true;
        throw new Error("provider should not be called");
      },
    };
    const def = createSkillToolDefinition(skill, { model: "claude-sonnet-4-6" });
    const result = await def.handler({}, stubCtxWithBudget(provider, budget));
    expect(typeof result).toBe("string");
    expect((result as string).startsWith("[error]")).toBe(true);
    expect(providerCalled).toBe(false);
  });
});

// ── F5: output fence ──────────────────────────────────────────────────────────

describe("createSkillToolDefinition — F5 fence", () => {
  it('wraps the joined assistant text in <skill-output skill="name">', async () => {
    const budget = makeTrackingBudget(1000);
    const provider: Provider = {
      complete: async () => ({
        assistant: { role: "assistant", content: [{ type: "text", text: "hello world" }], createdAt: 0 },
        toolCalls: [],
        usage: { input: 1, output: 1 },
      }),
    };
    const def = createSkillToolDefinition(skill, { model: "claude-sonnet-4-6" });
    const result = await def.handler({}, stubCtxWithBudget(provider, budget));
    expect(result).toBe('<skill-output skill="hello">\nhello world\n</skill-output>');
  });

  it("uses the skill's own name in the fence (taken from LoadedSkill, not args)", async () => {
    const budget = makeTrackingBudget(1000);
    const provider: Provider = {
      complete: async () => ({
        assistant: { role: "assistant", content: [{ type: "text", text: "output" }], createdAt: 0 },
        toolCalls: [],
        usage: { input: 1, output: 1 },
      }),
    };
    const def = createSkillToolDefinition(skill, { model: "claude-sonnet-4-6" });
    // Pass an arg that could be confused for a skill name if the handler incorrectly used it
    const result = await def.handler({ skill: "evil" }, stubCtxWithBudget(provider, budget));
    // skill.name is "hello" — must appear in the fence, not "evil"
    expect((result as string)).toContain('skill="hello"');
    expect((result as string)).not.toContain('skill="evil"');
  });

  it("preserves the no-output fallback message inside the fence", async () => {
    const budget = makeTrackingBudget(1000);
    const provider: Provider = {
      complete: async () => ({
        assistant: { role: "assistant", content: [], createdAt: 0 },
        toolCalls: [],
        usage: { input: 1, output: 0 },
      }),
    };
    const def = createSkillToolDefinition(skill, { model: "claude-sonnet-4-6" });
    const result = await def.handler({}, stubCtxWithBudget(provider, budget));
    expect(result).toBe(
      '<skill-output skill="hello">\n(skill produced no text output)\n</skill-output>',
    );
  });
});
