# Current tasks

## Completed milestone: M0 — walking skeleton ✅

Completed 2026-05-03. 14 commits since the initial scaffold; 799 LOC of production code, 1,347 LOC of tests, 71 unit tests passing + 1 e2e smoke script.

### M0 done criteria

- [x] `bun run agent` starts an interactive session — `src/entry/agent.ts`
- [x] An LLM response comes back via the Anthropic API — `createAnthropicProvider` (default in `buildContext`)
- [x] One built-in tool (`read_file`) is actually dispatched — `src/core/tools/read_file.ts`, registered by default
- [x] Session log is appended to `~/.mote/sessions/<id>.jsonl` — `JsonlState` (mode 0o600) in `src/core/state.ts`, called per-iteration in `runLoop`
- [x] `Ctrl+C` interrupts; restart resumes from the last state — first SIGINT aborts via `AbortController`; `loadLatestSession()` at startup loads prior history

### M0 verification scripts

- [x] `tests/e2e/m0.sh` — pipes a prompt that triggers `read_file`, asserts session jsonl exists with mode 0o600 and the response includes the expected marker. Auto-skips without `LLM_API_KEY`.
- [x] Resume scenario — covered by `JsonlState` unit tests (`tests/core/state.test.ts`) plus the CLI's `loadLatestSession()` call site.

### LOC accounting

| File | LOC |
|---|---|
| `src/core/types.ts` | 49 |
| `src/core/workspace.ts` | 37 |
| `src/core/registry.ts` | 73 |
| `src/core/state.ts` | 75 |
| `src/core/context.ts` | 103 |
| `src/core/loop.ts` | 89 |
| `src/core/tools/read_file.ts` | 65 |
| `src/entry/agent.ts` | 90 |
| `src/providers/types.ts` | 44 |
| `src/providers/anthropic.ts` | 174 |
| **Total** | **799** |

> Yellow flag: roadmap's "M2 ≤ 600 LOC" freeze trigger — M0 alone exceeds it. Most files are under 100 LOC so it isn't runaway complexity; the Anthropic provider's wire-format converters account for ~125 of the 174 LOC. Reconsider the M2 ceiling when M2 starts; do not retrofit M0 to chase it.

### M0 implementation tasks (all completed)

| # | Task | Status |
|---|---|---|
| 1 | Shared data types — `src/core/types.ts` | ✅ commit 57630c5 + fc8118d |
| 1b | Provider I/O types — `src/providers/types.ts` | ✅ commit c7efaae + f8dcf19 |
| 2 | Workspace resolution — `src/core/workspace.ts` | ✅ commit b1321a0 + 537eddf + 9c139af |
| 3 | Tool registry — `src/core/registry.ts` | ✅ commit 0c31360 (+ 3f7f63f errorMode fix) |
| 3b | Agent context — `src/core/context.ts` | ✅ commit 0c31360 + 3141615 + 3f7f63f |
| 4 | State persistence (jsonl) — `src/core/state.ts` | ✅ commit 393e2d9 |
| 5 | Anthropic provider — `src/providers/anthropic.ts` | ✅ commit bab923b + f780569 |
| 6 | Built-in tool — `read_file` per ADR-0008 — `src/core/tools/read_file.ts` | ✅ commit bb3f0a3 |
| 7 | Agent loop — `src/core/loop.ts` | ✅ commit fc2a588 |
| 8 | CLI entrypoint — `src/entry/agent.ts` | ✅ commit 3f7f63f |
| 9 | E2E verification — `tests/e2e/m0.sh` | ✅ commit 57b0225 |

All security invariants from the M0 security pass landed: agentId whitelist + `0o700` dir mode, session files `0o600` + `JSON.stringify` round-trip, valibot dispatch invariant (no bypass path), Anthropic API-key sanitization regression test, ADR-0008 workspace confinement (schema + realpath + prefix-check, both sides canonicalized for macOS `/var → /private/var` symlink).

### Out of scope for M0

Skill mechanism / SQLite / memory nudge / multiple channels / MCP / A2A. (Per the roadmap, these belong to M1+.)

