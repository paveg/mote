# ADR-0012: Telegram channel security model

## Status

Accepted (2026-05-03) — locks the M5 Telegram surface. D5 hardened to "always restricted" (no master opt-in to full registry).

## Context

M5 of the roadmap exposes mote over a messaging channel — the implementation-guide names Telegram as the default ("indie 向き、インフラ不要" via long-polling). Unlike A2A (machine-to-machine, single bearer token), Telegram is **human-to-machine** and brings two new auth axes:

1. **Bot identity**: the bot token (issued by BotFather) authenticates mote AS a Telegram bot. Token leak = full impersonation.
2. **Caller identity**: each inbound DM carries `from.id` (Telegram numeric user id). The bot must decide whether each `from.id` is allowed to talk to mote.

The implementation-guide names two patterns from openclaw / hermes:

- **DM pairing** — unknown sender gets a pairing code; operator approves via an `/approve` command
- **Inbound envelope normalization** — `{ channel, from, timestamp, body }` shape consistent with A2A, so the agent loop sees a uniform interface

Threat model the user has emphasized (memory: `feedback_security_priority.md`):

- A leaked or guessed pairing code lets a stranger DM mote and run skills
- Bot token leak via logs / errors / state.db lets anyone impersonate the bot
- A SQL injection through some other tool surface (theoretical) must NOT be able to add user ids to the allowlist
- Voice / photo / file content is out of scope (M5 ships text-only)

This ADR locks the surface contract before any code lands.

## Decisions

### D1. Transport: long-polling default, webhook deferred

`bun run gateway` starts a long-poll loop against `https://api.telegram.org/bot<token>/getUpdates`. No public URL needed; works behind home NAT.

