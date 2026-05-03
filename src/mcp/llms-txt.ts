import { writeFile, chmod } from "node:fs/promises";
import { join } from "node:path";

import type { LoadedSkill } from "@/skills/types";

interface PublicTool {
  readonly name: string;
  readonly description: string;
}

const PUBLIC_TOOLS: ReadonlyArray<PublicTool> = [
  { name: "list_sessions", description: "List session ids ordered by created_at" },
  { name: "get_session", description: "Fetch messages for a session (capped, see MOTE_MCP_GET_SESSION_LIMIT)" },
  { name: "search_sessions", description: "FTS5 search across all sessions" },
  { name: "read_memory", description: "Read MEMORY.md" },
  { name: "list_skills", description: "List available skills with their mcp flag" },
  { name: "invoke_skill", description: "Invoke a skill (only those with mcp: public in frontmatter)" },
];

// Generates llms.txt content per https://llmstxt.org/. Static format —
// no LLM call. Regenerated on every server start so skill changes take
// effect immediately.
export function composeLlmsTxt(skills: ReadonlyArray<LoadedSkill>): string {
  const lines: string[] = [];
  lines.push("# mote — minimal personal AI agent");
  lines.push("");
  lines.push("> Personal AI agent exposing skills and session memory via MCP.");
  lines.push("");
  lines.push("## Skills");
  if (skills.length === 0) {
    lines.push("- (no skills installed)");
  } else {
    for (const s of skills) {
      lines.push(`- ${s.name}: ${s.description} (mcp: ${s.mcp})`);
    }
  }
  lines.push("");
  lines.push("## Public MCP tools");
  for (const t of PUBLIC_TOOLS) {
    lines.push(`- ${t.name}: ${t.description}`);
  }
  lines.push("");
  return lines.join("\n");
}

// Writes llms.txt to <workspaceDir>/llms.txt with mode 0o600 (matches
// the workspace's other agent-private files).
export async function writeLlmsTxt(
  workspaceDir: string,
  skills: ReadonlyArray<LoadedSkill>,
): Promise<string> {
  const path = join(workspaceDir, "llms.txt");
  const content = composeLlmsTxt(skills);
  await writeFile(path, content, { mode: 0o600 });
  await chmod(path, 0o600);
  return path;
}
