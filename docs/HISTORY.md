# History

Curated milestone-by-milestone summary of mote's development. Source of truth for the project's narrative — git log carries the granular record, ADRs under [`adr/`](./adr/) carry the design decisions, and this file ties them together.

For current work, see [GitHub Issues](https://github.com/paveg/mote/issues). The active backlog (pentest follow-ups, dogfood findings) lives there, not here.

---

## Roadmap milestones

- **M0 — walking skeleton** (2026-05-03). 14 commits, 799 LOC production / 1,347 LOC tests, 71 unit tests + 1 e2e smoke. All five done criteria met.
- **OpenAI-compat provider** (2026-05-03, post-M0 unblock). 3 commits, +286 LOC production / +420 LOC tests. `LLM_PROVIDER=openai-compat` switches to OpenAI Chat Completions wire format; same `Provider` interface, no `openai` SDK dep.
- **M1 — workspace + skills** (2026-05-03). 2 commits, +569 LOC production / +443 LOC tests. agentskills.io directory layout (`SOUL.md` / `MEMORY.md` / `skills/<name>/SKILL.md`) loaded at startup; skills exposed as LLM tools; `/<name>` slash command wired up; hand-rolled frontmatter parser keeps the dep tree thin.
- **M2 — SQLite + memory nudge** (2026-05-03). 2 commits, +328 LOC production / +396 LOC tests. `JsonlState` replaced by `SqliteState` (bun:sqlite + FTS5 trigram, 0o600 + WAL pragmas); `search_sessions` exposed; `memory_append` / `memory_edit` tools with single-occurrence-edit enforcement; periodic `memory_nudge` system message at the configured interval (default 10 iterations).
- **Boundary CRITICAL fixes + Tier 1/2 cost work** (2026-05-03, post-M2). 3 commits: pinned 4 audited boundary cases (no code fixes needed — implementations already correct), added `parent_session_id` schema with idempotent migration (recovers impl-guide §5 deviation, foundation for Tier 3 compaction), split system prompt into multi-block cached sections so MEMORY.md edits no longer invalidate the base/SOUL caches. 9 new tests, 172 unit tests + 1 skip.
- **M3 — MCP server export** (2026-05-02). 2 commits (foundations + server). `LoadedSkill` gains `mcp: "public" | "private"` field; `SqliteState` gains `listSessions` / `getSession`; `src/mcp/server.ts` exposes 6 ADR-0009 D2 tools; `src/mcp/llms-txt.ts` generates llms.txt on startup; `src/entry/mcp-serve.ts` wires stdio transport. 218 unit tests + 1 skip.
- **M4 — A2A endpoint** (2026-05-03). 2 commits (Wave 1 + Wave 2). `SqliteTaskStore` adds the `a2a_tasks` table; `src/channels/a2a.ts` builds a per-request `RestrictedRegistry` (public skills only), validates the bearer token (length + denylist) at startup, and redacts the `Authorization` header before any logger sees it (ADR-0011 D2/D3/D4); `src/entry/a2a-serve.ts` fail-closes when a non-localhost bind lacks TLS env (D1); `src/entry/a2a-worker.ts` + `wrangler.toml` ship the same factory on Cloudflare Workers with `InMemoryTaskStore`.
- **M5 — Telegram channel** (2026-05-03). 10 commits across 2 waves (Wave 1 = 3 primitives, Wave 2 = gateway + entry + smoke + docs). 625 LOC production / 1,174 LOC tests. ADR-0012 12 §Verification items all mapped to tests; CRITICAL findings caught in review (vacuous `rejects.toThrow`, `String.prototype.replace` redacting only first occurrence, audit `approved` semantic mismatch on unsupported content) all root-cause fixed before merge. RestrictedRegistry pattern carried over from ADR-0011 — Telegram is always restricted, no master opt-in (D5).

## Hardening series

- **Pentest 2026-05-03 hardening series** (2026-05-03 → 2026-05-04). Authorized owner-driven defensive pentest across 4 domains (Telegram / A2A / MCP+fs / provider+prompt-injection) found 8 HIGH + 12 MEDIUM. ADR-0014 (untrusted content fencing — MEMORY.md `<memory>` fence + sentinel, skill output `<skill-output>` fence, frontmatter duplicate-key throw) and ADR-0015 (sub-call cost containment — skill sub-calls now deduct from the iteration budget) accepted as the policy layer. 9 fix PRs (#1–#9) merged with linear history, +40 unit tests (320 → 360 pass). 6 MEDIUM remain as [pentest-follow-up issues](https://github.com/paveg/mote/labels/pentest-follow-up). Repo went public with MIT LICENSE; branch protection tightened (`enforce_admins=true`, PR-required, no direct push) after a discipline slip — the lesson was elevated into the global `~/.claude/rules/workflow.md` rather than kept project-local.
