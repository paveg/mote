import { test, expect, mock } from "bun:test";
import {
  createOpenAICompatProvider,
  toOpenAIMessages,
  fromOpenAIMessage,
  toOpenAITool,
  parseArgsJSON,
} from "@/providers/openai-compat";
import type { Message } from "@/core/types";

// --- pure converter tests --------------------------------------------------

test("toOpenAIMessages prepends system prompt as a system message when non-empty", () => {
  const out = toOpenAIMessages([], "you are mote");
  expect(out).toEqual([{ role: "system", content: "you are mote" }]);
});

test("toOpenAIMessages omits the system message when system prompt is empty", () => {
  const out = toOpenAIMessages(
    [
      { role: "user", content: [{ type: "text", text: "hi" }], createdAt: 0 },
    ],
    "",
  );
  expect(out).toEqual([{ role: "user", content: "hi" }]);
});

test("toOpenAIMessages converts an assistant turn with text and tool_use", () => {
  const internal: Message[] = [
    {
      role: "assistant",
      content: [
        { type: "text", text: "let me check" },
        {
          type: "tool_use",
          id: "tu_1",
          name: "read_file",
          input: { path: "a.txt" },
        },
      ],
      createdAt: 0,
    },
  ];
  const out = toOpenAIMessages(internal, "");
  expect(out).toHaveLength(1);
  expect(out[0]?.role).toBe("assistant");
  expect(out[0]?.content).toBe("let me check");
  expect(out[0]?.tool_calls).toEqual([
    {
      id: "tu_1",
      type: "function",
      function: {
        name: "read_file",
        arguments: JSON.stringify({ path: "a.txt" }),
      },
    },
  ]);
});

test("toOpenAIMessages emits content:null for an assistant turn with only tool_use", () => {
  const internal: Message[] = [
    {
      role: "assistant",
      content: [
        {
          type: "tool_use",
          id: "tu_1",
          name: "x",
          input: {},
        },
      ],
      createdAt: 0,
    },
  ];
  const out = toOpenAIMessages(internal, "");
  expect(out[0]?.content).toBeNull();
  expect(out[0]?.tool_calls).toHaveLength(1);
});

test("toOpenAIMessages decomposes a user-role tool_result block into a role:tool message", () => {
  const internal: Message[] = [
    {
      role: "user",
      content: [
        {
          type: "tool_result",
          toolUseId: "tu_1",
          content: "file contents",
        },
      ],
      createdAt: 0,
    },
  ];
  const out = toOpenAIMessages(internal, "");
  expect(out).toEqual([
    { role: "tool", tool_call_id: "tu_1", content: "file contents" },
  ]);
});

test("toOpenAIMessages drops thinking blocks (no OpenAI equivalent)", () => {
  const internal: Message[] = [
    {
      role: "assistant",
      content: [
        { type: "thinking", thinking: "hmm", signature: "sig" },
        { type: "text", text: "answer" },
      ],
      createdAt: 0,
    },
  ];
  const out = toOpenAIMessages(internal, "");
  expect(out).toEqual([{ role: "assistant", content: "answer" }]);
});

test("toOpenAIMessages handles a user message with mixed text + tool_result correctly", () => {
  const internal: Message[] = [
    {
      role: "user",
      content: [
        { type: "tool_result", toolUseId: "tu_1", content: "ok" },
        { type: "text", text: "ack" },
      ],
      createdAt: 0,
    },
  ];
  const out = toOpenAIMessages(internal, "");
  // tool message comes from the tool_result; user message comes from the text.
  expect(out).toEqual([
    { role: "tool", tool_call_id: "tu_1", content: "ok" },
    { role: "user", content: "ack" },
  ]);
});

test("fromOpenAIMessage builds a text+tool_use Message from a tool-using assistant response", () => {
  const out = fromOpenAIMessage({
    role: "assistant",
    content: "looking up",
    tool_calls: [
      {
        id: "tu_1",
        type: "function",
        function: { name: "read_file", arguments: '{"path":"a.txt"}' },
      },
    ],
  });
  expect(out.role).toBe("assistant");
  expect(out.content).toEqual([
    { type: "text", text: "looking up" },
    {
      type: "tool_use",
      id: "tu_1",
      name: "read_file",
      input: { path: "a.txt" },
    },
  ]);
});

test("fromOpenAIMessage handles content:null with tool_calls only", () => {
  const out = fromOpenAIMessage({
    role: "assistant",
    content: null,
    tool_calls: [
      { id: "tu_1", type: "function", function: { name: "x", arguments: "{}" } },
    ],
  });
  expect(out.content).toEqual([
    { type: "tool_use", id: "tu_1", name: "x", input: {} },
  ]);
});

