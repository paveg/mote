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

## Completed milestone: M4 — A2A endpoint ✅

Completed 2026-05-03 across 2 commits (Wave 1 + Wave 2). RestrictedRegistry pattern (ADR-0011 D4) + SqliteTaskStore + Bun/Workers entrypoints.

### M4 done criteria

- [x] `bun run a2a-serve --port 8787` starts a local Bun A2A server (default bind `127.0.0.1`)
- [x] `wrangler deploy` ships the same agent on Cloudflare Workers (HTTPS via Workers default)
- [x] `POST /` (JSON-RPC `message/send`) round-trips through `runLoop` with a **restricted tool surface** (skills with `mcp: public` only)
- [x] `GET /.well-known/agent-card.json` returns mote's card without auth, listing only `mcp: public` skills
- [x] `tasks/resubscribe` after server restart succeeds against SqliteTaskStore; falls back to InMemoryTaskStore on Workers
- [x] Bearer token validation (ADR-0011 D2), TLS fail-closed (D1), redaction canary test (D3), RestrictedRegistry isolation (D4)

### Out of scope for M4

Per-skill `mcp.tools` allowlist, zxcvbn entropy estimation, multi-token rotation, OAuth/mTLS, D1/Durable Objects task store, rate limiting, OS-layer sandbox.

---

## Completed milestone: M5 — Telegram channel ✅

Completed 2026-05-03 across 2 waves (10 commits total). Project total: **~2,820 LOC production / 320 unit tests + 1 skip + e2e smoke covering M0/M1/M2/M4/M5 fail-closed**.

### M5 done criteria

- [x] `bun run gateway` long-polls `getUpdates` against `https://api.telegram.org/bot<token>/getUpdates` (ADR-0012 D1)
- [x] `MOTE_TELEGRAM_TOKEN` validated at startup; fail-closed if unset/malformed (D2)
- [x] Bot token redaction canary tests at every error path: callApi (3 paths), defaultAgentReply, gateway outer catch (multi-occurrence via `split.join`), audit log
- [x] Allowlist persisted at `<workspaceDir>/telegram-allowlist.json` (mode `0o600`); not in `state.db` (D3)
- [x] Pairing flow: 128-bit hex code via `crypto.randomBytes(16)`; `/approve <code>` adds to allowlist; codes single-use, 24h TTL, in-memory; discriminated `RedeemResult` distinguishes `not_found` vs `expired` so the bot replies correctly per ADR-0012 §Verification (D4)
- [x] `/revoke <userId>` removes from allowlist; revoked user re-enters pairing flow on next DM (D4)
- [x] Approved DMs (master OR paired user) → `runLoop` receives the same RestrictedRegistry (no master opt-in path) (D5)
- [x] Inbound envelope normalized to `{ channel: "telegram", from, timestamp, body }` (D6)
- [x] Audit log at `<workspaceDir>/telegram-audit.log` (mode `0o600`); pairing codes stored as SHA-256 8-hex prefix; bot token never written; `\t` / `\n` / `\r` sanitized from user-controlled fields to prevent log injection (D7)
- [x] Voice / photo / file / unrecognized media → `[unsupported: <kind>]` envelope → "Sorry, text only." reply; group / channel posts silently ignored at `normalizeUpdate` (D8)

### M5 implementation tasks (all completed)

#### Wave 1 — primitives (3 commits each: feat + review-driven fix)

| # | Module | Commits |
|---|---|---|
| 1 | `src/channels/telegram-allowlist.ts` (file-backed, 0o600, atomic write) | `9260e1f` + `fed792c` (await/valibot diag/remove coverage) |
| 2 | `src/channels/telegram-pairing.ts` (128-bit codes, 24h TTL, single-use) | `bfb5382` + `4764228` (discriminated RedeemResult) + `2b30d57` (slot-consumed assertion) |
| 3 | `src/channels/telegram-audit.ts` (token-redacted, SHA-256 prefix) | `9edef14` + `b30d67c` (empty-token guard / recreation 0o600 / log-injection sanitize) |

Wave 1 LOC: 193 production / 271 tests.

#### Wave 2 — gateway + entry + e2e + docs

| # | Module | Commits |
|---|---|---|
| 5 | `src/channels/telegram.ts` envelope normalization (DM-only) | `0cb1095` + `334a39e` (unknown-media / optional from) |
| 6 | `src/channels/telegram.ts` validateToken + RestrictedRegistry builder | `74b345e` + `bf28113` (trailing-newline test) |
| 7a | `src/channels/telegram.ts` callApi (token-redacting HTTP wrapper) | `08870a5` |
| 7b | `src/channels/telegram.ts` dispatch + long-poll | `732881e` + `13c66ba` (multi-occurrence redaction / audit semantics / post-revoke test) |
| 8 | `src/entry/gateway.ts` + `src/entry/gateway-opts.ts` | `736d305` |
| 9 | `tests/e2e/m0.sh` M5 fail-closed startup smoke | `eb74a4c` |
| 10 | `README.md` (M0–M5 entries + Telegram setup) | `6b86d57` |

