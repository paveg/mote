import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { getWorkspaceDir, ensureWorkspace } from "@/core/workspace";

let fakeHome: string;

beforeEach(async () => {
  fakeHome = await mkdtemp(join(tmpdir(), "mote-test-"));
});

afterEach(async () => {
  await rm(fakeHome, { recursive: true, force: true });
});

test("getWorkspaceDir returns ~/.mote/agents/<id> with no I/O", () => {
  expect(getWorkspaceDir("default", fakeHome)).toBe(
    join(fakeHome, ".mote", "agents", "default"),
  );
});

test("getWorkspaceDir handles arbitrary agent ids", () => {
  expect(getWorkspaceDir("alpha", fakeHome)).toBe(
    join(fakeHome, ".mote", "agents", "alpha"),
  );
  expect(getWorkspaceDir("with-dashes", fakeHome)).toBe(
    join(fakeHome, ".mote", "agents", "with-dashes"),
  );
});

test("ensureWorkspace creates the workspace and sessions subdirectory", async () => {
  const dir = await ensureWorkspace("default", fakeHome);
  expect(dir).toBe(join(fakeHome, ".mote", "agents", "default"));

  const workspaceStat = await stat(dir);
  expect(workspaceStat.isDirectory()).toBe(true);

  const sessionsStat = await stat(join(dir, "sessions"));
  expect(sessionsStat.isDirectory()).toBe(true);
});

test("ensureWorkspace is idempotent — second call does not throw", async () => {
  await ensureWorkspace("default", fakeHome);
  await ensureWorkspace("default", fakeHome); // must not throw on existing dirs
  const sessionsStat = await stat(
    join(fakeHome, ".mote", "agents", "default", "sessions"),
  );
  expect(sessionsStat.isDirectory()).toBe(true);
});

test("getWorkspaceDir rejects agentId with path traversal", () => {
  expect(() => getWorkspaceDir("../bad", fakeHome)).toThrow(/Invalid agentId/);
  expect(() => getWorkspaceDir("a/b", fakeHome)).toThrow(/Invalid agentId/);
  expect(() => getWorkspaceDir("", fakeHome)).toThrow(/Invalid agentId/);
  expect(() => getWorkspaceDir(".", fakeHome)).toThrow(/Invalid agentId/);
});

test("ensureWorkspace creates directories with mode 0o700", async () => {
  const dir = await ensureWorkspace("default", fakeHome);
  const dirStat = await stat(dir);
  // mask off file-type bits, keep permission bits
  expect(dirStat.mode & 0o777).toBe(0o700);

  const sessionsStat = await stat(join(dir, "sessions"));
  expect(sessionsStat.mode & 0o777).toBe(0o700);
});