test("toOpenAITool wraps a ToolSchema in OpenAI function format", () => {
  const out = toOpenAITool({
    name: "read_file",
    description: "read",
    input_schema: { type: "object" },
  });
  expect(out).toEqual({
    type: "function",
    function: {
      name: "read_file",
      description: "read",
      parameters: { type: "object" },
    },
  });
});

test("parseArgsJSON returns parsed object for valid JSON", () => {
  expect(parseArgsJSON('{"a":1}')).toEqual({ a: 1 });
});

test("parseArgsJSON returns empty object for invalid JSON", () => {
  expect(parseArgsJSON("not json")).toEqual({});
});

test("parseArgsJSON returns empty object for valid non-object JSON", () => {
  expect(parseArgsJSON("[1,2,3]")).toEqual({});
  expect(parseArgsJSON("42")).toEqual({});
  expect(parseArgsJSON("null")).toEqual({});
});

// --- factory tests ---------------------------------------------------------

test("createOpenAICompatProvider throws when no API key is configured", () => {
  const prev = {
    LLM_API_KEY: process.env["LLM_API_KEY"],
    OPENAI_API_KEY: process.env["OPENAI_API_KEY"],
  };
  delete process.env["LLM_API_KEY"];
  delete process.env["OPENAI_API_KEY"];
  try {
    expect(() => createOpenAICompatProvider()).toThrow(/API key required/i);
  } finally {
    if (prev.LLM_API_KEY !== undefined) process.env["LLM_API_KEY"] = prev.LLM_API_KEY;
    if (prev.OPENAI_API_KEY !== undefined)
      process.env["OPENAI_API_KEY"] = prev.OPENAI_API_KEY;
  }
});

test("complete: sends a properly shaped request and parses a successful response", async () => {
  const captured: Array<{ url: string; init: RequestInit }> = [];
  const fakeFetch = mock(
    async (url: string | URL | Request, init?: RequestInit) => {
      captured.push({ url: String(url), init: init ?? {} });
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                role: "assistant",
                content: "hi back",
              },
              finish_reason: "stop",
            },
          ],
          usage: { prompt_tokens: 10, completion_tokens: 5 },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    },
  );

  const provider = createOpenAICompatProvider({
    apiKey: "sk-test",
    baseURL: "https://example.test/v1",
    fetch: fakeFetch as unknown as typeof globalThis.fetch,
  });

  const result = await provider.complete({
    model: "gpt-test",
    messages: [
      { role: "user", content: [{ type: "text", text: "hi" }], createdAt: 0 },
    ],
    tools: [],
    system: "you are mote",
  });

  expect(result.assistant.content).toEqual([{ type: "text", text: "hi back" }]);
  expect(result.toolCalls).toEqual([]);
  expect(result.usage).toEqual({ input: 10, output: 5 });
  expect(captured).toHaveLength(1);
  expect(captured[0]?.url).toBe("https://example.test/v1/chat/completions");
  const headers = captured[0]?.init.headers as Record<string, string>;
  expect(headers?.["Authorization"]).toBe("Bearer sk-test");
});

test("complete: extracts toolCalls from the assistant response", async () => {
  const fakeFetch = async () =>
    new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              role: "assistant",
              content: null,
              tool_calls: [
                {
                  id: "tu_1",
                  type: "function",
                  function: {
                    name: "read_file",
                    arguments: '{"path":"a.txt"}',
                  },
                },
              ],
            },
            finish_reason: "tool_calls",
          },
        ],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );

  const provider = createOpenAICompatProvider({
    apiKey: "sk-test",
    fetch: fakeFetch as unknown as typeof globalThis.fetch,
  });
  const result = await provider.complete({
    model: "gpt-test",
    messages: [],
    tools: [],
    system: "",
  });
  expect(result.toolCalls).toEqual([
    { id: "tu_1", name: "read_file", args: { path: "a.txt" } },
  ]);
});

test("complete: sanitizes API errors — never echoes the API key", async () => {
  const SECRET = "sk-leak-canary-DO-NOT-EXPOSE";
  const fakeFetch = async () =>
    new Response("Authentication failed", { status: 401 });
  const provider = createOpenAICompatProvider({
    apiKey: SECRET,
    fetch: fakeFetch as unknown as typeof globalThis.fetch,
  });

  let caught: Error | null = null;
  try {
    await provider.complete({
      model: "gpt-test",
      messages: [],
      tools: [],
      system: "",
    });
  } catch (e) {
    caught = e as Error;
  }
  expect(caught).not.toBeNull();
  expect(caught!.message).not.toContain(SECRET);
  expect(caught!.message).toMatch(/^openai-compat 401:/);
});