Webhook transport (for Cloudflare Workers / public deployments) is **deferred** to a follow-up ADR — needs a separate auth model (Telegram's `secret_token` header) and TLS termination story.

### D2. Bot token: required, validated, redacted

Bot token sourced from `MOTE_TELEGRAM_TOKEN` env var. If unset, `gateway` exits with a clear error before issuing any HTTP request — fail-closed.

Validation at startup:
- Format must match `\d+:[A-Za-z0-9_-]{35}` (Telegram's documented bot-token shape — numeric bot-id, colon, 35 chars)
- Reject obvious-test values (`123456:test`)

Redaction (mirrors A2A token discipline from ADR-0011 D3):
- The token is **never** included in any thrown error message
- Catch blocks extract only `error.message`; `error.cause` / `error.stack` are dropped client-side, surfaced server-side only when `MOTE_DEBUG=1`
- Long-poll request URLs (which embed the token) are NOT logged; loggers see a sanitized `https://api.telegram.org/bot<redacted>/<method>` form
- A regression test asserts the canary token never appears in any caught error / log line

### D3. Allowlist storage: file, NOT state.db

The set of approved user ids lives in `<workspaceDir>/telegram-allowlist.json`:

```json
{
  "version": 1,
  "approved": [
    { "userId": 12345, "approvedAt": 1730000000000, "note": "operator" }
  ]
}
```

File mode `0o600` (matches MEMORY.md / state.db pattern).

**Why not `state.db`**: SQL injection through some future tool surface (e.g., `search_sessions` if someone bypasses valibot) must not be able to add a user id to the allowlist. A separate file with explicit operator-only writes is a different trust boundary. The agent runtime never writes this file — only the gateway's pairing-approval path does.

### D4. Pairing flow

Two roles:

- **Master**: a single user id pre-set via `MOTE_TELEGRAM_MASTER_ID` env var. Auto-approved on first DM. Can issue `/approve <code>` and `/revoke <userId>` commands.
- **Pending users**: anyone else who DMs the bot.

When a pending user DMs the bot:

1. Bot generates a 128-bit pairing code: `crypto.randomBytes(16).toString("hex")` (32 hex chars)
2. Bot replies to the pending user: "Pairing code: `<code>`. Ask the operator to approve."
3. Bot also DMs the master with: "User `<from.id>` is requesting access. Code: `<code>`. Reply `/approve <code>` to allow."
4. Pairing codes live in-memory with TTL (24h, `Map<code, { userId, expiresAt }>`); not persisted across restarts (intentional — restart invalidates pending codes, forcing re-pairing)
5. Master sends `/approve <code>` → bot adds the userId to `telegram-allowlist.json`, replies to both master and the user
6. Master sends `/revoke <userId>` → bot removes from allowlist, replies to master

Pairing codes are **single-use**. Code-mismatch attempts are rate-limited per-master (TBD — rate-limit details deferred to a follow-up if abuse appears).

### D5. Tool surface: RestrictedRegistry, always — no master opt-in

Inbound messages from any approved user — including the master — go through `runLoop` with a per-call `AgentContext` whose registry is the same RestrictedRegistry pattern as ADR-0011 D4: only `mcp: public` skill ToolDefinitions, no `read_file` / `memory_*` / `search_sessions` / `bash` / `write_file`.

There is **no** opt-in to the full registry. The master role is purely an approval / revoke authority (D4), not a privilege escalation path for tool surface.

Rationale:

- The most realistic threat against a personal agent on Telegram is **account hijack** (SIM swap, session-token theft). Authentication on the inbound side is just `from.id` matching — once compromised, master and attacker are indistinguishable to mote.
- An "opt-in to full registry for master only" config would extend exactly that compromised utility to the attacker.
- The master always has CLI / A2A access for full-registry work. Telegram is a convenience surface for skill-mediated interactions, not a remote shell.
- This matches the architectural pressure of agentskills.io: anything you want reachable from Telegram should be a (public) skill, not a built-in.

If a user genuinely needs e.g. `search_sessions` from Telegram, they expose that capability through a curated skill (`mcp: public`) whose body wraps it — that becomes the contract surface, not the raw tool.

### D6. Inbound envelope normalization

Every inbound Telegram update normalizes to a common shape, consistent with the A2A path:

```ts
interface InboundEnvelope {
  readonly channel: "telegram";
  readonly from: string;            // stringified Telegram user id
  readonly timestamp: number;       // Unix epoch ms
  readonly body: string;            // text content (M5: text only)
}
```

This shape is reused if a future SMS / Discord / Matrix channel lands — they normalize to the same envelope before reaching the agent loop. The Telegram-specific update structure (`update.message.chat.id`, `update.message.text`, etc.) is parsed and discarded inside the gateway.

### D7. Audit log

Every inbound message + every outbound dispatch decision (approved / rejected / pairing) appends one line to `<workspaceDir>/telegram-audit.log` (mode `0o600`). Fields:

```
2026-05-03T10:30:00Z  from=12345  result=approved  bytes=42
2026-05-03T10:30:01Z  from=12345  result=tool-dispatched  tool=summarize
2026-05-03T10:35:00Z  from=99999  result=pending-pairing  code=<sha256-prefix>
```

Pairing codes are hashed before logging (only first 8 hex chars of SHA-256) so a leaked audit log doesn't reveal active pairing codes.

Bot token NEVER appears in this log.

### D8. Out of scope for M5

- Voice messages, photos, files, stickers, polls — text only
- Group chats / channel posts — bot only responds to private DMs (`update.message.chat.type === "private"`); other chat types are silently ignored
- Multi-bot deployment / multiple `MOTE_TELEGRAM_TOKEN` instances
- Webhook transport (defer to follow-up ADR)
- Telegram-side message reactions (👍 / ❤️ etc.) as a UI affordance
- Rate limiting beyond pairing-code attempts
- Internationalization of bot replies (M5 ships English; user can override via env)

## Consequences

### Positive

- File-based allowlist (D3) is the right trust boundary — separates "who can talk to mote" from "what mote knows" (state.db)
- Pairing flow (D4) gives a self-service approval path without giving the bot itself the authority to add allowlist entries
- RestrictedRegistry default (D5) keeps the Telegram surface aligned with A2A — same threat model, same defense
- Hashed pairing codes in audit log (D7) defend against the "operator's terminal log gets shoulder-surfed" scenario

### Negative

- Master must be DM'd first to bootstrap (D4 requires `MOTE_TELEGRAM_MASTER_ID` to know who the master is). If master id is misconfigured, no one can use the bot. Documented in CLAUDE.md / README.
- Long-poll process is a long-running thing; crashes lose pending pairing codes (intentional; D4 acknowledges)
- Voice/photo deferral (D8) means a user trying to send a voice memo gets a "text only" reply — minor UX paper-cut

### LOC impact

| Module | Estimated LOC |
|---|---|
| `src/channels/telegram.ts` (gateway: long-poll loop, envelope normalization, command parser) | ~200 |
| `src/channels/telegram-allowlist.ts` (file I/O + validation) | ~50 |
| `src/channels/telegram-pairing.ts` (in-memory store + TTL) | ~40 |
| `src/channels/telegram-audit.ts` (append-only logger) | ~30 |
| `src/entry/gateway.ts` (entrypoint with env-var validation) | ~40 |
| Tests | ~250 |
| Total production | ~360 |

Within the per-PR budget when split into 2 waves.

## Rejected alternatives

- **Master opt-in to full registry (`MOTE_TELEGRAM_RESTRICT=off`)** — considered as a convenience for the operator to call `read_file` / `memory_*` from their phone. Rejected because account hijack threat (SIM swap / session-token theft) makes "master only" indistinguishable from "attacker who took over master's account". Master always has CLI / A2A for full-registry work; Telegram stays skill-only.
- **Allowlist in state.db** — different trust boundary, addressed in D3.
- **Public bot (no allowlist, anyone can DM)** — turns mote into an open service. Out of personal-agent scope.
- **OAuth via Telegram Login Widget** — requires a public web URL for the OAuth callback; doesn't fit the long-poll / home-server stance. Bearer-flavor allowlist is sufficient for personal use.
- **Webhook by default** — needs public URL + TLS termination; pushed to a follow-up ADR.
- **Pairing code in plaintext audit log** — rejected; hashed-prefix in D7.
- **Voice/photo support in M5** — would need media-fetching tool, transcription, image understanding; expand-scope out of personal-text-agent baseline.

## Verification

For M5 task completion:

- `MOTE_TELEGRAM_TOKEN` unset → `bun run gateway` exits with clear error before any HTTP request
- `MOTE_TELEGRAM_TOKEN` malformed (e.g., `not-a-token`) → exits with format error
- Bot token never appears in any thrown error / log line / audit log entry (regression canary test)
- `from.id` not in allowlist + not master → bot replies with pairing code; user is NOT in `runLoop`
- Pairing code expires after 24h; expired code → "code expired" reply
- `/approve <bad-code>` → "no pending pairing for that code"
- `/revoke <userId>` → user removed from allowlist; subsequent DM from that user gets pairing code again
- Approved (non-master) user's DM → `runLoop` receives RestrictedRegistry (no `read_file` / `memory_*`)
- Master's DM → `runLoop` receives the same RestrictedRegistry (no master opt-in path exists)
- A prompt asking the model to call `read_file` / `memory_*` / `search_sessions` from a master DM → those tools are not in the manifest; the model cannot dispatch them
- Group chat / channel post → silently ignored (no reply, no audit entry)
- Voice / photo / file message → bot replies "text only"; original file is not downloaded

## Related

- ADR-0008 (workspace confinement) — `telegram-allowlist.json` lives inside workspaceDir
- ADR-0010 / ADR-0011 (A2A endpoint) — RestrictedRegistry pattern this ADR reuses; bearer-token vs allowlist threat models compared
- ADR-0009 (MCP server) — `mcp: public` flag this ADR's RestrictedRegistry filters by
- ADR-0013 (bash tool) — bash is **not** in the RestrictedRegistry, so Telegram cannot reach it
- `feedback_security_priority.md` (project memory) — security-first directive
- `reference_external_watchlist.md` (project memory) — songmu / srt / nono context (relevant if Telegram users somehow trigger filesystem tools through skill recursion, though D5 prevents this by default)
- Future ADR (post-M5): webhook transport for Workers deployment
- Future ADR (post-M5): rate limiting on pairing attempts if abuse observed
