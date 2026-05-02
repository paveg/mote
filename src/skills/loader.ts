import { readFile } from "node:fs/promises";
import { Glob } from "bun";

import { parseFrontmatter } from "@/skills/frontmatter";
import type { LoadedSkill } from "@/skills/types";

// Walks `<workspaceDir>/skills/*/SKILL.md`, parses each, and returns
// the resulting LoadedSkill[]. Skill names are unique (per ADR-0006:
// duplicate tool names cause register() to throw — surfaced clearly
// here too so the user knows which two SKILL.md files clash).
//
// Errors:
// - Missing or malformed frontmatter → throws with the offending file path
// - Missing `name` or `description` field → throws
// - Duplicate skill names across SKILL.md files → throws
//
// Returning [] cleanly when the skills/ directory does not exist is
// fine — a user may run mote with no skills installed yet.
export async function loadSkills(workspaceDir: string): Promise<LoadedSkill[]> {
  const glob = new Glob("skills/*/SKILL.md");
  const matches: string[] = [];
  for await (const relPath of glob.scan({ cwd: workspaceDir, absolute: true })) {
    matches.push(relPath);
  }
  // Stable order so tests (and `list_skills` MCP tool in M3) see deterministic output.
  matches.sort();

  const seen = new Map<string, string>(); // name → path of first declaration
  const skills: LoadedSkill[] = [];

  for (const path of matches) {
    const content = await readFile(path, "utf8");
    let parsed;
    try {
      parsed = parseFrontmatter(content);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new Error(`skill at ${path}: ${msg}`);
    }

    const name = parsed.fields["name"];
    const description = parsed.fields["description"];
    if (!name) throw new Error(`skill at ${path}: missing required \`name\` field`);
    if (!description) throw new Error(`skill at ${path}: missing required \`description\` field`);

    const earlier = seen.get(name);
    if (earlier !== undefined) {
      throw new Error(
        `skill at ${path}: duplicate skill name "${name}" (already declared at ${earlier})`,
      );
    }
    seen.set(name, path);

    skills.push({ name, description, body: parsed.body, path });
  }

  return skills;
}
