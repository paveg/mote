import { test, expect, mock } from "bun:test";
import * as v from "valibot";

import { ToolRegistry, type ToolDefinition } from "@/core/registry";
import type { AgentContext } from "@/core/context";
import type { ToolCall } from "@/core/types";

// Minimal AgentContext stub for handler dispatch. Cast through unknown
// because the test does not exercise unrelated context fields; handlers
// in these tests only read what they explicitly need.
const stubCtx = {} as unknown as AgentContext;

const echoTool: ToolDefinition<v.ObjectSchema<{ msg: v.StringSchema<undefined> }, undefined>> = {
  name: "echo",
  description: "echo the msg",
  schema: v.object({ msg: v.string() }),
  handler: async (args) => `echo: ${args.msg}`,
};

test("register stores a tool definition", () => {
  const reg = new ToolRegistry();
  reg.register(echoTool);
  expect(reg.schemas()).toHaveLength(1);
  expect(reg.schemas()[0]?.name).toBe("echo");
});

test("register throws on duplicate name", () => {
  const reg = new ToolRegistry();
  reg.register(echoTool);
  expect(() => reg.register(echoTool)).toThrow(/duplicate tool: echo/);
});

test("schemas() returns LLM-facing JSON Schema for each tool", () => {
  const reg = new ToolRegistry();
  reg.register(echoTool);
  const [schema] = reg.schemas();
  expect(schema?.name).toBe("echo");
  expect(schema?.description).toBe("echo the msg");
  // input_schema should be a JSON Schema object (we don't assert exact shape;
  // valibot/to-json-schema's output is an implementation detail).
  expect(schema?.input_schema).toBeTypeOf("object");
});

test("dispatch returns error string for unknown tool", async () => {
  const reg = new ToolRegistry();
  const call: ToolCall = { id: "1", name: "missing", args: {} };
  const result = await reg.dispatch(call, stubCtx);
  expect(result).toBe("[error] unknown tool: missing");
});

test("dispatch validates args via valibot before invoking handler", async () => {
  const reg = new ToolRegistry();
  const handlerSpy = mock(async () => "should not run");
  reg.register({
    name: "needs_msg",
    description: "needs a msg",
    schema: v.object({ msg: v.string() }),
    handler: handlerSpy,
  });

  // missing required field
  const call: ToolCall = { id: "1", name: "needs_msg", args: {} };
  const result = await reg.dispatch(call, stubCtx);

  expect(result).toMatch(/^\[error\] invalid args for needs_msg:/);
  expect(handlerSpy).not.toHaveBeenCalled();
});

test("dispatch passes the validated args to the handler", async () => {
  const reg = new ToolRegistry();
  reg.register(echoTool);
  const call: ToolCall = { id: "1", name: "echo", args: { msg: "hi" } };
  const result = await reg.dispatch(call, stubCtx);
  expect(result).toBe("echo: hi");
});

test("dispatch turns handler exceptions into error strings", async () => {
  const reg = new ToolRegistry();
  reg.register({
    name: "throws",
    description: "always throws",
    schema: v.object({}),
    handler: async () => {
      throw new Error("boom");
    },
  });
  const call: ToolCall = { id: "1", name: "throws", args: {} };
  const result = await reg.dispatch(call, stubCtx);
  expect(result).toBe("[error] boom");
});

// --- boundary: empty registry and invalid args shapes --------------------

test("schemas() returns [] for an empty registry", () => {
  const reg = new ToolRegistry();
  expect(reg.schemas()).toEqual([]);
});

test("dispatch rejects args:null and args:[] via valibot", async () => {
  const reg = new ToolRegistry();
  reg.register(echoTool);
  for (const badArgs of [null, [] as const]) {
    const result = await reg.dispatch(
      { id: "1", name: "echo", args: badArgs as unknown as Record<string, unknown> },
      stubCtx,
    );
    expect(result).toMatch(/^\[error\] invalid args for echo:/);
  }
});
