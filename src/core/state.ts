import { appendFile, chmod, readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";

import type { Message } from "@/core/types";
import type { SessionState } from "@/core/context";

// JSONL-backed session state for M0/M1.
//
// File layout:
//   <workspaceDir>/sessions/<sessionId>.jsonl
//
// Each line is a JSON-serialized Message. SessionState's contract is
// forward-declared in core/context.ts; this class is its only
// implementation in M0.
//
// Persistence guarantees:
// - Each appendMessages call writes synchronously through a single
//   awaited fs call. Once the await resolves, messages are durable
//   (within OS write cache). The agent loop is responsible for
//   awaiting persistence before treating a turn as complete.
// - SIGINT handling lives in the agent loop / CLI entry, not here.
//   This module is pure I/O.
//
// Security:
// - Files are written with mode 0o600. Default umask (022) on Linux
//   would otherwise leave session logs world-readable. The directory
//   itself is 0o700 (set by workspace.ensureWorkspace).
// - Serialization is JSON.stringify only — never template strings.
//   This makes embedded newlines / quotes / backslashes safe across
//   the round-trip.
export class JsonlState implements SessionState {
  constructor(private readonly workspaceDir: string) {}

  async appendMessages(sessionId: string, messages: Message[]): Promise<void> {
    if (messages.length === 0) return;
    const path = this.sessionPath(sessionId);
    const data = messages.map(m => JSON.stringify(m)).join("\n") + "\n";
    // mode option only applies to file creation; chmod afterwards
    // ensures the mode is correct even if the file already existed
    // with a wider mode.
    await appendFile(path, data, { mode: 0o600 });
    await chmod(path, 0o600);
  }

  async loadLatestSession(): Promise<Message[]> {
    const dir = join(this.workspaceDir, "sessions");
    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch {
      return []; // no sessions directory yet → no history
    }
    const jsonlFiles = entries.filter(f => f.endsWith(".jsonl"));
    if (jsonlFiles.length === 0) return [];

    const stats = await Promise.all(
      jsonlFiles.map(async f => {
        const s = await stat(join(dir, f));
        return { path: join(dir, f), mtimeMs: s.mtimeMs };
      }),
    );
    stats.sort((a, b) => b.mtimeMs - a.mtimeMs);
    const latest = stats[0];
    if (!latest) return [];

    const content = await readFile(latest.path, "utf8");
    const trimmed = content.trim();
    if (trimmed.length === 0) return [];
    return trimmed.split("\n").map(line => JSON.parse(line) as Message);
  }

  private sessionPath(sessionId: string): string {
    return join(this.workspaceDir, "sessions", `${sessionId}.jsonl`);
  }
}
