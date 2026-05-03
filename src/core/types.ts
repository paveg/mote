// Discriminator for messages. Tool results live as `tool_result` blocks
// inside user messages (Anthropic-native convention). No "tool" role.
export type Role = "user" | "assistant" | "system";

// Content blocks. Provider adapters translate to/from wire formats.
// Field naming is camelCase internally (toolUseId / isError);
// the Anthropic provider maps to/from snake_case at the boundary.
export type ContentBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; toolUseId: string; content: string; isError?: boolean }
  | { type: "thinking"; thinking: string; signature?: string };

export interface Message {
  role: Role;
  content: ContentBlock[];
  createdAt: number; // Unix epoch ms
}

// Transient view extracted from a `tool_use` block for handler dispatch.
// Not stored as a Message — the loop builds it from the assistant's content.
export interface ToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

// Token usage from a single completion. Aggregated by IterationBudget.
export interface Usage {
  input: number;
  output: number;
}

// Caps both runaway protection and cost. Concrete implementation lives
// in core/budget.ts (later); this is just the contract.
export interface IterationBudget {
  readonly remaining: number;
  readonly deduct: (usage: Usage) => void;
}

export interface RunOptions {
  maxIterations: number;
  budget: IterationBudget;
  // Memory-nudge interval (in completed iterations). 0 disables the
  // mechanism. Default: 10. Implemented in core/loop.ts via
  // MemoryNudge.shouldFire().
  memoryNudgeInterval?: number;
}

export interface RunResult {
  messages: Message[];
  iter: number;
}
