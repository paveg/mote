import { test, expect } from "bun:test";
import type {
  ToolSchema,
  CompletionRequest,
  CompletionResponse,
  Provider,
} from "@/providers/types";
import type { Message } from "@/core/types";

test("ToolSchema has name, description, input_schema", () => {
  const schema: ToolSchema = {
    name: "read_file",
    description: "Read a file from the workspace",
    input_schema: {
      type: "object",
      properties: { path: { type: "string" } },
      required: ["path"],
    },
  };
  expect(schema.name).toBe("read_file");
});

test("CompletionRequest carries model, messages, tools, system", () => {
  const req: CompletionRequest = {
    model: "claude-sonnet-4-6",
    messages: [],
    tools: [],
    system: "you are mote",
  };
  expect(req.system).toBe("you are mote");
});

test("CompletionResponse holds assistant message, tool calls, usage", () => {
  const assistant: Message = {
    role: "assistant",
    content: [{ type: "text", text: "ok" }],
    createdAt: 0,
  };
  const res: CompletionResponse = {
    assistant,
    toolCalls: [],
    usage: { input: 100, output: 50 },
  };
  expect(res.usage.input + res.usage.output).toBe(150);
});

test("Provider can be implemented as a mock", async () => {
  const mock: Provider = {
    async complete(_req) {
      return {
        assistant: { role: "assistant", content: [], createdAt: 0 },
        toolCalls: [],
        usage: { input: 0, output: 0 },
      };
    },
  };
  const res = await mock.complete({
    model: "test",
    messages: [],
    tools: [],
    system: "",
  });
  expect(res.toolCalls).toHaveLength(0);
});
