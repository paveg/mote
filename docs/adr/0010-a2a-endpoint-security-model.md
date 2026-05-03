# ADR-0010: A2A endpoint security model

## Status

Proposed (2026-05-03; awaiting user accept before M4 implementation begins)

## Context

M4 of the roadmap exposes mote as an [A2A (Agent-to-Agent) protocol](https://a2a-protocol.org/) endpoint over HTTP — Hono on Cloudflare Workers per ADR-0001, plus a local `bun run a2a-serve` for home-server use. ADR-0007 accepted "MCP both server and client" for the local-IPC discovery surface; A2A is the **network-reachable** sibling.

Threat model differs sharply from MCP:

- **MCP** (ADR-0009): stdio transport, OS-level process trust. Caller is a child process the user spawned themselves.
- **A2A**: HTTP. Anyone who can reach the listening port can speak the protocol. **No OS-level trust available.**

This ADR locks the A2A surface contract before any code lands. The package `hono-a2a@0.1.0` (paveg, npm) provides the Hono adapter primitives; this ADR specifies how mote configures it.

## Decisions

### D1. Two deployment targets, one configuration source

mote ships two A2A deployment paths from a single `createA2aApp(ctx)` factory:

- **Local (Bun)**: `bun run a2a-serve --port 8787` — for home-server deployment behind the user's network. Persists task state in `<workspaceDir>/state.db` (reuses `SqliteState`).
- **Cloudflare Workers**: `wrangler deploy` — for public agent-to-agent reachability. Uses `InMemoryTaskStore` (Workers are ephemeral; D1 / Durable Objects deferred to a later ADR if needed).

Both paths share `createA2aApp(ctx)`; the difference is only the entry script (`src/entry/a2a-serve.ts` vs `src/entry/a2a-worker.ts`) and the `TaskStore` implementation passed in.

### D2. Authentication: shared-secret bearer token

mote is a personal agent. OAuth flows / mTLS / federated auth are over-engineering for a single-user home server. We require a shared-secret bearer token in the `Authorization` header:

```
Authorization: Bearer <secret>
```

Secret sourced from env var `MOTE_A2A_TOKEN`. If the env var is unset, **the server refuses to start** (fail-closed). The agent card endpoint (`/.well-known/agent-card.json`) is exempt — it must be reachable without auth for discovery.

`hono-a2a`'s `userBuilder` hook is wired to compare the header against `MOTE_A2A_TOKEN` using `crypto.timingSafeEqual`-equivalent (constant-time). On match: `User.isAuthenticated = true, userName: "operator"`. On mismatch: 401.

Multi-token support (per-caller secrets, rotation) is deferred to a follow-up ADR if real interop demand appears.

### D3. CORS: closed by default

`Access-Control-Allow-Origin` is **not set** unless the operator opts in via `MOTE_A2A_ALLOW_ORIGIN` env var. Value is a comma-separated allowlist; `*` is rejected at startup with a clear error (browsers calling A2A endpoints is rare and a `*` allowlist defeats the bearer-token check via XSS).

For server-to-server A2A calls, CORS is irrelevant. The default (closed) is correct.

### D4. Rate limiting: deferred

M4 ships without rate limiting. Per-IP limits make sense for public deployment (Workers), but mote's expected traffic is one-or-two friendly callers per session. Hono's `hono/rate-limiter` is a one-line add when needed. Tracking via a follow-up issue; not blocking initial release.

If abuse is observed in real deployment, a follow-up ADR adds rate limiting with values pinned to actual traffic patterns (rather than guessing limits up front).

### D5. Body size cap: 100KB default, overridable

Use `hono-a2a`'s built-in 100KB `maxBodySize` default. Override via `MOTE_A2A_MAX_BODY` env var (parsed as bytes; supports suffixes like `1mb` via a small parser). Larger requests get a 413 from `hono-a2a`'s body-limit middleware.

### D6. Agent card visibility

`GET /.well-known/agent-card.json` is **always public** (no auth) — required for agent discovery per the A2A spec. Content:

- `name: "mote"`
- `url`, `version`
- `capabilities: { streaming: true }`
- `skills`: only skills with `mcp: public` in their `SKILL.md` frontmatter (reuses ADR-0009 D3 opt-in flag — one flag controls both MCP `invoke_skill` and A2A skills exposure)
- `defaultInputModes: ["text"]`
- `defaultOutputModes: ["text"]`

Built-in tools (`read_file`, `search_sessions`, `memory_*`) are **not** advertised in the agent card. They are agent-internal and not part of the inter-agent protocol surface.

### D7. Task store: SqliteTaskStore on local, InMemoryTaskStore on Workers

`@a2a-js/sdk` requires a `TaskStore` implementation for `tasks/get`, `tasks/cancel`, `tasks/resubscribe`. Two paths:

- **Local Bun**: `SqliteTaskStore` reuses `SqliteState`'s db connection. New table `a2a_tasks (task_id PK, session_id, state, payload_json, created_at, updated_at)`. Tasks survive process restart.
- **Workers**: `InMemoryTaskStore` from `@a2a-js/sdk/server`. Tasks live for the worker's lifetime; tradeoff accepted because Workers are ephemeral and tasks rarely span minutes in practice. D1 / Durable Objects integration is a follow-up ADR if persistence becomes important.

The factory signature: `createA2aApp(ctx, { taskStore })`. Caller picks. Default in `a2a-serve.ts` is sqlite; default in `a2a-worker.ts` is memory.

## Consequences

### Positive

- Bearer-token auth is the correct grain for a personal agent — strong enough to keep random scanners out, simple enough to set up in env.
- Reusing the `mcp: public` flag means a user only opts into "expose this skill to other agents" once; both MCP `invoke_skill` and A2A see the same view. No second flag, no contradiction risk.
- Sqlite-backed tasks on local Bun give task-resume semantics (Claude Code can `tasks/resubscribe` after a transient disconnect). Memory-backed on Workers is honest: don't pretend to persist what we won't.
- Closed-by-default CORS is the safe stance for a token-protected endpoint.
- `hono-a2a` does the protocol heavy lifting; this ADR's mote-specific code stays in the ~150 LOC range.

### Negative

- Rotating the shared secret requires restarting the server. M4 ships without rotation support.
- No structured per-caller auditing — only one bearer token, only one operator identity. Multi-tenant deployment is out of scope.
- Workers task store loses tasks on cold-start. Long-running tasks (>5 min) are not robust on the Workers deployment.

## Out of scope

- OAuth 2.0 / OIDC integration (deferred; bearer token covers the common case)
- mTLS (deferred; needs cert management UX before justification)
- D1 / Durable Objects task store (deferred until persistence on Workers becomes load-bearing)
- Rate limiting (deferred; add if real abuse observed)
- Multi-tenant / multi-token auth (deferred)
- A2A v1.0 spec (`hono-a2a@0.1.0` targets pre-v1.0 SDK; mote follows when SDK + adapter catch up)

## Verification

For M4 task completion:

- `MOTE_A2A_TOKEN` unset → `bun run a2a-serve` exits with a clear error before binding the port
- `Authorization: Bearer <wrong>` → 401 with no protocol body leakage
- `Authorization: Bearer <correct>` → JSON-RPC succeeds end-to-end (`message/send` round-trips)
- `GET /.well-known/agent-card.json` → 200 without auth, lists only `mcp: public` skills
- A skill registered with `mcp: private` is **absent** from agent card
- `MOTE_A2A_ALLOW_ORIGIN=*` at startup → server exits with explicit "wildcard CORS rejected" error
- `tasks/resubscribe` after a server restart succeeds against `SqliteTaskStore` (local Bun) and fails gracefully against `InMemoryTaskStore` (Workers)

## Related

- ADR-0001 (Bun runtime, Workers as M4 deployment target)
- ADR-0007 (MCP server + client, A2A as the network sibling)
- ADR-0008 (workspace confinement; A2A endpoint inherits this for any tool access)
- ADR-0009 (MCP server security model; reuses `mcp: public` flag for skill exposure)
- `paveg/hono-a2a@0.1.0` — Hono adapter primitives this implementation builds on
- Future ADR-0011 (Telegram channel security, M5)
- Future ADR (post-M4): D1 / Durable Objects task store if Workers persistence matters
- Future ADR (post-M4): rate limiting if abuse observed
