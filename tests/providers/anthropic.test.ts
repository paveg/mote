import { test, expect, mock } from "bun:test";
import {
  createAnthropicProvider,
  toAnthropicBlock,
  fromAnthropicBlock,
  toAnthropicMessages,
  type AnthropicLike,
} from "@/providers/anthropic";
import type { Message, ContentBlock } from "@/core/types";

// --- pure converter tests --------------------------------------------------

test("toAnthropicBlock: text", () => {
  const b: ContentBlock = { type: "text", text: "hi" };
  expect(toAnthropicBlock(b)).toEqual({ type: "text", text: "hi" });
});

test("toAnthropicBlock: tool_use", () => {
  const b: ContentBlock = {
    type: "tool_use",
    id: "tu_1",
    name: "read_file",
    input: { path: "x.txt" },
  };
  expect(toAnthropicBlock(b)).toEqual({
    type: "tool_use",
    id: "tu_1",
    name: "read_file",
    input: { path: "x.txt" },
  });
});

test("toAnthropicBlock: tool_result with isError converts to is_error", () => {
  const b: ContentBlock = {
    type: "tool_result",
    toolUseId: "tu_1",
    content: "boom",
    isError: true,
  };
  expect(toAnthropicBlock(b)).toEqual({
    type: "tool_result",
    tool_use_id: "tu_1",
    content: "boom",
    is_error: true,
  });
});

test("toAnthropicBlock: tool_result without isError omits the field", () => {
  const b: ContentBlock = {
    type: "tool_result",
    toolUseId: "tu_1",
    content: "ok",
  };
  const out = toAnthropicBlock(b) as Record<string, unknown>;
  expect("is_error" in out).toBe(false);
});

test("toAnthropicBlock: thinking with signature passes through", () => {
  const b: ContentBlock = { type: "thinking", thinking: "hmm", signature: "sig123" };
  expect(toAnthropicBlock(b)).toEqual({
    type: "thinking",
    thinking: "hmm",
    signature: "sig123",
  });
});

test("fromAnthropicBlock: text", () => {
  expect(fromAnthropicBlock({ type: "text", text: "hi" })).toEqual({
    type: "text",
    text: "hi",
  });
});

test("fromAnthropicBlock: tool_use", () => {
  expect(
    fromAnthropicBlock({
      type: "tool_use",
      id: "tu_1",
      name: "echo",
      input: { x: 1 },
    }),
  ).toEqual({
    type: "tool_use",
    id: "tu_1",
    name: "echo",
    input: { x: 1 },
  });
});

test("fromAnthropicBlock: thinking with signature", () => {
  expect(
    fromAnthropicBlock({ type: "thinking", thinking: "hmm", signature: "sig" }),
  ).toEqual({ type: "thinking", thinking: "hmm", signature: "sig" });
});

test("fromAnthropicBlock: unknown type returns null (dropped silently)", () => {
  expect(fromAnthropicBlock({ type: "redacted_thinking", data: "..." })).toBeNull();
  expect(fromAnthropicBlock({ type: "server_tool_use" })).toBeNull();
  expect(fromAnthropicBlock(null)).toBeNull();
  expect(fromAnthropicBlock({})).toBeNull();
});

test("toAnthropicMessages filters out system-role messages", () => {
  const messages: Message[] = [
    { role: "user", content: [{ type: "text", text: "hi" }], createdAt: 0 },
    { role: "system", content: [{ type: "text", text: "ignore me" }], createdAt: 0 },
    { role: "assistant", content: [{ type: "text", text: "hello" }], createdAt: 0 },
  ];
  const out = toAnthropicMessages(messages);
  expect(out).toHaveLength(2);
  expect(out[0]?.role).toBe("user");
  expect(out[1]?.role).toBe("assistant");
});

// --- provider factory tests ------------------------------------------------

test("createAnthropicProvider throws when no apiKey is configured", () => {
  // Save and clear env vars
  const prev = {
    LLM_API_KEY: process.env["LLM_API_KEY"],
    ANTHROPIC_API_KEY: process.env["ANTHROPIC_API_KEY"],
  };
  delete process.env["LLM_API_KEY"];
  delete process.env["ANTHROPIC_API_KEY"];
  try {
    expect(() => createAnthropicProvider()).toThrow(/api key required/i);
  } finally {
    if (prev.LLM_API_KEY !== undefined) process.env["LLM_API_KEY"] = prev.LLM_API_KEY;
    if (prev.ANTHROPIC_API_KEY !== undefined)
      process.env["ANTHROPIC_API_KEY"] = prev.ANTHROPIC_API_KEY;
  }
});

test("createAnthropicProvider: client is honored when provided (no env needed)", async () => {
  const create = mock(async () => ({
    content: [{ type: "text", text: "from-stub" }],
    usage: { input_tokens: 5, output_tokens: 7 },
  }));
  const stub: AnthropicLike = { messages: { create } };
  const provider = createAnthropicProvider({ client: stub });

  const result = await provider.complete({
    model: "claude-sonnet-4-6",
    messages: [
      { role: "user", content: [{ type: "text", text: "hello" }], createdAt: 0 },
    ],
    tools: [],
    system: "you are mote",
  });

  expect(result.assistant.role).toBe("assistant");
  expect(result.assistant.content).toEqual([{ type: "text", text: "from-stub" }]);
  expect(result.toolCalls).toEqual([]);
  expect(result.usage).toEqual({ input: 5, output: 7 });
  expect(create).toHaveBeenCalledTimes(1);
});

