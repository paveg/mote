# ADR-0004: Use SQLite + FTS5 (trigram tokenizer) for storage

## Status

Accepted

## Context

Session history and full-text search need a persistence layer. Candidates:

1. JSONL files only
2. SQLite + FTS5 (trigram)
3. LanceDB (vector search)

Requirements:

- Cross-session search (M2)
- Full-text search that works cleanly on CJK
- Avoid adding dependencies
- Keep everything inside `~/.mote/agents/<id>/state.db`

## Decision

**Adopt SQLite + FTS5 with the trigram tokenizer.**

- M0/M1 start thin with `~/.mote/agents/<id>/sessions/<id>.jsonl`
- M2 switches to `state.db`
- FTS5 ships with `bun:sqlite` (requires SQLite 3.34+; the version Bun ships with is newer)
- A trigger keeps `messages_fts` in sync with the `messages` table

Schema highlight:

```sql
CREATE VIRTUAL TABLE messages_fts USING fts5(
  content,
  session_id UNINDEXED,
  content='messages',
  content_rowid='rowid',
  tokenize='trigram'
);
```

## Consequences

### Positive

- Hermes validated this exact choice (`hermes_state.py:38–150`)
- Trigram handles CJK more cleanly than BM25
- Zero new dependencies (only `bun:sqlite`)
- DB file size projected to stay under 10 MB at 1k messages

### Negative

- No semantic vector search (deferred to M5+, added when actually needed)
- Schema migrations must be hand-written (the project intentionally avoids ORMs)

Rejected: JSONL only (no cross-session search), LanceDB (premature for vectors, heavy dependency).
