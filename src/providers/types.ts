import type { Message, ToolCall, Usage } from "@/core/types";

// JSON-Schema-shaped tool descriptor sent to the LLM.
// Registry produces these by running each ToolDefinition's valibot schema
// through `@valibot/to-json-schema`. Conversion happens once per call to
// registry.schemas() — not on every completion.
export interface ToolSchema {
  name: string;
  description: string;
  // JSON Schema. Kept as `object` rather than a stricter type:
  // we never inspect the schema in core, only forward it to the provider.
  input_schema: object;
}

// Input to provider.complete. Provider-agnostic: no cache_control, no
// thinking config, no Anthropic-specific fields. Provider implementations
// own those internally (see ADR-0005).
export interface CompletionRequest {
  model: string;
  messages: Message[];
  tools: ToolSchema[];
  system: string;
}

// Output of provider.complete.
// - `assistant` is the message to push onto the conversation. Contains
//   tool_use / thinking blocks if the model produced any.
// - `toolCalls` is a flattened convenience view extracted from the
//   assistant's tool_use blocks. The loop dispatches handlers from this.
//   It's redundant with `assistant.content` by design — saves the loop
//   from re-walking blocks every turn.
// - `usage` feeds the IterationBudget.
export interface CompletionResponse {
  assistant: Message;
  toolCalls: ToolCall[];
  usage: Usage;
}

// The single contract every provider implements.
// Anthropic native + OpenAI-compatible (when added) both implement this.
// Mock providers in tests implement this with a fixed sequence of responses.
export interface Provider {
  complete(req: CompletionRequest): Promise<CompletionResponse>;
}
