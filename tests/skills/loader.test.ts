import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { loadSkills } from "@/skills/loader";
import { ensureWorkspace } from "@/core/workspace";

let fakeHome: string;
let workspaceDir: string;

beforeEach(async () => {
  fakeHome = await mkdtemp(join(tmpdir(), "mote-skills-test-"));
  workspaceDir = await ensureWorkspace("default", fakeHome);
});

afterEach(async () => {
  await rm(fakeHome, { recursive: true, force: true });
});

const writeSkill = async (name: string, content: string) => {
  const dir = join(workspaceDir, "skills", name);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "SKILL.md"), content);
};

test("loadSkills returns [] when the skills directory does not exist", async () => {
  expect(await loadSkills(workspaceDir)).toEqual([]);
});

test("loadSkills returns [] when skills directory exists but is empty", async () => {
  await mkdir(join(workspaceDir, "skills"));
  expect(await loadSkills(workspaceDir)).toEqual([]);
});

test("loadSkills parses a valid SKILL.md", async () => {
  await writeSkill(
    "hello",
    `---
name: hello
description: Say hello
---
Reply with "hi from skill".`,
  );

  const skills = await loadSkills(workspaceDir);
  expect(skills).toHaveLength(1);
  expect(skills[0]?.name).toBe("hello");
  expect(skills[0]?.description).toBe("Say hello");
  expect(skills[0]?.body).toBe(`Reply with "hi from skill".`);
  expect(skills[0]?.path).toMatch(/skills\/hello\/SKILL\.md$/);
});

test("loadSkills returns skills sorted by path for deterministic order", async () => {
  await writeSkill("alpha", `---\nname: alpha\ndescription: a\n---\n`);
  await writeSkill("beta", `---\nname: beta\ndescription: b\n---\n`);
  await writeSkill("gamma", `---\nname: gamma\ndescription: g\n---\n`);

  const skills = await loadSkills(workspaceDir);
  expect(skills.map(s => s.name)).toEqual(["alpha", "beta", "gamma"]);
});

test("loadSkills throws when a SKILL.md is missing the `name` field", async () => {
  await writeSkill("broken", `---\ndescription: no name\n---\nbody`);
  await expect(loadSkills(workspaceDir)).rejects.toThrow(/missing required \`name\`/);
});

test("loadSkills throws when a SKILL.md is missing the `description` field", async () => {
  await writeSkill("broken", `---\nname: broken\n---\nbody`);
  await expect(loadSkills(workspaceDir)).rejects.toThrow(/missing required \`description\`/);
});

test("loadSkills throws on a frontmatter parse error and includes the file path", async () => {
  await writeSkill("malformed", `---\nname: ok\nbroken-line-no-colon\n---\nbody`);
  await expect(loadSkills(workspaceDir)).rejects.toThrow(/skill at .*malformed.*SKILL\.md/);
});

test("loadSkills throws on duplicate skill names declared in different files", async () => {
  await writeSkill("dirA", `---\nname: clash\ndescription: a\n---\nbody`);
  await writeSkill("dirB", `---\nname: clash\ndescription: b\n---\nbody`);
  await expect(loadSkills(workspaceDir)).rejects.toThrow(/duplicate skill name "clash"/);
});

test("loadSkills ignores files in skills/ that are not named SKILL.md", async () => {
  const dir = join(workspaceDir, "skills", "withaux");
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "SKILL.md"), `---\nname: withaux\ndescription: ok\n---\nbody`);
  await writeFile(join(dir, "helper.txt"), "auxiliary file");

  const skills = await loadSkills(workspaceDir);
  expect(skills).toHaveLength(1);
  expect(skills[0]?.name).toBe("withaux");
});

// --- mcp field -----------------------------------------------------------

test("loadSkills reads `mcp: public` from frontmatter", async () => {
  await writeSkill(
    "pub",
    `---\nname: pub\ndescription: d\nmcp: public\n---\nbody`,
  );
  const skills = await loadSkills(workspaceDir);
  expect(skills).toHaveLength(1);
  expect(skills[0]?.mcp).toBe("public");
});

test("loadSkills defaults `mcp` to private when absent", async () => {
  await writeSkill("default", `---\nname: default\ndescription: d\n---\nbody`);
  const skills = await loadSkills(workspaceDir);
  expect(skills[0]?.mcp).toBe("private");
});

test("loadSkills rejects an invalid `mcp` value", async () => {
  await writeSkill(
    "bad",
    `---\nname: bad\ndescription: d\nmcp: yes-please\n---\nbody`,
  );
  await expect(loadSkills(workspaceDir)).rejects.toThrow(/invalid `mcp` field/);
});

// --- boundary: malformed skill positioned between two valid skills --------

test("loadSkills throws on a malformed skill positioned between two valid skills", async () => {
  await writeSkill("alpha", `---\nname: alpha\ndescription: a\n---\nbody`);
  await writeSkill("broken", `---\nname: broken\nthis-line-has-no-colon\n---\nbody`);
  await writeSkill("gamma", `---\nname: gamma\ndescription: g\n---\nbody`);
  await expect(loadSkills(workspaceDir)).rejects.toThrow(/skill at .*broken.*SKILL\.md/);
});

// --- confinement: symlink traversal (pentest finding M6) ------------------

test("loadSkills skips a SKILL.md whose realpath escapes the workspace via symlink", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mote-skill-symlink-"));
  const outsideDir = mkdtempSync(join(tmpdir(), "mote-outside-"));
  writeFileSync(
    join(outsideDir, "evil.md"),
    "---\nname: evil\ndescription: out\nmcp: public\n---\nbody",
  );
  // Create the in-tree skill dir but symlink SKILL.md to an outside file
  mkdirSync(join(dir, "skills", "evil"), { recursive: true });
  symlinkSync(join(outsideDir, "evil.md"), join(dir, "skills", "evil", "SKILL.md"));
  const skills = await loadSkills(dir);
  expect(skills.find((s) => s.name === "evil")).toBeUndefined();
});

test("loadSkills loads a normal in-tree skill correctly (regression)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mote-skill-normal-"));
  mkdirSync(join(dir, "skills", "hello"), { recursive: true });
  writeFileSync(
    join(dir, "skills", "hello", "SKILL.md"),
    "---\nname: hello\ndescription: greet\nmcp: public\n---\nbody",
  );
  const skills = await loadSkills(dir);
  const hello = skills.find((s) => s.name === "hello");
  expect(hello).toBeDefined();
});

test("loadSkills tolerates a broken symlink without crashing", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mote-skill-broken-"));
  mkdirSync(join(dir, "skills", "broken"), { recursive: true });
  // SKILL.md is a symlink pointing to a path that does not exist
  symlinkSync("/nonexistent/path/SKILL.md", join(dir, "skills", "broken", "SKILL.md"));
  const skills = await loadSkills(dir);
  expect(Array.isArray(skills)).toBe(true);
});