test("complete: wraps network errors with a generic prefix (no key leak)", async () => {
  const SECRET = "sk-leak-canary-2";
  const fakeFetch = async () => {
    throw new Error("ECONNREFUSED");
  };
  const provider = createOpenAICompatProvider({
    apiKey: SECRET,
    fetch: fakeFetch as unknown as typeof globalThis.fetch,
  });

  let caught: Error | null = null;
  try {
    await provider.complete({
      model: "gpt-test",
      messages: [],
      tools: [],
      system: "",
    });
  } catch (e) {
    caught = e as Error;
  }
  expect(caught).not.toBeNull();
  expect(caught!.message).not.toContain(SECRET);
  expect(caught!.message).toMatch(/^openai-compat request failed:/);
});

test("complete: includes tools in the request body when registry has tools", async () => {
  let capturedBody: string = "";
  const fakeFetch = async (_url: string | URL | Request, init?: RequestInit) => {
    capturedBody = init?.body as string;
    return new Response(
      JSON.stringify({
        choices: [{ message: { role: "assistant", content: "ok" } }],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      }),
      { status: 200 },
    );
  };
  const provider = createOpenAICompatProvider({
    apiKey: "sk-test",
    fetch: fakeFetch as unknown as typeof globalThis.fetch,
  });
  await provider.complete({
    model: "gpt-test",
    messages: [],
    tools: [
      {
        name: "read_file",
        description: "read",
        input_schema: { type: "object" },
      },
    ],
    system: "",
  });
  const parsed = JSON.parse(capturedBody) as {
    tools?: Array<{ type: string; function: { name: string } }>;
  };
  expect(parsed.tools).toHaveLength(1);
  expect(parsed.tools?.[0]?.type).toBe("function");
  expect(parsed.tools?.[0]?.function.name).toBe("read_file");
});

test("complete: SystemPrompt array is flattened to a single system message", async () => {
  let capturedBody: string = "";
  const fakeFetch = async (_url: string | URL | Request, init?: RequestInit) => {
    capturedBody = init?.body as string;
    return new Response(
      JSON.stringify({
        choices: [{ message: { role: "assistant", content: "ok" } }],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      }),
      { status: 200 },
    );
  };
  const provider = createOpenAICompatProvider({
    apiKey: "sk-test",
    fetch: fakeFetch as unknown as typeof globalThis.fetch,
  });
  await provider.complete({
    model: "gpt-test",
    messages: [],
    tools: [],
    system: [
      { text: "FIRST" },
      { text: "SECOND" },
    ],
  });
  const parsed = JSON.parse(capturedBody) as {
    messages: Array<{ role: string; content: string }>;
  };
  // First message must be the flattened system message
  expect(parsed.messages[0]?.role).toBe("system");
  expect(parsed.messages[0]?.content).toBe("FIRST\n\nSECOND");
});

test("complete: omits tools field when empty", async () => {
  let capturedBody: string = "";
  const fakeFetch = async (_url: string | URL | Request, init?: RequestInit) => {
    capturedBody = init?.body as string;
    return new Response(
      JSON.stringify({
        choices: [{ message: { role: "assistant", content: "ok" } }],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      }),
      { status: 200 },
    );
  };
  const provider = createOpenAICompatProvider({
    apiKey: "sk-test",
    fetch: fakeFetch as unknown as typeof globalThis.fetch,
  });
  await provider.complete({
    model: "gpt-test",
    messages: [],
    tools: [],
    system: "",
  });
  const parsed = JSON.parse(capturedBody) as { tools?: unknown };
  expect("tools" in parsed).toBe(false);
});

// --- boundary: content:null with no tool_calls ----------------------------

test("complete: response with content:null and no tool_calls produces empty content array", async () => {
  const fakeFetch = async () =>
    new Response(
      JSON.stringify({
        choices: [
          { message: { role: "assistant", content: null }, finish_reason: "stop" },
        ],
        usage: { prompt_tokens: 0, completion_tokens: 0 },
      }),
      { status: 200 },
    );
  const provider = createOpenAICompatProvider({
    apiKey: "sk-test",
    fetch: fakeFetch as unknown as typeof globalThis.fetch,
  });
  const result = await provider.complete({
    model: "gpt-test",
    messages: [],
    tools: [],
    system: "",
  });
  expect(result.assistant.content).toEqual([]);
  expect(result.toolCalls).toEqual([]);
  expect(result.usage).toEqual({ input: 0, output: 0 });
});
