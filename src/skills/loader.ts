import { readFile, realpath } from "node:fs/promises";
import { join } from "node:path";
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
  const rawMatches: string[] = [];
  for await (const absPath of glob.scan({ cwd: workspaceDir, absolute: true })) {
    rawMatches.push(absPath);
  }

  // ADR-0008 confinement: resolve each SKILL.md via realpath and verify the
  // canonical path stays inside <workspaceDir>/skills/. This blocks
  // symlinks that point outside the workspace (pentest finding M6).
  // Both sides are canonicalized to handle macOS /var → /private/var.
  let skillsRoot: string;
  try {
    skillsRoot = await realpath(join(workspaceDir, "skills"));
  } catch {
    // skills/ directory does not exist — nothing to load.
    return [];
  }

  const matches: string[] = [];
  for (const absPath of rawMatches) {
    let resolved: string;
    try {
      resolved = await realpath(absPath);
    } catch {
      // Broken symlink or missing file — skip silently.
      continue;
    }
    if (resolved !== skillsRoot && !resolved.startsWith(skillsRoot + "/")) {
      console.warn(`[skills] skipping symlink-out-of-tree: ${absPath} → ${resolved}`);
      continue;
    }
    matches.push(absPath);
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

    const mcpRaw = parsed.fields["mcp"];
    let mcp: "public" | "private";
    if (mcpRaw === undefined) {
      mcp = "private"; // ADR-0009 D3 default
    } else if (mcpRaw === "public" || mcpRaw === "private") {
      mcp = mcpRaw;
    } else {
      throw new Error(
        `skill at ${path}: invalid \`mcp\` field "${mcpRaw}" — must be "public" or "private"`,
      );
    }

    skills.push({ name, description, body: parsed.body, path, mcp });
  }

  return skills;
}
