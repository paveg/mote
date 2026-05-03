import { Database } from "bun:sqlite";
import { chmod } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

import type { Message } from "@/core/types";
import type { SessionState, SessionMeta, GetSessionResult } from "@/core/context";

// Schema. content_json is the full ContentBlock[] as JSON; fts_text is
// the denormalized concatenated text used for FTS5 indexing. The FTS
// virtual table uses `content='messages'` external-content mode so the
// text is not duplicated, kept in sync via the trigger.
const SCHEMA = `
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  parent_session_id TEXT REFERENCES sessions(id),
  created_at INTEGER NOT NULL,
  ended_at INTEGER
);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id),
  role TEXT NOT NULL CHECK (role IN ('user','assistant','system')),
  content_json TEXT NOT NULL,
  fts_text TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id, created_at);

CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
  fts_text,
  session_id UNINDEXED,
  content='messages',
  content_rowid='rowid',
  tokenize='trigram'
);

CREATE TRIGGER IF NOT EXISTS messages_ai AFTER INSERT ON messages BEGIN
  INSERT INTO messages_fts(rowid, fts_text, session_id) VALUES (new.rowid, new.fts_text, new.session_id);
END;

CREATE TRIGGER IF NOT EXISTS messages_ad AFTER DELETE ON messages BEGIN
  INSERT INTO messages_fts(messages_fts, rowid, fts_text, session_id) VALUES ('delete', old.rowid, old.fts_text, old.session_id);
END;
`;

// Result shape for searchSessions. Returned to the LLM via the
// search_sessions tool — fields chosen for "what would the LLM want
// to read about a search hit".
export interface SearchHit {
  readonly sessionId: string;
  readonly messageId: string;
  readonly role: "user" | "assistant" | "system";
  readonly snippet: string;       // matched text region; FTS5 snippet()
  readonly createdAt: number;
}

// SQLite-backed implementation of SessionState. One database per
// workspace at <workspaceDir>/state.db. The agent_id is captured at
// construction so callers don't have to thread it through every call.
export class SqliteState implements SessionState {
  private readonly db: Database;

  constructor(
    private readonly workspaceDir: string,
    private readonly agentId: string = "default",
  ) {
    const dbPath =
      workspaceDir === ":memory:" ? ":memory:" : join(workspaceDir, "state.db");
    this.db = new Database(dbPath, { create: true });
    // Pragmas: WAL for crash-safety on concurrent reads, foreign keys
    // for the references constraint to actually fire.
    this.db.exec("PRAGMA foreign_keys = ON");
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec(SCHEMA);
    this.migrate();
    // Apply 0o600 to the db file once it has been created. WAL adds
    // sidecar files (-wal, -shm) that we also lock down.
    if (workspaceDir !== ":memory:") {
      this.applyDbPermissions(dbPath).catch(() => {
        // chmod failures are non-fatal — best effort. Tests on
        // case-sensitive FSes still work.
      });
    }
  }

  private async applyDbPermissions(dbPath: string): Promise<void> {
    for (const suffix of ["", "-wal", "-shm"]) {
      try {
        await chmod(dbPath + suffix, 0o600);
      } catch {
        // ENOENT for sidecars that haven't been written yet — fine.
      }
    }
  }

  // Idempotent migrations. Each block checks the current state and only
  // applies its change when needed, so re-running on a fresh DB is a no-op.
  private migrate(): void {
    const cols = this.db
      .query<{ name: string }, []>("PRAGMA table_info(sessions)")
      .all();
    if (!cols.some(c => c.name === "parent_session_id")) {
      // SQLite ALTER TABLE ADD COLUMN cannot include a REFERENCES clause
      // for an existing table, but the constraint is enforced via the
      // PRAGMA foreign_keys setting set in the constructor — losing the
      // FK declaration on this column for upgraded DBs is acceptable;
      // newly-created DBs (via SCHEMA) get the full constraint.
      this.db.exec("ALTER TABLE sessions ADD COLUMN parent_session_id TEXT");
    }
  }

