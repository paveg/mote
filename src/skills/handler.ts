import * as v from "valibot";

import type { ToolDefinition } from "@/core/registry";
import type { LoadedSkill } from "@/skills/types";

// Skills accept whatever shape the LLM passes — the skill body documents
// the contract in natural language, not JSON Schema. We do not constrain.
const SkillArgs = v.record(v.string(), v.unknown());

export interface SkillToolOpts {
  readonly model: string;
  readonly maxTokens?: number;
}

// Builds a ToolDefinition from a parsed SKILL.md. The handler runs a
// single, isolated LLM call:
//   - skill.body becomes the `system` prompt
//   - the LLM-supplied args become a JSON user message
//   - tools=[] so the skill cannot recurse into the registry (M1
//     keeps skills as single-call actions)
// The assistant's text-block content is concatenated and returned as
// the tool result.
export function createSkillToolDefinition(
  skill: LoadedSkill,
  opts: SkillToolOpts,
): ToolDefinition<typeof SkillArgs> {
  const { model, maxTokens = 4096 } = opts;
  // maxTokens is plumbed for future use; M0 providers accept it at
  // construction time, not per-call. Suppress the unused-var lint.
  void maxTokens;
  return {
    name: skill.name,
    description: skill.description,
    schema: SkillArgs,
    handler: async (args, ctx) => {
      const argsText =
        Object.keys(args).length > 0
          ? `Arguments:\n${JSON.stringify(args, null, 2)}`
          : "Execute the skill.";
      const res = await ctx.provider.complete({
        model,
        system: skill.body,
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: argsText }],
            createdAt: Date.now(),
          },
        ],
        tools: [],
      });
      const texts: string[] = [];
      for (const block of res.assistant.content) {
        if (block.type === "text") texts.push(block.text);
      }
      // Budget deduction is intentionally NOT done here — the sub-call
      // is invisible to the outer iteration budget in M1. M2 can revisit
      // when usage tracking matures.
      return texts.join("") || "(skill produced no text output)";
    },
  };
}