Wave 2 LOC: 432 production / 903 tests.

### Security invariants from prior milestones still hold

- ADR-0008 workspace confinement — Telegram allowlist + audit live inside `workspaceDir`
- ADR-0011 D4 RestrictedRegistry — same mechanism reused; built-in tools never reach Telegram
- 0o600 file-mode discipline — extended to `telegram-allowlist.json` and `telegram-audit.log`
- Token redaction regression tests — added at every error path (canary asserts no token substring leaks)

### Out of scope for M5

- Voice / photo / file / sticker / poll content — text only (D8)
- Group chat / channel posts — DM only (D8)
- Webhook transport — long-poll only; webhook deferred to a follow-up ADR (D1)
- Multi-bot / multiple `MOTE_TELEGRAM_TOKEN` instances
- Rate limiting beyond pairing-code attempts
- i18n of bot replies (English only)
- Master opt-in to full registry — explicitly rejected by ADR-0012 D5

---

## No active milestone

M0–M5 are all shipped. The roadmap milestones are complete. Next directions (none in flight):

- Webhook transport for Telegram (post-M5 ADR; needed only if Workers deployment becomes attractive)
- `write_file` tool ADR + implementation
- `network-fetch` tool ADR + implementation
- `bash` tool implementation (ADR-0013 already locks the policy)

---

## Security backlog (carried across milestones)

### Pre-channel ADR backlog

- [ ] **Before M3 (MCP server)**: write **ADR-0009: MCP server security model**. Cover transport (stdio default; TCP behind shared-secret token), capability gating for `invoke_skill` (full tool registry vs curated subset), and rejection of unauthenticated TCP callers.
- [ ] **Before M4 (A2A endpoint)**: write **ADR-0010: A2A endpoint security**. Cover `Access-Control-Allow-Origin` allowlist (no `*`), rate limiting (Hono `hono/rate-limiter`), request body size cap.
- [x] **Before M5 (Telegram pairing)**: written as **ADR-0012** (Accepted 2026-05-03) — long-poll default, bot-token validated + redacted, allowlist file (`0o600`, separate from `state.db`), 128-bit single-use pairing codes with 24h TTL, RestrictedRegistry **always** (no master opt-in), normalized envelope, audit log with SHA-256-prefixed codes
- [x] **Before any `bash` tool**: written as **ADR-0013** (Accepted 2026-05-03) — sandbox required (`srt` / `nono`), allowlist mode default, workspace-confined cwd, timeout / output cap / audit log, opt-in via `MOTE_BASH_ENABLED`, never exposed via MCP / A2A
- [ ] **Before any `write_file` tool**: write a parallel ADR (workspace-confined; audit log; no sandbox needed; same shell-metachar concerns absent)
- [ ] **Before any `network-fetch` tool**: write a parallel ADR (host allowlist; timeout; SSRF block via private-IP rejection)

### Pentest 2026-05-03 follow-up — remaining MEDIUM findings

A pentest pass on 2026-05-03 produced 8 HIGH + 12 MEDIUM findings. The 8 HIGH were all addressed in PRs #1–#9 (merged). 6 MEDIUM remain as follow-up work; severity is "defense-in-depth gap" rather than active exploit vector.

- [ ] **M3 — `memory_edit` length / null-byte limit** (`src/core/tools/memory.ts`). `EditArgs` schema accepts arbitrary-length `replace`. Add `v.maxLength(4096)` (or similar sane cap) and reject embedded `\0` so prompt-injection-driven floods or binary smuggling can't deform MEMORY.md.
- [ ] **M5 — `composeLlmsTxt` skill name/description escaping** (`src/mcp/llms-txt.ts:33-36`). Skill `name` and `description` flow into Markdown without escape; a SKILL.md with `\n## Injected Heading` corrupts the generated `llms.txt`. Strip or escape `\n` / `\r` (and control chars) before embedding.
- [ ] **M8 — Telegram audit log rotation** (`src/channels/telegram-audit.ts`). Append-only log grows unbounded; a slow-pairing-storm DoS over months can fill disk. Add size-based rotation (e.g., truncate-on-2MB or roll to `.1` / `.2`) or document an external `logrotate` config.
- [ ] **M9 — openai-compat error body sanitize** (`src/providers/openai-compat.ts:258-269`). The `text.slice(0, 200)` snippet from a provider error body could echo a Bearer / `sk-` token if the upstream proxy reflects auth in error messages. Strip patterns matching `/(Bearer|sk-|api[-_]?key)\S+/gi` before logging or surfacing.
- [ ] **M10 — `AbortSignal` propagation to `provider.complete()`** (`src/core/loop.ts`, both providers). `ctx.signal` is checked at the top of the outer while loop but not forwarded into the in-flight HTTP fetch. SIGINT mid-call doesn't terminate the request. Add `signal?: AbortSignal` to `CompletionRequest` and pipe to `fetch({ signal })` / Anthropic SDK.
- [ ] **M12 — `/revoke` Number.isSafeInteger guard** (`src/channels/telegram.ts` /revoke command parser). `parseInt` accepts `-99999999999999999999` (unsafe integer) and forwards to `allowlist.remove`. No security impact today, but adds confusing master replies and a future-bug surface. Add `Number.isSafeInteger` rejection before dispatch.

