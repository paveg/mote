import { homedir } from "node:os";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";

// Whitelist for agent ids. Rejects path-traversal segments (`..`),
// path separators (`/`, `\`), and any character that could disambiguate
// the on-disk location. Keeps the workspace security boundary defensible
// even if `agentId` ever flows from a config file or external input.
const AGENT_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

// Resolves the on-disk workspace for a given agent id. Pure function — no I/O.
// The single security boundary for filesystem tools (see ADR-0008).
//
// `home` is injectable for tests; defaults to the OS user's home directory.
export function getWorkspaceDir(agentId: string, home: string = homedir()): string {
  if (!AGENT_ID_PATTERN.test(agentId)) {
    throw new Error(`Invalid agentId: ${JSON.stringify(agentId)}`);
  }
  return join(home, ".mote", "agents", agentId);
}

// Creates the workspace and `sessions/` subdirectory if they do not exist.
// Idempotent: safe to call on every CLI launch.
//
// Directories are created with mode 0o700 so other users on the host
// cannot enumerate session filenames. Session files themselves are
// written 0o600 in M0 task #4.
//
// `home` is injectable for tests; defaults to the OS user's home directory.
export async function ensureWorkspace(
  agentId: string,
  home: string = homedir(),
): Promise<string> {
  const dir = getWorkspaceDir(agentId, home);
  await mkdir(join(dir, "sessions"), { recursive: true, mode: 0o700 });
  return dir;
}
