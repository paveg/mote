import type {
  CompletionRequest,
  CompletionResponse,
  Provider,
  SystemPrompt,
  ToolSchema,
} from "@/providers/types";
import type {
  ContentBlock,
  Message,
  ToolCall,
  Usage,
} from "@/core/types";

// Minimal interfaces for the OpenAI Chat Completions wire format.
// We only model the fields mote actually reads or writes; future
// streaming / vision / structured-output knobs are not in scope.

interface OpenAIToolDef {
  readonly type: "function";
  readonly function: {
    readonly name: string;
    readonly description: string;
    readonly parameters: object;
  };
}

interface OpenAIToolCall {
  readonly id: string;
  readonly type: "function";
  readonly function: {
    readonly name: string;
    readonly arguments: string; // JSON-stringified
  };
}

interface OpenAIMessage {
  readonly role: "system" | "user" | "assistant" | "tool";
  // OpenAI allows null when an assistant turn produces only tool_calls.
  readonly content?: string | null;
  readonly tool_calls?: ReadonlyArray<OpenAIToolCall>;
  readonly tool_call_id?: string;
}

interface OpenAIChatRequest {
  readonly model: string;
  readonly messages: ReadonlyArray<OpenAIMessage>;
  readonly tools?: ReadonlyArray<OpenAIToolDef>;
  readonly max_tokens: number;
}

interface OpenAIChatResponse {
  readonly choices: ReadonlyArray<{
    readonly message: {
      readonly role: "assistant";
      readonly content?: string | null;
      readonly tool_calls?: ReadonlyArray<OpenAIToolCall>;
    };
    readonly finish_reason?: string;
  }>;
  readonly usage: {
    readonly prompt_tokens: number;
    readonly completion_tokens: number;
  };
}

type FetchFn = typeof globalThis.fetch;

export interface OpenAICompatProviderOpts {
  apiKey?: string;
  baseURL?: string;
  maxTokens?: number;
  // Test seam: replace the global fetch.
  fetch?: FetchFn;
}

// OpenAI Chat Completions doesn't support cache_control — flatten sections
// to a single string joined by blank lines.
function flattenSystem(system: SystemPrompt): string {
  if (typeof system === "string") return system;
  return system.map(s => s.text).join("\n\n");
}

// Pure converter: internal Message[] → OpenAI message list.
// `system` param is prepended as a system message when non-empty.
//
// Mote-internal mid-conversation system messages collapse to OpenAI
// system messages too (concatenating their text blocks). thinking
// blocks are dropped (no OpenAI equivalent).
//
// A user message containing tool_result blocks is decomposed into
// individual `role: "tool"` messages — OpenAI requires one tool message
// per tool_call_id and does not allow tool_result blocks inside a
// user message.
export function toOpenAIMessages(
  internal: Message[],
  systemPrompt: string,
): OpenAIMessage[] {
  const out: OpenAIMessage[] = [];

  if (systemPrompt) {
    out.push({ role: "system", content: systemPrompt });
  }

  for (const msg of internal) {
    if (msg.role === "system") {
      const text = msg.content
        .filter(b => b.type === "text")
        .map(b => (b as { type: "text"; text: string }).text)
        .join("");
      if (text) out.push({ role: "system", content: text });
      continue;
    }

    if (msg.role === "assistant") {
      const texts: string[] = [];
      const toolCalls: OpenAIToolCall[] = [];
      for (const b of msg.content) {
        if (b.type === "text") {
          texts.push(b.text);
        } else if (b.type === "tool_use") {
          toolCalls.push({
            id: b.id,
            type: "function",
            function: {
              name: b.name,
              arguments: JSON.stringify(b.input),
            },
          });
        }
        // thinking blocks: dropped
      }
      const oa: OpenAIMessage = {
        role: "assistant",
        // null when only tool_calls and no text — OpenAI expects null,
        // not empty string, here.
        content: texts.length > 0 ? texts.join("") : null,
        ...(toolCalls.length > 0 && { tool_calls: toolCalls }),
      };
      out.push(oa);
      continue;
    }

    // user role: split into role:"tool" per tool_result + role:"user" per text
    const userTexts: string[] = [];
    for (const b of msg.content) {
      if (b.type === "text") {
        userTexts.push(b.text);
      } else if (b.type === "tool_result") {
        out.push({
          role: "tool",
          tool_call_id: b.toolUseId,
          content: b.content,
        });
      }
    }
    if (userTexts.length > 0) {
      out.push({ role: "user", content: userTexts.join("") });
    }
  }

  return out;
}

