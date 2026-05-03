import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { memoryAppendTool, memoryEditTool } from "@/core/tools/memory";
import { ToolRegistry } from "@/core/registry";
import { ensureWorkspace } from "@/core/workspace";
import type { AgentContext } from "@/core/context";
import type { ToolCall } from "@/core/types";

let fakeHome: string;
let workspaceDir: string;
let ctx: AgentContext;

const stubAgentContext = (workspaceDir: string): AgentContext =>
  ({
    agentId: "default",
    sessionId: "s_test",
    workspaceDir,
    registry: new ToolRegistry(),
    provider: {} as AgentContext["provider"],
    state: {
      async appendMessages(_s: string, _m: unknown[]) {},
      async loadLatestSession() { return []; },
      async searchSessions(_q: string, _l?: number) { return []; },
      async listSessions() { return []; },
      async getSession(_id: string, _limit: number) { return { messages: [], truncated: false }; },
    },
    opts: {
      maxIterations: 5,
      budget: { remaining: 100, deduct: () => {} },
    },
    signal: new AbortController().signal,
    systemPrompt: () => "",
  }) satisfies AgentContext;

beforeEach(async () => {
  fakeHome = await mkdtemp(join(tmpdir(), "mote-memory-test-"));
  workspaceDir = await ensureWorkspace("default", fakeHome);
  ctx = stubAgentContext(workspaceDir);
});

afterEach(async () => {
  await rm(fakeHome, { recursive: true, force: true });
});

// --- memory_append -------------------------------------------------------

test("memory_append creates MEMORY.md when it does not exist", async () => {
  const result = await memoryAppendTool.handler(
    { text: "user prefers Earl Grey" },
    ctx,
  );
  expect(result).toMatch(/Appended/);
  const path = join(workspaceDir, "MEMORY.md");
  const content = await readFile(path, "utf8");
  expect(content).toBe("user prefers Earl Grey\n");
});

test("memory_append uses 0o600 file mode on create", async () => {
  await memoryAppendTool.handler({ text: "secret" }, ctx);
  const path = join(workspaceDir, "MEMORY.md");
  const fileStat = await stat(path);
  expect(fileStat.mode & 0o777).toBe(0o600);
});

test("memory_append enforces 0o600 even on a pre-existing wider-mode file", async () => {
  const path = join(workspaceDir, "MEMORY.md");
  await writeFile(path, "existing content\n", { mode: 0o644 });
  await memoryAppendTool.handler({ text: "new" }, ctx);
  const fileStat = await stat(path);
  expect(fileStat.mode & 0o777).toBe(0o600);
});

test("memory_append separates a new entry from existing content with a blank line", async () => {
  await memoryAppendTool.handler({ text: "first entry" }, ctx);
  await memoryAppendTool.handler({ text: "second entry" }, ctx);
  const content = await readFile(join(workspaceDir, "MEMORY.md"), "utf8");
  expect(content).toBe("first entry\n\nsecond entry\n");
});

test("schema rejects empty text via registry dispatch", async () => {
  const reg = new ToolRegistry();
  reg.register(memoryAppendTool);
  const call: ToolCall = { id: "1", name: "memory_append", args: { text: "" } };
  const result = await reg.dispatch(call, ctx);
  expect(result).toMatch(/^\[error\] invalid args for memory_append:/);
});

// --- memory_edit ---------------------------------------------------------

test("memory_edit fails when MEMORY.md does not exist", async () => {
  const result = await memoryEditTool.handler(
    { find: "x", replace: "y" },
    ctx,
  );
  expect(result).toMatch(/MEMORY\.md does not exist/);
});

test("memory_edit fails when `find` is absent", async () => {
  await memoryAppendTool.handler({ text: "hello world" }, ctx);
  const result = await memoryEditTool.handler(
    { find: "absent", replace: "x" },
    ctx,
  );
  expect(result).toMatch(/not present/);
});

test("memory_edit fails when `find` appears more than once", async () => {
  await memoryAppendTool.handler({ text: "foo bar foo" }, ctx);
  const result = await memoryEditTool.handler(
    { find: "foo", replace: "baz" },
    ctx,
  );
  expect(result).toMatch(/appears 2 times/);
});

test("memory_edit replaces the unique occurrence and preserves 0o600", async () => {
  await memoryAppendTool.handler(
    { text: "user prefers Earl Grey, no sugar" },
    ctx,
  );
  const result = await memoryEditTool.handler(
    { find: "Earl Grey, no sugar", replace: "matcha, two sugars" },
    ctx,
  );
  expect(result).toMatch(/Replaced/);
  const path = join(workspaceDir, "MEMORY.md");
  const content = await readFile(path, "utf8");
  expect(content).toBe("user prefers matcha, two sugars\n");
  const fileStat = await stat(path);
  expect(fileStat.mode & 0o777).toBe(0o600);
});

