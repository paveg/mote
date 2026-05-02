import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { JsonlState } from "@/core/state";
import { ensureWorkspace } from "@/core/workspace";
import type { Message } from "@/core/types";

let fakeHome: string;
let workspaceDir: string;

beforeEach(async () => {
  fakeHome = await mkdtemp(join(tmpdir(), "mote-state-test-"));
  workspaceDir = await ensureWorkspace("default", fakeHome);
});

afterEach(async () => {
  await rm(fakeHome, { recursive: true, force: true });
});

const makeMessage = (text: string): Message => ({
  role: "user",
  content: [{ type: "text", text }],
  createdAt: 0, // fixed so equality is deterministic
});

test("appendMessages writes a jsonl file under sessions/<id>.jsonl with mode 0o600", async () => {
  const state = new JsonlState(workspaceDir);
  await state.appendMessages("s_1", [makeMessage("hello")]);

  const path = join(workspaceDir, "sessions", "s_1.jsonl");
  const fileStat = await stat(path);
  expect(fileStat.isFile()).toBe(true);
  expect(fileStat.mode & 0o777).toBe(0o600);
});

test("appendMessages is a no-op for an empty messages array", async () => {
  const state = new JsonlState(workspaceDir);
  await state.appendMessages("s_empty", []);
  // file should not exist
  const path = join(workspaceDir, "sessions", "s_empty.jsonl");
  await expect(stat(path)).rejects.toThrow();
});

test("appendMessages enforces 0o600 even on a pre-existing wider-mode file", async () => {
  // Pre-create a file with mode 0o644 to simulate a stale jsonl from a buggy past run
  const path = join(workspaceDir, "sessions", "s_legacy.jsonl");
  await writeFile(path, "", { mode: 0o644 });

  const state = new JsonlState(workspaceDir);
  await state.appendMessages("s_legacy", [makeMessage("x")]);

  const fileStat = await stat(path);
  expect(fileStat.mode & 0o777).toBe(0o600);
});

test("loadLatestSession returns [] when no sessions exist", async () => {
  const state = new JsonlState(workspaceDir);
  expect(await state.loadLatestSession()).toEqual([]);
});

test("loadLatestSession returns the messages from the most recent session by mtime", async () => {
  const state = new JsonlState(workspaceDir);

  await state.appendMessages("s_old", [makeMessage("old")]);
  // wait so mtime differs
  await new Promise(r => setTimeout(r, 10));
  await state.appendMessages("s_new", [makeMessage("new")]);

  const loaded = await state.loadLatestSession();
  expect(loaded).toHaveLength(1);
  const block = loaded[0]?.content[0];
  if (!block || block.type !== "text") throw new Error("expected text block");
  expect(block.text).toBe("new");
});

test("round-trip survives messages with embedded newlines, quotes, and backslashes", async () => {
  const tricky: Message = {
    role: "assistant",
    content: [
      { type: "text", text: 'line1\nline2\t"quoted"\\backslash' },
      { type: "tool_use", id: "tu_1", name: "echo", input: { x: 'with"quote\nnewline' } },
    ],
    createdAt: 0,
  };

  const state = new JsonlState(workspaceDir);
  await state.appendMessages("s_round", [tricky]);

  const loaded = await state.loadLatestSession();
  expect(loaded).toHaveLength(1);
  expect(loaded[0]).toEqual(tricky);
});

test("multiple appendMessages calls accumulate into the same file", async () => {
  const state = new JsonlState(workspaceDir);
  await state.appendMessages("s_acc", [makeMessage("first")]);
  await state.appendMessages("s_acc", [makeMessage("second"), makeMessage("third")]);

  const loaded = await state.loadLatestSession();
  expect(loaded).toHaveLength(3);

  const texts = loaded.map(m => {
    const b = m.content[0];
    if (!b || b.type !== "text") throw new Error("expected text block");
    return b.text;
  });
  expect(texts).toEqual(["first", "second", "third"]);
});