// Pure converter: OpenAI assistant message → internal Message.
// Tool-call args are JSON-parsed; malformed JSON → empty object so the
// caller can still observe the call while the validation layer rejects.
export function fromOpenAIMessage(
  msg: OpenAIChatResponse["choices"][number]["message"],
): Message {
  const blocks: ContentBlock[] = [];
  if (msg.content) {
    blocks.push({ type: "text", text: msg.content });
  }
  if (msg.tool_calls) {
    for (const tc of msg.tool_calls) {
      blocks.push({
        type: "tool_use",
        id: tc.id,
        name: tc.function.name,
        input: parseArgsJSON(tc.function.arguments),
      });
    }
  }
  return {
    role: "assistant",
    content: blocks,
    createdAt: Date.now(),
  };
}

export function toOpenAITool(t: ToolSchema): OpenAIToolDef {
  return {
    type: "function",
    function: {
      name: t.name,
      description: t.description,
      parameters: t.input_schema,
    },
  };
}

export function parseArgsJSON(s: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(s) as unknown;
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return {};
  } catch {
    return {};
  }
}

export function createOpenAICompatProvider(
  opts: OpenAICompatProviderOpts = {},
): Provider {
  const apiKey =
    opts.apiKey ??
    process.env["LLM_API_KEY"] ??
    process.env["OPENAI_API_KEY"];
  if (!apiKey) {
    throw new Error(
      "OpenAI-compatible API key required (set LLM_API_KEY or OPENAI_API_KEY).",
    );
  }
  const baseURL =
    opts.baseURL ?? process.env["LLM_BASE_URL"] ?? "https://api.openai.com/v1";
  const maxTokens = opts.maxTokens ?? 4096;
  const fetchFn: FetchFn = opts.fetch ?? globalThis.fetch.bind(globalThis);

  return {
    complete: async (req: CompletionRequest): Promise<CompletionResponse> => {
      const body: OpenAIChatRequest = {
        model: req.model,
        messages: toOpenAIMessages(req.messages, flattenSystem(req.system)),
        ...(req.tools.length > 0 && {
          tools: req.tools.map(toOpenAITool),
        }),
        max_tokens: maxTokens,
      };

      let response: Response;
      try {
        response = await fetchFn(`${baseURL}/chat/completions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify(body),
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        throw new Error(`openai-compat request failed: ${msg}`);
      }

      if (!response.ok) {
        // Read at most a small slice of the body for context. We deliberately
        // truncate rather than echoing the full response, which could in
        // theory contain echoed request headers / API key / etc.
        let snippet = "";
        try {
          const text = await response.text();
          snippet = text.slice(0, 200);
        } catch {
          snippet = response.statusText;
        }
        throw new Error(`openai-compat ${response.status}: ${snippet}`);
      }

      const data = (await response.json()) as OpenAIChatResponse;
      const choice = data.choices[0];
      if (!choice) {
        throw new Error("openai-compat: response had no choices");
      }

      const assistant = fromOpenAIMessage(choice.message);
      const toolCalls: ToolCall[] = (choice.message.tool_calls ?? []).map(
        tc => ({
          id: tc.id,
          name: tc.function.name,
          args: parseArgsJSON(tc.function.arguments),
        }),
      );
      const usage: Usage = {
        input: data.usage.prompt_tokens,
        output: data.usage.completion_tokens,
      };

      return { assistant, toolCalls, usage };
    },
  };
}
