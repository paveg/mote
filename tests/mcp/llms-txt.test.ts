import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { composeLlmsTxt, writeLlmsTxt } from "@/mcp/llms-txt";
import { ensureWorkspace } from "@/core/workspace";
import type { LoadedSkill } from "@/skills/types";

let fakeHome: string;
let workspaceDir: string;

beforeEach(async () => {
  fakeHome = await mkdtemp(join(tmpdir(), "mote-llmstxt-test-"));
  workspaceDir = await ensureWorkspace("default", fakeHome);
});

afterEach(async () => {
  await rm(fakeHome, { recursive: true, force: true });
});

test("composeLlmsTxt with no skills shows the placeholder line", () => {
  const out = composeLlmsTxt([]);
  expect(out).toContain("# mote");
  expect(out).toContain("(no skills installed)");
  expect(out).toContain("## Public MCP tools");
});

test("composeLlmsTxt lists skills with their mcp flag", () => {
  const skills: LoadedSkill[] = [
    { name: "alpha", description: "First", body: "", path: "/a", mcp: "public" },
    { name: "beta", description: "Second", body: "", path: "/b", mcp: "private" },
  ];
  const out = composeLlmsTxt(skills);
  expect(out).toContain("- alpha: First (mcp: public)");
  expect(out).toContain("- beta: Second (mcp: private)");
});

test("composeLlmsTxt includes all 6 public tools", () => {
  const out = composeLlmsTxt([]);
  for (const name of [
    "list_sessions",
    "get_session",
    "search_sessions",
    "read_memory",
    "list_skills",
    "invoke_skill",
  ]) {
    expect(out).toContain(name);
  }
});

test("writeLlmsTxt creates the file at <workspaceDir>/llms.txt with mode 0o600", async () => {
  const path = await writeLlmsTxt(workspaceDir, []);
  expect(path).toBe(join(workspaceDir, "llms.txt"));
  const content = await readFile(path, "utf8");
  expect(content).toContain("# mote");
  const fileStat = await stat(path);
  expect(fileStat.mode & 0o777).toBe(0o600);
});
