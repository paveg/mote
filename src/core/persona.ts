const BASE_SYSTEM_PROMPT = "You are mote, a minimal personal AI agent.";

// Builds the full system prompt by stacking:
//   1. The base mote prompt (always)
//   2. SOUL.md if present (persona)
//   3. MEMORY.md if present (durable memory)
//
// Each non-empty section is separated by a blank line. Returns just the
// base prompt when both files are absent.
export function composeSystemPrompt(
  soul: string | null,
  memory: string | null,
): string {
  const sections: string[] = [BASE_SYSTEM_PROMPT];
  if (soul) sections.push(`# Persona (SOUL.md)\n${soul}`);
  if (memory) sections.push(`# Memory (MEMORY.md)\n${memory}`);
  return sections.join("\n\n");
}
