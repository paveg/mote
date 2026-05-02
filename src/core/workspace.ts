import { homedir } from "node:os";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";

// Resolves the on-disk workspace for a given agent id. Pure function — no I/O.
// The single security boundary for filesystem tools (see ADR-0008).
//
// `home` is injectable for tests; defaults to the OS user's home directory.
export function getWorkspaceDir(agentId: string, home: string = homedir()): string {
  return join(home, ".mote", "agents", agentId);
}

// Creates the workspace and `sessions/` subdirectory if they do not exist.
// Idempotent: safe to call on every CLI launch.
//
// `home` is injectable for tests; defaults to the OS user's home directory.
export async function ensureWorkspace(
  agentId: string,
  home: string = homedir(),
): Promise<string> {
  const dir = getWorkspaceDir(agentId, home);
  await mkdir(join(dir, "sessions"), { recursive: true });
  return dir;
}