test("memory_edit schema rejects empty `find`", async () => {
  const reg = new ToolRegistry();
  reg.register(memoryEditTool);
  const call: ToolCall = {
    id: "1",
    name: "memory_edit",
    args: { find: "", replace: "x" },
  };
  const result = await reg.dispatch(call, ctx);
  expect(result).toMatch(/^\[error\] invalid args for memory_edit:/);
});

test("memory_edit can match a `find` string that spans paragraph boundaries", async () => {
  await memoryAppendTool.handler({ text: "first paragraph end" }, ctx);
  await memoryAppendTool.handler({ text: "second paragraph start" }, ctx);
  // The two paragraphs are joined by `\n\n` — the find spans that boundary
  const result = await memoryEditTool.handler(
    {
      find: "first paragraph end\n\nsecond paragraph start",
      replace: "merged paragraph",
    },
    ctx,
  );
  expect(result).toMatch(/^Replaced/);
  const content = await readFile(join(workspaceDir, "MEMORY.md"), "utf8");
  expect(content).toBe("merged paragraph\n");
});

test("memory_edit schema accepts empty `replace` (deletion)", async () => {
  await memoryAppendTool.handler({ text: "delete-me kept-text" }, ctx);
  const result = await memoryEditTool.handler(
    { find: "delete-me ", replace: "" },
    ctx,
  );
  expect(result).toMatch(/Replaced/);
  const content = await readFile(join(workspaceDir, "MEMORY.md"), "utf8");
  expect(content).toBe("kept-text\n");
});

// --- boundary: literal content and whitespace-only input -----------------

test("memory_append writes literal `---` content without parsing it", async () => {
  await memoryAppendTool.handler({ text: "---\nfoo: bar\n---" }, ctx);
  const content = await readFile(join(workspaceDir, "MEMORY.md"), "utf8");
  expect(content).toContain("---\nfoo: bar\n---");
});

test("memory_append accepts a single newline (whitespace-only) and writes it as-is", async () => {
  // The schema requires minLength(1) but does not require non-whitespace.
  // The append succeeds; loadMemory returns "" (empty after trailing-whitespace
  // trim) on subsequent reads. This pins the current contract — change it via
  // a follow-up if we ever decide whitespace-only should be rejected.
  const result = await memoryAppendTool.handler({ text: "\n" }, ctx);
  expect(result).toMatch(/Appended/);
  // Verify on disk
  const content = await readFile(join(workspaceDir, "MEMORY.md"), "utf8");
  expect(content.length).toBeGreaterThan(0);
});

// --- security: $ pattern neutralization in memory_edit -------------------

test("memory_edit treats `$&` in replace as a literal, not as the matched substring", async () => {
  await memoryAppendTool.handler({ text: "abc" }, ctx);
  const result = await memoryEditTool.handler(
    { find: "abc", replace: "$& - $&" },
    ctx,
  );
  expect(result).toMatch(/^Replaced/);
  const content = await readFile(join(workspaceDir, "MEMORY.md"), "utf8");
  // Must be the literal string "$& - $&", NOT "abc - abc".
  expect(content).toBe("$& - $&\n");
});

test("memory_edit treats `$$` in replace as a literal", async () => {
  await memoryAppendTool.handler({ text: "x" }, ctx);
  const result = await memoryEditTool.handler(
    { find: "x", replace: "$$y" },
    ctx,
  );
  expect(result).toMatch(/^Replaced/);
  const content = await readFile(join(workspaceDir, "MEMORY.md"), "utf8");
  // Must be the literal string "$$y", NOT "$y".
  expect(content).toBe("$$y\n");
});

test("memory_edit treats `$'` in replace as a literal", async () => {
  await memoryAppendTool.handler({ text: "abcDEF" }, ctx);
  const result = await memoryEditTool.handler(
    { find: "abc", replace: "[$'rest]" },
    ctx,
  );
  expect(result).toMatch(/^Replaced/);
  const content = await readFile(join(workspaceDir, "MEMORY.md"), "utf8");
  // Must be the literal string "[$'rest]DEF", NOT the post-match substring.
  expect(content).toBe("[$'rest]DEF\n");
});

test("memory_edit normal case (no $ patterns) still works", async () => {
  await memoryAppendTool.handler({ text: "old value" }, ctx);
  const result = await memoryEditTool.handler(
    { find: "old", replace: "new" },
    ctx,
  );
  expect(result).toMatch(/^Replaced/);
  const content = await readFile(join(workspaceDir, "MEMORY.md"), "utf8");
  expect(content).toBe("new value\n");
});
