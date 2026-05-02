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

## Active milestone: M1 — workspace + skills

> Goal: agentskills.io regulation directory layout. SKILL.md is read at startup and exposed as a tool to the LLM.

### M1 done criteria (from `../research/docs/mote/roadmap.md`)

- [ ] `~/.mote/agents/<id>/` reads `SOUL.md`, `MEMORY.md`, and `skills/<name>/SKILL.md`
- [ ] At startup, SKILL.md frontmatter description is exposed as an LLM tool
- [ ] `/<skill-name>` slash command explicitly invokes a skill
- [ ] Hermes / OpenClaw SKILL.md files work as-is (compatibility)

### M1 implementation tasks (planned; revisit before starting)

- [ ] Workspace loader (read `SOUL.md` / `MEMORY.md` if they exist; fold them into `systemPrompt()`)
- [ ] Frontmatter parser — hand-written ~30 LOC, no `gray-matter` dep
- [ ] Skill scanner — `Bun.Glob` over `skills/*/SKILL.md`, register each as a `ToolDefinition` whose handler invokes the LLM with the skill body
- [ ] CLI slash command — `/<skill-name>` rewrites the user message to "execute skill X"
- [ ] Done script — verify `echo "/hello" | bun run agent` triggers a registered skill

---

## Security backlog (carried across milestones)

- [ ] **Before M3 (MCP server)**: write **ADR-0009: MCP server security model**. Cover transport (stdio default; TCP behind shared-secret token), capability gating for `invoke_skill` (full tool registry vs curated subset), and rejection of unauthenticated TCP callers.
- [ ] **Before M4 (A2A endpoint)**: write **ADR-0010: A2A endpoint security**. Cover `Access-Control-Allow-Origin` allowlist (no `*`), rate limiting (Hono `hono/rate-limiter`), request body size cap.
- [ ] **Before M5 (Telegram pairing)**: write **ADR-0011: Telegram channel security**. Cover pairing-code entropy (≥128 bits via `crypto.randomBytes(16).toString("hex")`, single-use), allowlist storage (file with `0o600` or env-var-only, NOT inside writable `state.db`), and inbound `from.id` allowlist enforcement before any tool dispatch.
- [ ] **Before any `bash` / `write_file` / network-fetch tool**: extend **ADR-0008** scope or write a follow-up ADR covering shell metachar handling, executable allowlist, and timeouts.

## Completed milestones

- **M0 — walking skeleton** (2026-05-03). 14 commits, 799 LOC production / 1,347 LOC tests, 71 unit tests + 1 e2e smoke. All five done criteria met.
