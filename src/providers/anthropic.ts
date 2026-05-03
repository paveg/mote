import Anthropic from "@anthropic-ai/sdk";
import type { ContentBlock, Message } from "@/core/types";
import type { CompletionRequest, CompletionResponse, Provider, SystemPrompt } from "@/providers/types";

// Minimal interface our provider consumes from the SDK client.
// Tests pass a fake of this shape; production passes the real `new Anthropic(...)`.
export interface AnthropicLike {
  messages: {
    create(params: unknown): Promise<unknown>;
  };
}

export interface AnthropicProviderOpts {
  apiKey?: string;
  baseURL?: string;
  maxTokens?: number;
  // Test seam: a pre-built client. Production callers omit this.
  client?: AnthropicLike;
}

// Internal → Anthropic (request)
export function toAnthropicBlock(block: ContentBlock): unknown {
  switch (block.type) {
    case "text":
      return { type: "text", text: block.text };
    case "tool_use":
      return { type: "tool_use", id: block.id, name: block.name, input: block.input };
    case "tool_result": {
      const out: Record<string, unknown> = {
        type: "tool_result",
        tool_use_id: block.toolUseId,
        content: block.content,
      };
      if (block.isError !== undefined) out["is_error"] = block.isError;
      return out;
    }
    case "thinking": {
      const out: Record<string, unknown> = {
        type: "thinking",
        thinking: block.thinking,
      };
      if (block.signature !== undefined) out["signature"] = block.signature;
      return out;
    }
  }
}

// Anthropic → internal (response). The SDK's response only emits
// text / tool_use / thinking blocks (tool_result is request-only).
// Unknown block types are dropped with no warning — M0 keeps quiet
// to avoid log noise from future Anthropic block extensions.
export function fromAnthropicBlock(block: unknown): ContentBlock | null {
  if (typeof block !== "object" || block === null || !("type" in block)) {
    return null;
  }
  const b = block as { type: string } & Record<string, unknown>;
  switch (b.type) {
    case "text":
      return { type: "text", text: String(b["text"] ?? "") };
    case "tool_use":
      return {
        type: "tool_use",
        id: String(b["id"] ?? ""),
        name: String(b["name"] ?? ""),
        input: (b["input"] as Record<string, unknown> | undefined) ?? {},
      };
    case "thinking": {
      const signature = b["signature"];
      return {
        type: "thinking",
        thinking: String(b["thinking"] ?? ""),
        ...(typeof signature === "string" && { signature }),
      };
    }
    default:
      return null;
  }
}

export function toAnthropicMessages(
  messages: Message[],
): { role: "user" | "assistant"; content: unknown[] }[] {
  return messages
    .filter(m => m.role !== "system")
    .map(m => ({
      role: m.role as "user" | "assistant",
      content: m.content.map(toAnthropicBlock),
    }));
}

function buildAnthropicSystem(system: SystemPrompt): unknown[] | undefined {
  if (typeof system === "string") {
    if (!system) return undefined;
    return [{ type: "text", text: system, cache_control: { type: "ephemeral" } }];
  }
  if (system.length === 0) return undefined;
  // Up to 4 cache breakpoints per Anthropic request. We only ever ship 3
  // (base, SOUL, MEMORY) so trimming logic is unnecessary today.
  return system.map(s => ({
    type: "text",
    text: s.text,
    ...(s.cache !== false && { cache_control: { type: "ephemeral" } }),
  }));
}

export function createAnthropicProvider(opts: AnthropicProviderOpts = {}): Provider {
  const maxTokens = opts.maxTokens ?? 4096;

  let client: AnthropicLike;
  if (opts.client !== undefined) {
    client = opts.client;
  } else {
    const apiKey =
      opts.apiKey ?? process.env["LLM_API_KEY"] ?? process.env["ANTHROPIC_API_KEY"];
    if (!apiKey) {
      throw new Error(
        "Anthropic API key required (set LLM_API_KEY or ANTHROPIC_API_KEY).",
      );
    }
    client = new Anthropic({ apiKey, baseURL: opts.baseURL });
  }

  return {
    async complete(req: CompletionRequest): Promise<CompletionResponse> {
      const body: Record<string, unknown> = {
        model: req.model,
        max_tokens: maxTokens,
        tools: req.tools.map(t => ({
          name: t.name,
          description: t.description,
          input_schema: t.input_schema,
        })),
        messages: toAnthropicMessages(req.messages),
      };

      const systemBlocks = buildAnthropicSystem(req.system);
      if (systemBlocks !== undefined) {
        body["system"] = systemBlocks;
      }

      let raw: unknown;
      try {
        raw = await client.messages.create(body);
      } catch (e: unknown) {
        // Detect Anthropic API errors — sanitize before re-throwing.
        // Never include API key, headers, or process.env in the thrown error.
        if (
          e instanceof Anthropic.APIError ||
          (typeof e === "object" &&
            e !== null &&
            "status" in e &&
            "message" in e)
        ) {
          const apiErr = e as { status: unknown; message: unknown };
          throw new Error(`anthropic ${apiErr.status}: ${apiErr.message}`);
        }
        const msg = e instanceof Error ? e.message : String(e);
        throw new Error(`anthropic request failed: ${msg}`);
      }

      const res = raw as {
        content: unknown[];
        usage: { input_tokens: number; output_tokens: number };
      };

      const contentBlocks = res.content
        .map(fromAnthropicBlock)
        .filter((b): b is ContentBlock => b !== null);

      const toolCalls = contentBlocks
        .filter((b): b is ContentBlock & { type: "tool_use" } => b.type === "tool_use")
        .map(b => ({ id: b.id, name: b.name, args: b.input }));

      return {
        assistant: {
          role: "assistant",
          content: contentBlocks,
          createdAt: Date.now(),
        },
        toolCalls,
        usage: {
          input: res.usage.input_tokens,
          output: res.usage.output_tokens,
        },
      };
    },
  };
}
