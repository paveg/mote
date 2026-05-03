import { test, expect } from "bun:test";
import { createSkillToolDefinition } from "@/skills/handler";
import type { LoadedSkill } from "@/skills/types";
import type { Provider } from "@/providers/types";
import type { AgentContext } from "@/core/context";

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

  expect(result).toBe("hi from skill");
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
  expect(result).toBe("(skill produced no text output)");
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
  expect(result).toBe("part 1 part 2");
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