---

## Completed milestone: M1 — workspace + skills ✅

Completed 2026-05-03 across 2 commits (Wave A + Wave B). Total project: 1,368 LOC production / ~1,800 LOC tests / 131 unit tests + e2e smoke.

### M1 done criteria

- [x] `~/.mote/agents/<id>/` reads `SOUL.md`, `MEMORY.md`, and `skills/<name>/SKILL.md` — `loadSoul`, `loadMemory`, `loadSkills` called in parallel by `buildContext`
- [x] At startup, SKILL.md frontmatter description is exposed as an LLM tool — `createSkillToolDefinition` registers each as `ToolDefinition` alongside `read_file`
- [x] `/<skill-name>` slash command explicitly invokes a skill — `src/entry/agent.ts` rewrites the user input to "Please execute the <name> skill" when `<name>` matches a registered tool
- [x] Hermes / OpenClaw SKILL.md files work as-is (compatibility) — frontmatter parser only requires `name` + `description` (extras ignored), `SkillArgs = v.record(v.string(), v.unknown())` accepts any LLM-supplied shape

### M1 implementation tasks (all completed)

| # | Module | Status |
|---|---|---|
| 1 | Workspace SOUL/MEMORY readers | ✅ commit c0907ec (Wave A, extends `src/core/workspace.ts`) |
| 2 | Frontmatter parser — `src/skills/frontmatter.ts` | ✅ commit c0907ec |
| 3 | Skill scanner — `src/skills/loader.ts` | ✅ commit c0907ec |
| 4 | Skill handler — `src/skills/handler.ts` | ✅ commit 91894e2 (Wave B) |
| 5 | System-prompt composer — `src/core/persona.ts` | ✅ commit 91894e2 |
| 6 | buildContext wiring (auto-register skills + composed system prompt) | ✅ commit 91894e2 |
| 7 | CLI slash command `/<name>` | ✅ commit 91894e2 |
| 8 | E2E extension — `tests/e2e/m0.sh` adds `/hello` smoke | ✅ commit 91894e2 |

### Updated LOC accounting (project-wide)

| Layer | LOC |
|---|---|
| `src/core/*` (types, registry, state, context, loop, workspace, persona) | 503 |
| `src/core/tools/read_file.ts` | 65 |
| `src/providers/*` (types, anthropic, openai-compat) | 504 |
| `src/skills/*` (types, frontmatter, loader, handler) | 198 |
| `src/entry/agent.ts` | 104 |
| **Total** | **1,368** |

> Yellow flag still active: roadmap's "M2 ≤ 600 LOC" freeze trigger was set against an early estimate; project is at 1,368 LOC at end of M1. The Anthropic provider (174) + OpenAI-compat (286) = 460 LOC alone — both are wire-format converters that don't violate "薄く" once you accept ADR-0005's "two wire formats" decision. Recalibrate the M2 ceiling when M2 starts; do not retrofit M0/M1 to chase it.

### Out of scope for M1

SQLite + FTS5 (M2), memory_nudge (M2), search_sessions (M2), MCP server export (M3), A2A endpoint (M4), Telegram (M5).

---

## Completed milestone: M2 — SQLite + memory nudge ✅

Completed 2026-05-03 across 2 commits (Wave A + Wave B). Project total: **1,696 LOC production / 164 unit tests + 1 skip + 1 e2e smoke**.

### M2 done criteria

- [x] Migrate jsonl → SQLite + FTS5 (trigram tokenizer per ADR-0004) — `SqliteState` in `src/core/state.ts` with FTS5 external-content mode + triggers
- [x] `search_sessions(query)` tool exposed via the registry — `src/core/tools/search_sessions.ts`, valibot schema with limit ∈ [1, 50]
- [x] `memory_nudge_interval` (default 10 turns) — `src/core/memory-nudge.ts` + `runLoop` integration; injects a system-role reminder
- [x] `memory_append` / `memory_edit` tools — `src/core/tools/memory.ts` with 0o600 file mode and single-occurrence enforcement on edit
- [x] DB size architecturally bounded — schema is TEXT/INTEGER only, one index, FTS external-content mode (no text duplication)