Each can land as a single-PR follow-up; none requires a new ADR. Recommended priority: M10 (operator UX — Ctrl-C should actually stop) > M9 (defense-in-depth on token leak) > M3 + M5 (input validation hardening) > M8 (long-term ops) > M12 (cosmetic).

## Completed milestones

- **M0 — walking skeleton** (2026-05-03). 14 commits, 799 LOC production / 1,347 LOC tests, 71 unit tests + 1 e2e smoke. All five done criteria met.
- **OpenAI-compat provider** (2026-05-03, post-M0 unblock). 3 commits, +286 LOC production / +420 LOC tests. `LLM_PROVIDER=openai-compat` switches to OpenAI Chat Completions wire format; same `Provider` interface, no `openai` SDK dep.
- **M1 — workspace + skills** (2026-05-03). 2 commits, +569 LOC production / +443 LOC tests. agentskills.io directory layout (`SOUL.md` / `MEMORY.md` / `skills/<name>/SKILL.md`) loaded at startup; skills exposed as LLM tools; `/<name>` slash command wired up; hand-rolled frontmatter parser keeps the dep tree thin.
- **M2 — SQLite + memory nudge** (2026-05-03). 2 commits, +328 LOC production / +396 LOC tests. `JsonlState` replaced by `SqliteState` (bun:sqlite + FTS5 trigram, 0o600 + WAL pragmas); `search_sessions` exposed; `memory_append` / `memory_edit` tools with single-occurrence-edit enforcement; periodic `memory_nudge` system message at the configured interval (default 10 iterations).
- **Boundary CRITICAL fixes + Tier 1/2 cost work** (2026-05-03, post-M2). 3 commits: pinned 4 audited boundary cases (no code fixes needed — implementations already correct), added `parent_session_id` schema with idempotent migration (recovers impl-guide §5 deviation, foundation for Tier 3 compaction), split system prompt into multi-block cached sections so MEMORY.md edits no longer invalidate the base/SOUL caches. 9 new tests, 172 unit tests + 1 skip.
- **M3 — MCP server export** (2026-05-02). 2 commits (foundations + server). `LoadedSkill` gains `mcp: "public" | "private"` field; `SqliteState` gains `listSessions` / `getSession`; `src/mcp/server.ts` exposes 6 ADR-0009 D2 tools; `src/mcp/llms-txt.ts` generates llms.txt on startup; `src/entry/mcp-serve.ts` wires stdio transport. 218 unit tests + 1 skip.
- **M4 — A2A endpoint** (2026-05-03). 2 commits (Wave 1 + Wave 2). `SqliteTaskStore` adds the `a2a_tasks` table; `src/channels/a2a.ts` builds a per-request `RestrictedRegistry` (public skills only), validates the bearer token (length + denylist) at startup, and redacts the `Authorization` header before any logger sees it (ADR-0011 D2/D3/D4); `src/entry/a2a-serve.ts` fail-closes when a non-localhost bind lacks TLS env (D1); `src/entry/a2a-worker.ts` + `wrangler.toml` ship the same factory on Cloudflare Workers with `InMemoryTaskStore`.
- **M5 — Telegram channel** (2026-05-03). 10 commits across 2 waves (Wave 1 = 3 primitives, Wave 2 = gateway + entry + smoke + docs). 625 LOC production / 1,174 LOC tests. ADR-0012 12 §Verification items all mapped to tests; CRITICAL findings caught in review (vacuous `rejects.toThrow`, `String.prototype.replace` redacting only first occurrence, audit `approved` semantic mismatch on unsupported content) all root-cause fixed before merge. RestrictedRegistry pattern carried over from ADR-0011 — Telegram is always restricted, no master opt-in (D5).
- **Pentest 2026-05-03 hardening series** (2026-05-03 → 2026-05-04). Authorized owner-driven defensive pentest across 4 domains (Telegram / A2A / MCP+fs / provider+prompt-injection) found 8 HIGH + 12 MEDIUM. ADR-0014 (untrusted content fencing — MEMORY.md `<memory>` fence + sentinel, skill output `<skill-output>` fence, frontmatter duplicate-key throw) and ADR-0015 (sub-call cost containment — skill sub-calls now deduct from the iteration budget) accepted as the policy layer. 9 fix PRs (#1–#9) merged via rebase/squash with linear history, +40 unit tests (320 → 360 pass). 6 MEDIUM remain in the follow-up backlog above. Repo went public at https://github.com/paveg/mote with MIT LICENSE; branch protection later tightened (`enforce_admins=true`, PR-required, no direct push) after a discipline slip — recorded in `tasks/lessons.md`. `tasks/dogfood-notes.md` added as the hands-on smoke checklist for capturing real-use issues.
