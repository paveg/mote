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

// Wraps untrusted sub-LLM output in a structural fence (ADR-0014 D3).
// The skill name is taken from the trusted LoadedSkill.name; the body is
// the untrusted sub-call output. The fence is a defense-in-depth signal —
// it makes the parent LLM less likely to confuse sub-call output for a
// trusted tool report. No escaping inside the body is required per ADR-0014.
function formatSkillOutput(skillName: string, texts: string[]): string {
  const body = texts.join("") || "(skill produced no text output)";
  return `<skill-output skill="${skillName}">\n${body}\n</skill-output>`;
}

// Builds a ToolDefinition from a parsed SKILL.md. The handler runs a
// single, isolated LLM call:
//   - skill.body becomes the `system` prompt
//   - the LLM-supplied args become a JSON user message
//   - tools=[] so the skill cannot recurse into the registry (M1
//     keeps skills as single-call actions)
// The assistant's text-block content is concatenated, fenced, and returned
// as the tool result.
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
      // Pre-check per ADR-0015 D2: budget exhausted → error string, do not call provider.
      if (ctx.opts.budget.remaining <= 0) {
        return "[error] iteration budget exhausted; skill not dispatched";
      }
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
      // ADR-0015 D1: deduct sub-call usage from the outer iteration budget.
      ctx.opts.budget.deduct(res.usage);
      const texts: string[] = [];
      for (const block of res.assistant.content) {
        if (block.type === "text") texts.push(block.text);
      }
      // ADR-0014 D3: fence untrusted sub-LLM output before returning as tool_result.
      return formatSkillOutput(skill.name, texts);
    },
  };
}