### M2 implementation tasks (all completed)

| # | Module | Status |
|---|---|---|
| 1 | `SqliteState` (replaces `JsonlState`) | ✅ commit de10d65 |
| 2 | FTS5 trigram + triggers | ✅ commit de10d65 |
| 3 | `search_sessions` tool | ✅ commit de10d65 |
| 4 | `memory_append` tool | ✅ commit 5b05088 |
| 5 | `memory_edit` tool (single-occurrence) | ✅ commit 5b05088 |
| 6 | `MemoryNudge` class + loop integration | ✅ commit 5b05088 |
| 7 | `buildContext` wiring (auto-register memory tools, nudge default 10) | ✅ commit 5b05088 |
| 8 | E2E extension (`tests/e2e/m0.sh` M2 section) | ✅ commit 5b05088 |

### Security invariants from prior milestones still hold

- Workspace confinement (ADR-0008) for `read_file`
- Session log mode 0o600 — `state.db` and WAL/SHM sidecars all chmod'd
- MEMORY.md mode 0o600 — same pattern (write with mode + chmod)
- valibot dispatch invariant — applies to `search_sessions`, `memory_append`, `memory_edit` like any other tool
- API key sanitization in providers
- FTS5 query phrase-quoting (Wave A) — neutralizes FTS5 syntax injection from LLM-supplied queries
- `tool_use.input` NOT indexed in FTS — prevents accidental secret retrieval via search

### Updated LOC accounting (project-wide)

| Layer | LOC |
|---|---|
| `src/core/*` (types, registry, state, context, loop, workspace, persona, memory-nudge) | 814 |
| `src/core/tools/*` (read_file, search_sessions, memory) | 189 |
| `src/providers/*` (types, anthropic, openai-compat) | 504 |
| `src/skills/*` (types, frontmatter, loader, handler) | 198 |
| `src/entry/agent.ts` | 104 |
| **Total** | **1,696** |

> The roadmap's **"M2 ≤ 600 LOC" freeze trigger** was set against an early estimate. Actual: 1,696 LOC at end of M2 — 2.8× over. Deliberately not retrofitting because each layer is justified: the 504 LOC provider layer is wire-format converters (ADR-0005), the 814 LOC core is the agent loop + state + 8 tools, the 198 LOC skills layer is the agentskills.io implementation. Largest single file is `src/providers/openai-compat.ts` at 286 LOC. The "薄く" target was always aspirational — actual measure is "every LOC is justified by an accepted ADR".

### Out of scope for M2

MCP server export (M3), A2A endpoint (M4), Telegram (M5), bash/write_file tools (still need an ADR), vector search.

---

## Completed milestone: M3 — MCP server export ✅

Completed 2026-05-02 across 2 commits (foundations + server). Project total: **~1,950 LOC production / 218 unit tests + 1 skip**.

### M3 done criteria

- [x] ADR-0009 written and Accepted
- [x] `bun run mcp-serve` stdio MCP server — `@modelcontextprotocol/sdk` (D1)
- [x] 6 public tools: `list_sessions`, `get_session`, `search_sessions`, `read_memory`, `list_skills`, `invoke_skill` (D2)
- [x] `invoke_skill` gated by `mcp: public` frontmatter (D3)
- [x] `get_session` capped at 200 (MOTE_MCP_GET_SESSION_LIMIT override) (D4)
- [x] `llms.txt` auto-generated at startup under `<workspaceDir>/` (D5)
- [x] Errors via `isError: true` MCP envelope (D6)

### M3 implementation tasks (all completed)

| # | Module | Status |
|---|---|---|
| 1 | `mcp` field on `LoadedSkill` + loader validation | ✅ commit bf945c5 |
| 2 | `listSessions` / `getSession` on `SqliteState` | ✅ commit bf945c5 |
| 3 | `src/mcp/server.ts` — 6 MCP tools | ✅ commit (Commit 2) |
| 4 | `src/mcp/llms-txt.ts` — llms.txt generator | ✅ commit (Commit 2) |
| 5 | `src/entry/mcp-serve.ts` — stdio entrypoint | ✅ commit (Commit 2) |
| 6 | `package.json` mcp-serve script | ✅ commit (Commit 2) |

