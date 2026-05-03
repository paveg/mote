import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { SqliteState } from "@/core/state";
import { ensureWorkspace } from "@/core/workspace";
import type { Message } from "@/core/types";

let fakeHome: string;
let workspaceDir: string;
let state: SqliteState;

beforeEach(async () => {
  fakeHome = await mkdtemp(join(tmpdir(), "mote-state-test-"));
  workspaceDir = await ensureWorkspace("default", fakeHome);
  state = new SqliteState(workspaceDir);
});

afterEach(async () => {
  state.close();
  await rm(fakeHome, { recursive: true, force: true });
});

const makeMessage = (text: string, role: "user" | "assistant" = "user"): Message => ({
  role,
  content: [{ type: "text", text }],
  createdAt: Date.now(),
});

test("appendMessages writes to <workspaceDir>/state.db with mode 0o600", async () => {
  await state.appendMessages("s_1", [makeMessage("hello")]);

  const dbPath = join(workspaceDir, "state.db");
  const fileStat = await stat(dbPath);
  expect(fileStat.isFile()).toBe(true);
  expect(fileStat.mode & 0o777).toBe(0o600);
});

test("appendMessages is a no-op for an empty messages array", async () => {
  await state.appendMessages("s_empty", []);
  expect(await state.loadLatestSession()).toEqual([]);
});

test("loadLatestSession returns [] when no sessions exist", async () => {
  expect(await state.loadLatestSession()).toEqual([]);
});

test("loadLatestSession returns the messages from the most recent session", async () => {
  await state.appendMessages("s_old", [makeMessage("old")]);
  await new Promise(r => setTimeout(r, 10));
  await state.appendMessages("s_new", [makeMessage("new")]);

  const loaded = await state.loadLatestSession();
  expect(loaded).toHaveLength(1);
  const block = loaded[0]?.content[0];
  if (!block || block.type !== "text") throw new Error("expected text");
  expect(block.text).toBe("new");
});

test("round-trip survives messages with embedded newlines / quotes / tool blocks", async () => {
  const tricky: Message = {
    role: "assistant",
    content: [
      { type: "text", text: 'line1\nline2\t"quoted"\\backslash' },
      { type: "tool_use", id: "tu_1", name: "echo", input: { x: 'with"quote' } },
    ],
    createdAt: Date.now(),
  };
  await state.appendMessages("s_round", [tricky]);
  const loaded = await state.loadLatestSession();
  expect(loaded).toHaveLength(1);
  expect(loaded[0]).toEqual(tricky);
});

test("multiple appendMessages calls accumulate into the same session", async () => {
  const sid = "s_acc";
  await state.appendMessages(sid, [makeMessage("first")]);
  await state.appendMessages(sid, [makeMessage("second"), makeMessage("third")]);
  const loaded = await state.loadLatestSession();
  expect(loaded).toHaveLength(3);
  const texts = loaded.map(m => {
    const b = m.content[0];
    if (!b || b.type !== "text") throw new Error("expected text");
    return b.text;
  });
  expect(texts).toEqual(["first", "second", "third"]);
});

// --- FTS5 search ---------------------------------------------------------

test("searchSessions returns [] for empty / whitespace queries", async () => {
  await state.appendMessages("s", [makeMessage("anything")]);
  expect(await state.searchSessions("")).toEqual([]);
  expect(await state.searchSessions("   ")).toEqual([]);
});

test("searchSessions returns [] when the query has no matches", async () => {
  await state.appendMessages("s", [makeMessage("hello world")]);
  expect(await state.searchSessions("totally-absent-marker")).toEqual([]);
});

test("searchSessions finds a Japanese substring via the trigram tokenizer", async () => {
  await state.appendMessages("s_jp", [makeMessage("先週の TODO を整理した")]);
  const hits = await state.searchSessions("TODO");
  expect(hits).toHaveLength(1);
  expect(hits[0]?.sessionId).toBe("s_jp");
  expect(hits[0]?.snippet).toContain("TODO");
});

test("searchSessions includes role + timestamp + snippet for each hit", async () => {
  await state.appendMessages("s", [
    makeMessage("the rain in spain", "user"),
    makeMessage("falls mainly on the plain", "assistant"),
  ]);
  const hits = await state.searchSessions("rain");
  expect(hits).toHaveLength(1);
  expect(hits[0]?.role).toBe("user");
  expect(hits[0]?.createdAt).toBeGreaterThan(0);
});

test("searchSessions respects the limit argument", async () => {
  for (let i = 0; i < 10; i++) {
    await state.appendMessages(`s_${i}`, [makeMessage(`item rare-marker ${i}`)]);
  }
  const hits = await state.searchSessions("rare-marker", 3);
  expect(hits).toHaveLength(3);
});

test("searchSessions matches only text content, not tool_use input", async () => {
  // tool_use blocks are NOT indexed (only text / tool_result blocks)
  await state.appendMessages("s", [
    {
      role: "assistant",
      content: [
        { type: "tool_use", id: "tu_1", name: "echo", input: { secret: "tool-input-marker" } },
      ],
      createdAt: Date.now(),
    },
  ]);
  expect(await state.searchSessions("tool-input-marker")).toEqual([]);
});

test("schema includes parent_session_id on the sessions table", () => {
  // Use the bun:sqlite raw query to introspect — exposes the migration
  // path without needing a public API.
  const cols = (state as unknown as { db: import("bun:sqlite").Database }).db
    .query<{ name: string }, []>("PRAGMA table_info(sessions)")
    .all();
  const names = cols.map(c => c.name);
  expect(names).toContain("parent_session_id");
});

test("searchSessions does not crash on FTS5 special tokens or operators", async () => {
  await state.appendMessages("s", [makeMessage("hello world")]);

  // Each of these must NOT throw — they should return [] or a hit, but never propagate a SQLite error
  const tokens = ["OR", "NOT", "AND", "NEAR", "*", "foo*bar", 'with"quote', "back\\slash"];
  for (const t of tokens) {
    const hits = await state.searchSessions(t);
    expect(Array.isArray(hits)).toBe(true);
  }
});

// --- :memory: mode -------------------------------------------------------

test("SqliteState supports :memory: mode for tests with no fs side effects", async () => {
  const inMem = new SqliteState(":memory:");
  try {
    await inMem.appendMessages("s_mem", [makeMessage("ephemeral")]);
    const loaded = await inMem.loadLatestSession();
    expect(loaded).toHaveLength(1);
  } finally {
    inMem.close();
  }
});
