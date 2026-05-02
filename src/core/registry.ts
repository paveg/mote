import * as v from "valibot";
import { toJsonSchema } from "@valibot/to-json-schema";

import type { ToolCall } from "@/core/types";
import type { ToolSchema } from "@/providers/types";
import type { AgentContext } from "@/core/context";

// Handler signature. `args` is typed via valibot's InferOutput so the
// handler body sees the validated, narrowed shape — never `unknown`.
// Handlers return strings, never throw (the loop reasons over the string).
export type ToolHandler<TSchema extends v.GenericSchema = v.GenericSchema> = (
  args: v.InferOutput<TSchema>,
  ctx: AgentContext,
) => Promise<string>;

export interface ToolDefinition<TSchema extends v.GenericSchema = v.GenericSchema> {
  readonly name: string;
  readonly description: string;
  readonly schema: TSchema;
  readonly handler: ToolHandler<TSchema>;
}

// In-process registry per ADR-0006. One process = one agent.
// `dispatch` is the only path that reaches a handler; valibot validation
// runs unconditionally before dispatch (security invariant — see
// tasks/todo.md task #3 and the project security pass).
export class ToolRegistry {
  private readonly map = new Map<string, ToolDefinition>();

  register<S extends v.GenericSchema>(def: ToolDefinition<S>): void {
    if (this.map.has(def.name)) {
      throw new Error(`duplicate tool: ${def.name}`);
    }
    // Type-erase the schema for storage; dispatch re-applies the original
    // schema for parse, so the inference round-trips at the handler call site.
    this.map.set(def.name, def as unknown as ToolDefinition);
  }

  // Returns the LLM-facing manifest. Conversion happens once per call —
  // the agent loop calls this on every completion, so do not put expensive
  // work in here. Today `toJsonSchema` is fast for small schemas; revisit
  // if it becomes hot.
  schemas(): ToolSchema[] {
    return [...this.map.values()].map(d => ({
      name: d.name,
      description: d.description,
      input_schema: toJsonSchema(d.schema, { errorMode: "ignore" }) as object,
    }));
  }

  // Dispatch a single tool call. ALWAYS runs valibot.parse on the args
  // before reaching the handler. There is no bypass.
  // - Unknown tool → error string, no handler invoked.
  // - Invalid args → error string, no handler invoked.
  // - Handler throws → error string with the message.
  // - Handler returns → that string.
  async dispatch(call: ToolCall, ctx: AgentContext): Promise<string> {
    const def = this.map.get(call.name);
    if (!def) return `[error] unknown tool: ${call.name}`;

    const result = v.safeParse(def.schema, call.args);
    if (!result.success) {
      const issues = result.issues.map(i => i.message).join("; ");
      return `[error] invalid args for ${call.name}: ${issues}`;
    }

    try {
      return await def.handler(result.output, ctx);
    } catch (e) {
      return `[error] ${e instanceof Error ? e.message : String(e)}`;
    }
  }
}
