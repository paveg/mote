import { test, expect } from "bun:test";
import type {
  Role,
  ContentBlock,
  Message,
  ToolCall,
  Usage,
  IterationBudget,
  RunOptions,
  RunResult,
} from "@/core/types";

test("Role accepts the three valid values", () => {
  const roles: Role[] = ["user", "assistant", "system"];
  expect(roles).toEqual(["user", "assistant", "system"]);
});

test("ContentBlock discriminates by `type`", () => {
  const blocks: ContentBlock[] = [
    { type: "text", text: "hello" },
    { type: "tool_use", id: "tu_1", name: "read_file", input: { path: "/tmp" } },
    { type: "tool_result", toolUseId: "tu_1", content: "ok" },
    { type: "thinking", thinking: "...", signature: "sig" },
  ];
  expect(blocks).toHaveLength(4);
  // exhaustive narrowing keeps tsc honest
  for (const block of blocks) {
    switch (block.type) {
      case "text":
        expect(typeof block.text).toBe("string");
        break;
      case "tool_use":
        expect(typeof block.id).toBe("string");
        break;
      case "tool_result":
        expect(typeof block.toolUseId).toBe("string");
        break;
      case "thinking":
        expect(typeof block.thinking).toBe("string");
        break;
    }
  }
});

test("Message holds a ContentBlock array", () => {
  const msg: Message = {
    role: "user",
    content: [{ type: "text", text: "hi" }],
    createdAt: 0,
  };
  expect(msg.content).toHaveLength(1);
});

test("ToolCall has id, name, args", () => {
  const call: ToolCall = {
    id: "tu_1",
    name: "read_file",
    args: { path: "/tmp" },
  };
  expect(call.name).toBe("read_file");
});

test("Usage has input and output", () => {
  const usage: Usage = { input: 100, output: 50 };
  expect(usage.input + usage.output).toBe(150);
});

test("IterationBudget is implementable as an object literal", () => {
  let remaining = 5;
  const budget: IterationBudget = {
    get remaining() {
      return remaining;
    },
    deduct(_usage) {
      remaining -= 1;
    },
  };
  budget.deduct({ input: 0, output: 0 });
  expect(budget.remaining).toBe(4);
});

test("RunOptions and RunResult shapes", () => {
  const opts: RunOptions = {
    maxIterations: 10,
    budget: { remaining: 100, deduct: () => {} },
  };
  const result: RunResult = { messages: [], iter: 0 };
  expect(opts.maxIterations).toBe(10);
  expect(result.iter).toBe(0);
});
