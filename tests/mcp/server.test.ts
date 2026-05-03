import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createMoteMcpServer } from "@/mcp/server";
import { ToolRegistry } from "@/core/registry";
import { SqliteState } from "@/core/state";
import { ensureWorkspace } from "@/core/workspace";
import type { AgentContext } from "@/core/context";
import type { LoadedSkill } from "@/skills/types";
import type { Provider } from "@/providers/types";

let fakeHome: string;
let workspaceDir: string;
let state: SqliteState;
let ctx: AgentContext;

const mockProvider: Provider = {
  complete: async () => ({
    assistant: {
      role: "assistant",
      content: [{ type: "text", text: "skill-output" }],
      createdAt: 0,
    },
    toolCalls: [],
    usage: { input: 1, output: 1 },
  }),
};

const buildCtx = (workspaceDir: string, state: SqliteState): AgentContext =>
  ({
    agentId: "default",
    sessionId: "s_test",
    workspaceDir,
    registry: new ToolRegistry(),
    provider: mockProvider,
    state,
    opts: {
      maxIterations: 5,
      budget: { remaining: 100, deduct: () => {} },
    },
    signal: new AbortController().signal,
    systemPrompt: () => "",
  }) satisfies AgentContext;

beforeEach(async () => {
  fakeHome = await mkdtemp(join(tmpdir(), "mote-mcp-test-"));
  workspaceDir = await ensureWorkspace("default", fakeHome);
  state = new SqliteState(workspaceDir);
  ctx = buildCtx(workspaceDir, state);
});

afterEach(async () => {
  state.close();
  await rm(fakeHome, { recursive: true, force: true });
});

const findTool = (
  tools: Awaited<ReturnType<typeof createMoteMcpServer>>["tools"],
  name: string,
) => {
  const t = tools.find(t => t.name === name);
  if (!t) throw new Error(`tool not found: ${name}`);
  return t;
};

test("createMoteMcpServer exposes exactly the 6 public tools from ADR-0009 D2", () => {
  const { tools } = createMoteMcpServer(ctx, []);
  const names = tools.map(t => t.name).sort();
  expect(names).toEqual([
    "get_session",
    "invoke_skill",
    "list_sessions",
    "list_skills",
    "read_memory",
    "search_sessions",
  ]);
});

test("list_sessions returns formatted session metadata", async () => {
  await state.appendMessages("s_x", [
    { role: "user", content: [{ type: "text", text: "hi" }], createdAt: Date.now() },
  ]);
  const { tools } = createMoteMcpServer(ctx, []);
  const out = await findTool(tools, "list_sessions").handler({});
  expect(out).toContain("s_x");
});

test("get_session returns JSON with truncated:false for small sessions", async () => {
  await state.appendMessages("s_x", [
    { role: "user", content: [{ type: "text", text: "msg" }], createdAt: Date.now() },
  ]);
  const { tools } = createMoteMcpServer(ctx, []);
  const out = await findTool(tools, "get_session").handler({ session_id: "s_x" });
  const parsed = JSON.parse(out);
  expect(parsed.truncated).toBe(false);
  expect(parsed.messages).toHaveLength(1);
});

test("get_session honors MOTE_MCP_GET_SESSION_LIMIT env var", async () => {
  for (let i = 0; i < 5; i++) {
    await state.appendMessages("s_y", [
      {
        role: "user",
        content: [{ type: "text", text: `m${i}` }],
        createdAt: Date.now() + i,
      },
    ]);
  }
  const prev = process.env["MOTE_MCP_GET_SESSION_LIMIT"];
  process.env["MOTE_MCP_GET_SESSION_LIMIT"] = "2";
  try {
    const { tools } = createMoteMcpServer(ctx, []);
    const out = await findTool(tools, "get_session").handler({ session_id: "s_y" });
    const parsed = JSON.parse(out);
    expect(parsed.truncated).toBe(true);
    expect(parsed.messages).toHaveLength(2);
  } finally {
    if (prev === undefined) delete process.env["MOTE_MCP_GET_SESSION_LIMIT"];
    else process.env["MOTE_MCP_GET_SESSION_LIMIT"] = prev;
  }
});

test("read_memory returns the file contents or empty string when absent", async () => {
  const { tools } = createMoteMcpServer(ctx, []);
  // absent
  expect(await findTool(tools, "read_memory").handler({})).toBe("");
  // present
  await writeFile(join(workspaceDir, "MEMORY.md"), "remembered stuff\n");
  expect(await findTool(tools, "read_memory").handler({})).toBe("remembered stuff");
});

test("list_skills returns each skill with its mcp flag", async () => {
  const skills: LoadedSkill[] = [
    { name: "open", description: "o", body: "", path: "/o", mcp: "public" },
    { name: "shut", description: "s", body: "", path: "/s", mcp: "private" },
  ];
  const { tools } = createMoteMcpServer(ctx, skills);
  const out = await findTool(tools, "list_skills").handler({});
  expect(out).toContain("open [mcp:public]");
  expect(out).toContain("shut [mcp:private]");
});

test("invoke_skill rejects an unknown skill name", async () => {
  const { tools } = createMoteMcpServer(ctx, []);
  const out = await findTool(tools, "invoke_skill").handler({ name: "ghost" });
  expect(out).toMatch(/^\[error\] unknown skill/);
});

test("invoke_skill rejects a private skill (mcp: private)", async () => {
  const skill: LoadedSkill = {
    name: "secret",
    description: "private",
    body: "do not share",
    path: "/secret",
    mcp: "private",
  };
  const { tools } = createMoteMcpServer(ctx, [skill]);
  const out = await findTool(tools, "invoke_skill").handler({ name: "secret" });
  expect(out).toMatch(/not exposed via MCP/);
});

test("invoke_skill dispatches a public skill through the registry", async () => {
  const skill: LoadedSkill = {
    name: "echo-skill",
    description: "echoes",
    body: "Reply with 'skill-output'",
    path: "/echo",
    mcp: "public",
  };
  // Register the skill in the registry (so dispatch finds it)
  const { createSkillToolDefinition } = await import("@/skills/handler");
  ctx.registry.register(
    createSkillToolDefinition(skill, { model: "claude-sonnet-4-6" }),
  );
  const { tools } = createMoteMcpServer(ctx, [skill]);
  const out = await findTool(tools, "invoke_skill").handler({
    name: "echo-skill",
    args: {},
  });
  expect(out).toBe("skill-output");
});

test("search_sessions returns 'No matches' for an empty corpus", async () => {
  const { tools } = createMoteMcpServer(ctx, []);
  const out = await findTool(tools, "search_sessions").handler({ query: "anything" });
  expect(out).toMatch(/^No matches for/);
});

test("list_sessions returns '(no sessions)' when empty", async () => {
  const { tools } = createMoteMcpServer(ctx, []);
  const out = await findTool(tools, "list_sessions").handler({});
  expect(out).toBe("(no sessions)");
});

test("list_skills returns '(no skills installed)' when empty", async () => {
  const { tools } = createMoteMcpServer(ctx, []);
  const out = await findTool(tools, "list_skills").handler({});
  expect(out).toBe("(no skills installed)");
});
