import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { searchSessionsTool } from "@/core/tools/search_sessions";
import { ToolRegistry } from "@/core/registry";
import { SqliteState } from "@/core/state";
import { ensureWorkspace } from "@/core/workspace";
import type { AgentContext } from "@/core/context";
import type { ToolCall } from "@/core/types";

let fakeHome: string;
let workspaceDir: string;
let state: SqliteState;
let ctx: AgentContext;

const stubAgentContext = (s: SqliteState, dir: string): AgentContext =>
  ({
    agentId: "default",
    sessionId: "s_test",
    workspaceDir: dir,
    registry: new ToolRegistry(),
    provider: {} as AgentContext["provider"],
    state: s,
    opts: {
      maxIterations: 5,
      budget: { remaining: 100, deduct: () => {} },
    },
    signal: new AbortController().signal,
    systemPrompt: () => "",
  }) satisfies AgentContext;

beforeEach(async () => {
  fakeHome = await mkdtemp(join(tmpdir(), "mote-search-test-"));
  workspaceDir = await ensureWorkspace("default", fakeHome);
  state = new SqliteState(workspaceDir);
  ctx = stubAgentContext(state, workspaceDir);
});

afterEach(async () => {
  state.close();
  await rm(fakeHome, { recursive: true, force: true });
});

test("search_sessions reports no matches when the corpus is empty", async () => {
  const out = await searchSessionsTool.handler({ query: "anything" }, ctx);
  expect(out).toContain("No matches for");
});

test("search_sessions returns a Markdown bullet list of hits", async () => {
  await state.appendMessages("s_a", [
    {
      role: "user",
      content: [{ type: "text", text: "the rare-marker quick brown fox" }],
      createdAt: Date.now(),
    },
  ]);
  const out = await searchSessionsTool.handler({ query: "rare-marker" }, ctx);
  expect(out).toMatch(/^Found 1 match\(es\) for "rare-marker":\n- \[user\]/);
  expect(out).toContain("rare-marker");
});

test("schema rejects an empty query through registry dispatch", async () => {
  const reg = new ToolRegistry();
  reg.register(searchSessionsTool);
  const call: ToolCall = {
    id: "1",
    name: "search_sessions",
    args: { query: "" },
  };
  const result = await reg.dispatch(call, ctx);
  expect(result).toMatch(/^\[error\] invalid args for search_sessions:/);
});

test("schema accepts an explicit limit within bounds", async () => {
  await state.appendMessages("s", [
    {
      role: "user",
      content: [{ type: "text", text: "limit-test rare" }],
      createdAt: Date.now(),
    },
  ]);
  // schema-level acceptance via dispatch path
  const reg = new ToolRegistry();
  reg.register(searchSessionsTool);
  const call: ToolCall = {
    id: "1",
    name: "search_sessions",
    args: { query: "rare", limit: 5 },
  };
  const result = await reg.dispatch(call, ctx);
  expect(result).toContain("Found 1 match(es)");
});

test("schema rejects a limit outside the [1,50] range", async () => {
  const reg = new ToolRegistry();
  reg.register(searchSessionsTool);
  const call: ToolCall = {
    id: "1",
    name: "search_sessions",
    args: { query: "x", limit: 100 },
  };
  const result = await reg.dispatch(call, ctx);
  expect(result).toMatch(/^\[error\] invalid args for search_sessions:/);
});