test("complete: sends system as a cached text block when non-empty", async () => {
  let capturedParams: unknown;
  const create = mock(async (params: unknown) => {
    capturedParams = params;
    return {
      content: [{ type: "text", text: "ok" }],
      usage: { input_tokens: 1, output_tokens: 1 },
    };
  });
  const stub: AnthropicLike = { messages: { create } };
  const provider = createAnthropicProvider({ client: stub });

  await provider.complete({
    model: "claude-sonnet-4-6",
    messages: [],
    tools: [],
    system: "you are mote",
  });

  const params = capturedParams as { system?: unknown };
  expect(params.system).toEqual([
    { type: "text", text: "you are mote", cache_control: { type: "ephemeral" } },
  ]);
});

test("complete: omits system when empty string", async () => {
  let capturedParams: unknown;
  const create = mock(async (params: unknown) => {
    capturedParams = params;
    return {
      content: [{ type: "text", text: "ok" }],
      usage: { input_tokens: 1, output_tokens: 1 },
    };
  });
  const stub: AnthropicLike = { messages: { create } };
  const provider = createAnthropicProvider({ client: stub });

  await provider.complete({
    model: "claude-sonnet-4-6",
    messages: [],
    tools: [],
    system: "",
  });

  const params = capturedParams as { system?: unknown };
  expect(params.system).toBeUndefined();
});

test("complete: extracts toolCalls from assistant tool_use blocks", async () => {
  const create = mock(async () => ({
    content: [
      { type: "text", text: "let me check" },
      {
        type: "tool_use",
        id: "tu_1",
        name: "read_file",
        input: { path: "a.txt" },
      },
    ],
    usage: { input_tokens: 2, output_tokens: 3 },
  }));
  const stub: AnthropicLike = { messages: { create } };
  const provider = createAnthropicProvider({ client: stub });

  const result = await provider.complete({
    model: "claude-sonnet-4-6",
    messages: [],
    tools: [],
    system: "",
  });

  expect(result.toolCalls).toEqual([
    { id: "tu_1", name: "read_file", args: { path: "a.txt" } },
  ]);
});

test("complete: SystemPrompt array yields one cached block per section", async () => {
  let captured: unknown;
  const create = mock(async (params: unknown) => {
    captured = params;
    return {
      content: [{ type: "text", text: "ok" }],
      usage: { input_tokens: 1, output_tokens: 1 },
    };
  });
  const stub: AnthropicLike = { messages: { create } };
  const provider = createAnthropicProvider({ client: stub });

  await provider.complete({
    model: "claude-sonnet-4-6",
    messages: [],
    tools: [],
    system: [
      { text: "BASE", cache: true },
      { text: "PERSONA", cache: true },
      { text: "MEMORY", cache: true },
    ],
  });

  const params = captured as { system?: Array<{ text: string; cache_control?: unknown }> };
  expect(params.system).toHaveLength(3);
  for (const block of params.system!) {
    expect(block.cache_control).toEqual({ type: "ephemeral" });
  }
  expect(params.system![0]?.text).toBe("BASE");
  expect(params.system![1]?.text).toBe("PERSONA");
  expect(params.system![2]?.text).toBe("MEMORY");
});

test("complete: SystemPrompt array with cache:false omits cache_control on that section", async () => {
  let captured: unknown;
  const create = mock(async (params: unknown) => {
    captured = params;
    return {
      content: [{ type: "text", text: "ok" }],
      usage: { input_tokens: 1, output_tokens: 1 },
    };
  });
  const stub: AnthropicLike = { messages: { create } };
  const provider = createAnthropicProvider({ client: stub });

  await provider.complete({
    model: "claude-sonnet-4-6",
    messages: [],
    tools: [],
    system: [
      { text: "CACHED" },          // default: cache: true
      { text: "ALWAYS_FRESH", cache: false },
    ],
  });

  const params = captured as { system?: Array<{ cache_control?: unknown }> };
  expect(params.system![0]?.cache_control).toEqual({ type: "ephemeral" });
  expect(params.system![1]?.cache_control).toBeUndefined();
});

test("complete: sanitizes API errors — never echoes the API key", async () => {
  const SECRET = "sk-ant-test-fake-key-DO-NOT-LEAK";
  process.env["LLM_API_KEY"] = SECRET;
  try {
    const create = mock(async () => {
      // Simulate an Anthropic APIError shape duck-typed (we only need status + message).
      const e: Error & { status?: number } = Object.assign(
        new Error("rate limit exceeded"),
        { status: 429 },
      );
      throw e;
    });
    const stub: AnthropicLike = { messages: { create } };
    const provider = createAnthropicProvider({ apiKey: SECRET, client: stub });

    let caught: Error | null = null;
    try {
      await provider.complete({
        model: "claude-sonnet-4-6",
        messages: [],
        tools: [],
        system: "",
      });
    } catch (e) {
      caught = e as Error;
    }
    expect(caught).not.toBeNull();
    expect(caught!.message).not.toContain(SECRET);
    // Either the API-error format (status: message) or the generic wrapper —
    // both forms must omit the secret.
    expect(caught!.message).toMatch(/anthropic /);
  } finally {
    delete process.env["LLM_API_KEY"];
  }
});
