import { homedir as defaultHomedir } from "node:os";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";

// Internal function for getting the home directory. Can be overridden in tests.
let _getHomeDir = defaultHomedir;

// For test isolation only. Do not use in production code.
export function _setHomeDirForTest(fn: () => string): void {
  _getHomeDir = fn;
}

// For test isolation only. Resets to the default homedir.
export function _resetHomeDir(): void {
  _getHomeDir = defaultHomedir;
}

// Resolves the on-disk workspace for a given agent id. Pure function — no I/O.
// The single security boundary for filesystem tools (see ADR-0008).
export function getWorkspaceDir(agentId: string): string {
  return join(_getHomeDir(), ".mote", "agents", agentId);
}

// Creates the workspace and `sessions/` subdirectory if they do not exist.
// Idempotent: safe to call on every CLI launch.
export async function ensureWorkspace(agentId: string): Promise<string> {
  const dir = getWorkspaceDir(agentId);
  await mkdir(join(dir, "sessions"), { recursive: true });
  return dir;
}
