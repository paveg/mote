import { test, expect } from "bun:test";
import type { AgentContext, SessionState } from "@/core/context";
import type { Message } from "@/core/types";

test("AgentContext can be constructed as an object literal satisfying the interface", () => {
  const noopState: SessionState = {
    async appendMessages(_messages) {
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
    async appendMessages(_messages: Message[]) {},
    async loadLatestSession() {
      return [];
    },
  };
  await state.appendMessages([]);
  expect(await state.loadLatestSession()).toEqual([]);
});