  async appendMessages(sessionId: string, messages: Message[]): Promise<void> {
    if (messages.length === 0) return;

    // Ensure the session row exists. Use INSERT OR IGNORE so calling
    // appendMessages multiple times for the same session does not
    // overwrite the original created_at.
    const insertSession = this.db.prepare(
      "INSERT OR IGNORE INTO sessions (id, agent_id, created_at) VALUES (?, ?, ?)",
    );
    insertSession.run(sessionId, this.agentId, Date.now());

    const insertMessage = this.db.prepare(
      "INSERT INTO messages (id, session_id, role, content_json, fts_text, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    );

    // Wrap in a transaction for atomicity.
    const tx = this.db.transaction((batch: Message[]) => {
      for (const m of batch) {
        const id = `m_${randomUUID()}`;
        insertMessage.run(
          id,
          sessionId,
          m.role,
          JSON.stringify(m.content),
          extractFtsText(m),
          m.createdAt,
        );
      }
    });
    tx(messages);
  }

  async loadLatestSession(): Promise<Message[]> {
    // Latest session = highest created_at (the session created most
    // recently). Fall back to empty when there are no sessions.
    const sessionRow = this.db
      .query<{ id: string }, []>(
        "SELECT id FROM sessions ORDER BY created_at DESC, id DESC LIMIT 1",
      )
      .get();
    if (!sessionRow) return [];
    return this.loadSession(sessionRow.id);
  }

  // Internal: load all messages for a given session, ordered.
  private loadSession(sessionId: string): Message[] {
    const rows = this.db
      .query<
        { role: "user" | "assistant" | "system"; content_json: string; created_at: number },
        [string]
      >(
        "SELECT role, content_json, created_at FROM messages WHERE session_id = ? ORDER BY created_at ASC, rowid ASC",
      )
      .all(sessionId);
    return rows.map(r => ({
      role: r.role,
      content: JSON.parse(r.content_json),
      createdAt: r.created_at,
    }));
  }

  // FTS5 trigram search over message text. Returns the top N hits
  // ordered by FTS5 relevance (bm25). The snippet is FTS5's built-in
  // highlighting helper — gives the LLM a digestible window.
  async searchSessions(query: string, limit = 20): Promise<SearchHit[]> {
    if (!query.trim()) return [];
    // FTS5 phrase-quoting: wrap in double-quotes and escape embedded
    // double-quotes so that bare words like "absent" or "marker" are
    // not misinterpreted as column-name references in the FTS5 query
    // grammar.
    const ftsQuery = `"${query.replaceAll('"', '""')}"`;
    const rows = this.db
      .query<
        {
          session_id: string;
          message_id: string;
          role: "user" | "assistant" | "system";
          snippet: string;
          created_at: number;
        },
        [string, number]
      >(
        `SELECT
            m.session_id AS session_id,
            m.id AS message_id,
            m.role AS role,
            snippet(messages_fts, 0, '[', ']', '...', 16) AS snippet,
            m.created_at AS created_at
         FROM messages_fts f
         JOIN messages m ON m.rowid = f.rowid
         WHERE messages_fts MATCH ?
         ORDER BY bm25(messages_fts)
         LIMIT ?`,
      )
      .all(ftsQuery, limit);
    return rows.map(r => ({
      sessionId: r.session_id,
      messageId: r.message_id,
      role: r.role,
      snippet: r.snippet,
      createdAt: r.created_at,
    }));
  }

  async listSessions(): Promise<SessionMeta[]> {
    const rows = this.db
      .query<
        { id: string; created_at: number; ended_at: number | null },
        []
      >(
        "SELECT id, created_at, ended_at FROM sessions ORDER BY created_at DESC, id DESC",
      )
      .all();
    return rows.map(r => ({
      id: r.id,
      createdAt: r.created_at,
      endedAt: r.ended_at,
    }));
  }

  async getSession(sessionId: string, limit: number): Promise<GetSessionResult> {
    // Count first to know if we'll truncate
    const total = this.db
      .query<{ n: number }, [string]>(
        "SELECT COUNT(*) AS n FROM messages WHERE session_id = ?",
      )
      .get(sessionId);
    const count = total?.n ?? 0;
    const truncated = count > limit;

    // Fetch the most recent `limit` messages, then reverse to chronological order
    const rows = this.db
      .query<
        { role: "user" | "assistant" | "system"; content_json: string; created_at: number },
        [string, number]
      >(
        "SELECT role, content_json, created_at FROM messages WHERE session_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?",
      )
      .all(sessionId, limit);
    rows.reverse();
    const messages: Message[] = rows.map(r => ({
      role: r.role,
      content: JSON.parse(r.content_json),
      createdAt: r.created_at,
    }));
    return { messages, truncated };
  }

  // Closes the underlying connection. Tests call this in afterEach to
  // avoid leaking handles. Production callers normally let the process
  // exit close the file.
  close(): void {
    this.db.close();
  }
}

// Concatenates the text of every text-block in a Message. tool_use,
// and thinking blocks contribute nothing to FTS — search is over what
// was actually written / said in plain text. tool_result content is
// included as it contains text the user/agent can meaningfully search.
function extractFtsText(m: Message): string {
  const parts: string[] = [];
  for (const block of m.content) {
    if (block.type === "text") parts.push(block.text);
    else if (block.type === "tool_result") parts.push(block.content);
  }
  return parts.join("\n");
}