### Updated LOC accounting (project-wide)

| Layer | LOC |
|---|---|
| `src/core/*` | ~850 |
| `src/core/tools/*` | ~189 |
| `src/providers/*` | ~504 |
| `src/skills/*` | ~205 |
| `src/mcp/*` (server + llms-txt) | ~200 |
| `src/entry/*` | ~135 |
| **Total** | **~1,950** |

---

## Next milestone: M4 — A2A endpoint

---

## Security backlog (carried across milestones)

- [ ] **Before M3 (MCP server)**: write **ADR-0009: MCP server security model**. Cover transport (stdio default; TCP behind shared-secret token), capability gating for `invoke_skill` (full tool registry vs curated subset), and rejection of unauthenticated TCP callers.
- [ ] **Before M4 (A2A endpoint)**: write **ADR-0010: A2A endpoint security**. Cover `Access-Control-Allow-Origin` allowlist (no `*`), rate limiting (Hono `hono/rate-limiter`), request body size cap.
- [ ] **Before M5 (Telegram pairing)**: write **ADR-0012: Telegram channel security** (renumbered from 0011 — that slot was taken by A2A endpoint hardening). Cover pairing-code entropy (≥128 bits via `crypto.randomBytes(16).toString("hex")`, single-use), allowlist storage (file with `0o600` or env-var-only, NOT inside writable `state.db`), and inbound `from.id` allowlist enforcement before any tool dispatch.
- [ ] **Before any `bash` / `write_file` / network-fetch tool**: extend **ADR-0008** scope or write a follow-up ADR covering shell metachar handling, executable allowlist, and timeouts.

## Completed milestones

- **M0 — walking skeleton** (2026-05-03). 14 commits, 799 LOC production / 1,347 LOC tests, 71 unit tests + 1 e2e smoke. All five done criteria met.
- **OpenAI-compat provider** (2026-05-03, post-M0 unblock). 3 commits, +286 LOC production / +420 LOC tests. `LLM_PROVIDER=openai-compat` switches to OpenAI Chat Completions wire format; same `Provider` interface, no `openai` SDK dep.
- **M1 — workspace + skills** (2026-05-03). 2 commits, +569 LOC production / +443 LOC tests. agentskills.io directory layout (`SOUL.md` / `MEMORY.md` / `skills/<name>/SKILL.md`) loaded at startup; skills exposed as LLM tools; `/<name>` slash command wired up; hand-rolled frontmatter parser keeps the dep tree thin.
- **M2 — SQLite + memory nudge** (2026-05-03). 2 commits, +328 LOC production / +396 LOC tests. `JsonlState` replaced by `SqliteState` (bun:sqlite + FTS5 trigram, 0o600 + WAL pragmas); `search_sessions` exposed; `memory_append` / `memory_edit` tools with single-occurrence-edit enforcement; periodic `memory_nudge` system message at the configured interval (default 10 iterations).
- **Boundary CRITICAL fixes + Tier 1/2 cost work** (2026-05-03, post-M2). 3 commits: pinned 4 audited boundary cases (no code fixes needed — implementations already correct), added `parent_session_id` schema with idempotent migration (recovers impl-guide §5 deviation, foundation for Tier 3 compaction), split system prompt into multi-block cached sections so MEMORY.md edits no longer invalidate the base/SOUL caches. 9 new tests, 172 unit tests + 1 skip.
- **M3 — MCP server export** (2026-05-02). 2 commits (foundations + server). `LoadedSkill` gains `mcp: "public" | "private"` field; `SqliteState` gains `listSessions` / `getSession`; `src/mcp/server.ts` exposes 6 ADR-0009 D2 tools; `src/mcp/llms-txt.ts` generates llms.txt on startup; `src/entry/mcp-serve.ts` wires stdio transport. 218 unit tests + 1 skip.
