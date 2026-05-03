# ADR-0013: bash tool security policy

## Status

Accepted (2026-05-03) — locked-in policy that any future `bash` tool implementation must satisfy

## Context

mote currently has no `bash` tool. The implementation-guide referenced one ("whitelist + per-call confirmation") and the security backlog flagged it as the most dangerous addition. This ADR locks the security baseline **before** the bash tool is built, so there is no "we'll add safety later" failure mode.

The same policy applies in spirit (with adaptations) to two adjacent dangerous tools that share the threat model:

- `write_file` — filesystem mutation inside the workspace
- `network-fetch` (a generic outbound HTTP tool) — exfiltration / SSRF risk

Each gets its own follow-up ADR when implemented; they can refine but not weaken this baseline.

The watchlist memory captures three external references that informed this policy:

- songmu's article ["AI Agent: Inside the Fence"](https://songmu.jp/riji/entry/2026-04-11-ai-agent-inside-the-fence.html) — argues for using mature OS-level fences over custom abstraction
- [`anthropic-experimental/sandbox-runtime` (`srt`)](https://github.com/anthropic-experimental/sandbox-runtime) — Anthropic's Claude Code-aligned wrapper around `sandbox-exec` (macOS) / `bubblewrap` (Linux)
- [`always-further/nono`](https://github.com/always-further/nono) — capability-based, multiplexing sandbox; built-in profiles for OpenClaw and Claude Code; alpha

CLAUDE.md's "Sandbox (Docker / SSH backend) — out of scope" stance is preserved. **OS-level fences via `srt` / `nono` are NOT Docker** — they're process-level and ship as adjacent binaries. This ADR explicitly carves them in as in-scope.

## Decisions

### D1. bash is opt-in, never registered by default

Even after implementation, `bash` is **not registered automatically by `buildContext`**. The user must explicitly enable it via env var:

```
MOTE_BASH_ENABLED=1
```

Missing or any other value → bash is not in the registry. Discovered surface in `list_skills` / agent card → no `bash` entry. This is a hard gate so accidental exposure is impossible.

### D2. OS-level sandbox is required when enabled

When `MOTE_BASH_ENABLED=1`, the bash handler **always** invokes commands through an OS-level sandbox wrapper. The implementation must support at least one of:

- `srt <command>` — Anthropic's `@anthropic-ai/sandbox-runtime`
- `nono run -- <command>` — always-further/nono

Selection via `MOTE_BASH_SANDBOX=srt|nono` env var (default `srt` on macOS/Linux when available).

If neither sandbox tool is on PATH, the bash handler refuses to register at startup with a clear error. **Plain `Bun.spawn(["sh", "-c", cmd])` is forbidden in production.** A test-only `MOTE_BASH_UNSAFE_NO_SANDBOX=1` env exists for unit tests, gated by a `process.env["NODE_ENV"] === "test"` guard.

### D3. Command allowlist is the primary auth gate (not the sandbox alone)

Two operating modes:

| Mode | Description | Default |
|---|---|---|
| `allowlist` | Only commands whose first token matches a configured allowlist (e.g. `["git", "ls", "cat"]`) are dispatched. Shell metachars in subsequent args still pass through to the sandbox. | ✅ default |
| `unrestricted` | Any command goes through the sandbox. The sandbox is the only gate. | opt-in via `MOTE_BASH_MODE=unrestricted` |

Allowlist source: `<workspaceDir>/bash-allowlist.txt` (one binary per line, no shell metachars in the file). Empty / missing file → allowlist mode rejects all commands → the user explicitly populates it.

The allowlist is the **first** filter; the sandbox is the **second**. Defense in depth — neither alone is trusted.

### D4. Workspace-confined cwd (extends ADR-0008)

The handler always invokes the command with `cwd: ctx.workspaceDir`. Combined with the sandbox's filesystem restrictions (srt's "current directory access allowed by default" / nono's capability profile), the bash command can only read/write inside the workspace.

Symlinks following workspace edges, env-var path expansion (`$HOME`, `~`) are blocked at the schema layer (per ADR-0008's existing pattern). The sandbox provides a second layer.

### D5. Timeout, output cap, and structured result

- Default timeout: **30 seconds**, configurable via `MOTE_BASH_TIMEOUT_MS`
- Default stdout+stderr cap: **64 KB combined**, configurable via `MOTE_BASH_OUTPUT_MAX`
- On timeout: SIGTERM, then SIGKILL after a 2s grace period
- On output cap: truncate, append a clear `[output truncated at N bytes]` marker

Tool result (single string per existing ToolHandler contract):

```
$ <command>
<stdout (capped)>
[stderr]
<stderr (capped)>
[exit] <code>
[duration] <ms>ms
```

Stderr is **never** silently dropped — even on success, it surfaces in the result so the model can reason about warnings.

### D6. Per-invocation audit log

Every `bash` dispatch appends a one-line entry to `<workspaceDir>/bash-audit.log` (mode `0o600`):

```
2026-05-03T10:30:00Z  exit=0  duration=482ms  cmd=git status
```

Command text is included. **Output is NOT logged** — that would risk persisting secrets the command happened to print. The audit purpose is "what was attempted, when" — sufficient for after-the-fact triage.

### D7. valibot schema rejects shell metacharacters in arg fields when in allowlist mode

The `command` field is a string. In `allowlist` mode, the schema additionally rejects:

- Backticks `` ` ``
- `$(`/`${` (command/parameter expansion)
- `&&` / `||` / `;` / `|` (command chaining/piping)
- Newlines

This is **not** a security boundary on its own — the sandbox is. It's a schema-level signal that catches obviously malicious-shape inputs before they reach the executor (cleaner errors, faster fail).

In `unrestricted` mode, the schema only rejects null bytes and embedded newlines. Pipes/chaining are allowed because the user explicitly opted out of the strict mode.

### D8. No skill exposure via MCP / A2A

`bash` is **never** exposed via MCP `invoke_skill` or A2A `message/send`, regardless of any `mcp: public` flag elsewhere. The RestrictedRegistry pattern from ADR-0011 D4 enforces this — bash is a built-in, not a skill, and the public registries built for MCP/A2A omit all built-ins.

If a future use case demands a "remote bash" surface, that is its own ADR with its own auth model.

## Consequences

### Positive

- The user must take three deliberate steps before bash is reachable: enable env, install sandbox, populate allowlist. Accidental exposure path is closed.
- Sandbox + allowlist defense in depth — even if the allowlist somehow lets `git` through with a malicious arg, the sandbox bounds the blast radius to the workspace.
- Workspace-confined cwd extends the existing ADR-0008 invariant cleanly.
- Per-invocation audit gives an after-the-fact triage trail without leaking command output.
- Timeouts protect against runaway commands consuming the iteration budget.

### Negative

- Three env vars (`MOTE_BASH_ENABLED`, `MOTE_BASH_SANDBOX`, `MOTE_BASH_MODE`) plus an allowlist file is more setup than "just dispatch". Acceptable given the threat model.
- macOS / Linux only by default — Windows users have no `srt` or `nono` equivalent in this policy. They can use WSL2 (where nono works per its docs) or wait for a Windows-native sandbox option.
- Sandbox installation friction — `srt` requires `npm install -g @anthropic-ai/sandbox-runtime`; `nono` requires `brew install nono`. Documented in CLAUDE.md when bash lands.

### LOC impact (estimate, when implemented)

- `src/core/tools/bash.ts` — ~150 LOC (handler + sandbox detection + timeout + output cap)
- `src/core/bash-audit.ts` — ~30 LOC (append-only logger)
- `src/core/bash-allowlist.ts` — ~40 LOC (parse + validate)
- Tests — ~250 LOC (allowlist, sandbox-detection, timeout, output cap, audit, MCP/A2A exclusion)

Total ~470 LOC. Big enough to warrant its own milestone or wave when scheduled.

## Rejected alternatives

- **Bash with no sandbox** — relies entirely on the LLM behaving. The threat model assumes a jailbroken / adversarial system prompt; this fails immediately.
- **Docker-based sandbox** — explicitly out of scope per CLAUDE.md. Heavyweight for personal use; adds container management UX.
- **Sandbox via Bun's `Bun.spawn` only** — Bun has no built-in sandbox primitives. `Bun.spawn` is just `posix_spawn`.
- **Per-call user confirmation prompt** — earlier implementation-guide hint. Rejected here because the agent loop is unattended in many use cases (e2e tests, MCP server, A2A). Audit log + allowlist is the right replacement.
- **Allowlist via env var** — env vars are length-bounded and awkward to edit; a workspace file is cleaner.

## Verification (when implemented)

A future bash tool implementation must pass:

- `MOTE_BASH_ENABLED` unset → `bash` not in `registry.schemas()`
- `MOTE_BASH_ENABLED=1` and no sandbox on PATH → registry refuses to register `bash`, server logs reason
- Allowlist mode + command not on allowlist → tool returns `[error] command "X" not in bash-allowlist.txt`
- Schema rejection of `;`, `&&`, backticks, `$()` in allowlist mode (regex-based)
- Timeout test: `sleep 60` with `MOTE_BASH_TIMEOUT_MS=2000` → terminates by 2s + grace, returns `[error] timeout after Nms`
- Output cap test: `yes | head -c 200000` → truncated to 64 KB with marker
- Audit test: every dispatch appends one line to `bash-audit.log` with mode `0o600`
- MCP server `list_skills` does NOT include `bash`
- A2A `message/send` cannot dispatch `bash` regardless of prompt (RestrictedRegistry per ADR-0011 D4)

## Related

- ADR-0008 (workspace confinement) — bash inherits cwd-locking + symlink rejection
- ADR-0011 D4 (RestrictedRegistry) — A2A and MCP cannot reach bash even after enable
- `reference_external_watchlist.md` (project memory) — songmu / srt / nono context
- Future ADR (when bash lands): implementation specifics, sandbox profile choice (`srt`'s `~/.srt-settings.json` pattern, or `nono`'s capability syntax)
- Future ADR (parallel): `write_file` security policy — applies D4 (workspace confinement) and D6 (audit) but skips D2/D3/D5 (no sandbox / allowlist / shell semantics)
- Future ADR (parallel): `network-fetch` security policy — different threat model (SSRF, exfil); host allowlist + timeout but no sandbox needed
