import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, symlink, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { readFileTool } from "@/core/tools/read_file";
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
      async appendMessages(_s, _m) {},
      async loadLatestSession() {
        return [];
      },
    },
    opts: {
      maxIterations: 10,
      budget: { remaining: 100, deduct: () => {} },
    },
    signal: new AbortController().signal,
    systemPrompt: () => "",
  }) satisfies AgentContext;

beforeEach(async () => {
  fakeHome = await mkdtemp(join(tmpdir(), "mote-readfile-test-"));
  workspaceDir = await ensureWorkspace("default", fakeHome);
  ctx = stubAgentContext(workspaceDir);
});

afterEach(async () => {
  await rm(fakeHome, { recursive: true, force: true });
});

// --- happy path -----------------------------------------------------------

test("read_file reads a file inside the workspace", async () => {
  const path = join(workspaceDir, "hello.txt");
  await writeFile(path, "world");

  const result = await readFileTool.handler({ path: "hello.txt" }, ctx);
  expect(result).toBe("world");
});

test("read_file reads a file under a subdirectory inside the workspace", async () => {
  await mkdir(join(workspaceDir, "sub"), { recursive: true });
  await writeFile(join(workspaceDir, "sub", "x.txt"), "deep");

  const result = await readFileTool.handler({ path: "sub/x.txt" }, ctx);
  expect(result).toBe("deep");
});

// --- schema-level rejections ---------------------------------------------

test("schema rejects empty path string", async () => {
  const reg = new ToolRegistry();
  reg.register(readFileTool);
  const call: ToolCall = { id: "1", name: "read_file", args: { path: "" } };
  const result = await reg.dispatch(call, ctx);
  expect(result).toMatch(/^\[error\] invalid args for read_file:/);
});

test("schema rejects `..` in the path", async () => {
  const reg = new ToolRegistry();
  reg.register(readFileTool);
  const call: ToolCall = {
    id: "1",
    name: "read_file",
    args: { path: "../outside" },
  };
  const result = await reg.dispatch(call, ctx);
  expect(result).toMatch(/^\[error\] invalid args for read_file:/);
  expect(result).toMatch(/\.\./);
});

test("schema rejects absolute Unix path", async () => {
  const reg = new ToolRegistry();
  reg.register(readFileTool);
  const call: ToolCall = {
    id: "1",
    name: "read_file",
    args: { path: "/etc/passwd" },
  };
  const result = await reg.dispatch(call, ctx);
  expect(result).toMatch(/^\[error\] invalid args for read_file:/);
});

test("schema rejects absolute Windows-style path", async () => {
  const reg = new ToolRegistry();
  reg.register(readFileTool);
  const call: ToolCall = {
    id: "1",
    name: "read_file",
    args: { path: "C:\\Windows\\System32\\config\\SAM" },
  };
  const result = await reg.dispatch(call, ctx);
  expect(result).toMatch(/^\[error\] invalid args for read_file:/);
});

// --- handler-level rejection (symlink escape) ----------------------------

test("handler rejects a symlink that escapes the workspace via realpath check", async () => {
  // Create a file outside the workspace
  const outside = join(fakeHome, "secret.txt");
  await writeFile(outside, "nope");

  // Create a symlink inside the workspace pointing outside
  const link = join(workspaceDir, "escape");
  await symlink(outside, link);

  const result = await readFileTool.handler({ path: "escape" }, ctx);
  expect(result).toBe("[error] read_file: path escapes workspace");
});

// --- handler-level error: missing file -----------------------------------

test("handler returns error string for a non-existent path", async () => {
  const result = await readFileTool.handler({ path: "no-such-file.txt" }, ctx);
  expect(result).toMatch(/^\[error\] read_file: cannot resolve path:/);
});

// --- integration through the registry ------------------------------------

test("registry-dispatch path: schema validation + handler succeed for a valid file", async () => {
  await writeFile(join(workspaceDir, "ok.txt"), "ok");

  const reg = new ToolRegistry();
  reg.register(readFileTool);
  const call: ToolCall = {
    id: "1",
    name: "read_file",
    args: { path: "ok.txt" },
  };
  const result = await reg.dispatch(call, ctx);
  expect(result).toBe("ok");
});
