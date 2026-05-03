import type { SystemSection } from "@/providers/types";

const BASE_SYSTEM_PROMPT = "You are mote, a minimal personal AI agent.";

// Returns the structured system prompt as an ordered list of sections.
// Each section produces a cache breakpoint for Anthropic; OpenAI-compat
// providers concatenate the sections into a single system message.
//
// Stacking order: base → persona (SOUL.md) → memory (MEMORY.md). When
// MEMORY.md changes (e.g., the agent calls memory_append), the base
// and persona caches stay valid; only the memory section invalidates.
export function composeSystemPrompt(
  soul: string | null,
  memory: string | null,
): SystemSection[] {
  const sections: SystemSection[] = [{ text: BASE_SYSTEM_PROMPT, cache: true }];
  if (soul) sections.push({ text: `# Persona (SOUL.md)\n${soul}`, cache: true });
  if (memory) sections.push({ text: `# Memory (MEMORY.md)\n${memory}`, cache: true });
  return sections;
}
