# ADR-0011: A2A endpoint hardening (TLS, token entropy, log redaction, skill recursion)

## Status

Proposed (2026-05-03; awaiting user accept before M4 Wave 1 implementation begins)

## Context

ADR-0010 locks the A2A endpoint security model: bearer-token auth, closed CORS, opt-in skill exposure via `mcp: public`. A self-review against the personal-agent threat model surfaced four gaps that 0010 names but does not enforce:

1. **Transport-layer encryption** is unspecified. Cloudflare Workers are HTTPS by default, but `bun run a2a-serve` can bind plain HTTP. Token sniffing on a compromised home LAN is in scope.
2. **Token strength** is unconstrained. `MOTE_A2A_TOKEN=mote123` would pass startup validation in 0010.
3. **Token redaction** is gestured at but not pinned. ADR-0005 (Anthropic provider) requires a regression test asserting the API key never appears in any thrown error; A2A tokens deserve the same.
4. **Skill recursion** transparently leaks: `mcp: public` skills can call any registered tool (`read_file`, `memory_*`) inside their body, so the per-skill flag does not actually contain the workspace if the skill body is permissive.

Rather than expand ADR-0010 with these mechanical hardenings, this ADR captures them as the explicit defense-in-depth layer. ADR-0010 remains the architectural decision; ADR-0011 is its enforcement contract.

## Decisions

### D1. TLS posture

#### Cloudflare Workers
Workers run only over HTTPS — no operator action required. ADR records the dependency.

#### Local Bun (`bun run a2a-serve`)

- **Default bind: `127.0.0.1` (localhost-only).** External callers cannot reach the port without an SSH tunnel or reverse proxy.
- Override via `MOTE_A2A_BIND` env var (e.g., `0.0.0.0`).
- When `MOTE_A2A_BIND` is not localhost AND `MOTE_A2A_TLS_CERT` / `MOTE_A2A_TLS_KEY` are not set, the server **refuses to start** with a clear error: TLS is required for non-localhost binds.
- The `MOTE_A2A_TLS_CERT` / `MOTE_A2A_TLS_KEY` env vars point to PEM file paths; if both are set, Bun's `Bun.serve({ tls: { cert, key } })` is used.
- README documents two patterns: (a) localhost + reverse proxy with terminating TLS, (b) direct TLS via the env vars.

### D2. Token strength validation

Startup-time validation on `MOTE_A2A_TOKEN`:

- Minimum 32 ASCII characters
- Reject if matches a small denylist of obvious weak values (`changeme`, `mote123`, `password`, `secret`, `token`, `admin`)
- Recommend (in error message and README) `crypto.randomBytes(32).toString("base64url")` as the canonical generator

If validation fails, the server refuses to start with a one-line error citing the constraint that was violated. No fallback, no warning-and-continue path.

### D3. Token redaction

The bearer token must never appear outside the auth check itself:

- The `Authorization` header is **stripped** by a Hono middleware before any subsequent middleware logs it. Implementation: a `requestLogger` middleware that redacts `authorization` (and any header matching `/^x-.*-token$/i`) before formatting the log line.
- Catch blocks in `src/channels/a2a.ts` extract only `error.message` for client-facing responses; never `error`, never `error.cause`, never `error.stack`. The original error is `console.error`'d server-side only when `MOTE_DEBUG=1`.
- A regression test in `tests/channels/a2a.test.ts` asserts the canary token string never appears in:
  - Any thrown error's `message`
  - Any HTTP response body
  - Any captured log line (via a stub `console.error` / `console.log`)

This mirrors the Anthropic provider's existing test harness from ADR-0005.

### D4. Skill recursion is acknowledged

ADR-0009 D3 introduced `mcp: public` so users opt into "expose this skill to other agents". ADR-0010 D6 reuses that flag for A2A. **However, neither ADR makes the transitive consequence explicit.**

When an A2A caller invokes a `mcp: public` skill via `message/send`, the skill body runs through `runLoop` with the full `ToolRegistry` available. If the skill body says "use `read_file` to fetch the project's source", `read_file` runs — even though `read_file` is **not** in the public surface.

The skill body is the trust boundary. Users marking a skill `mcp: public` are also accepting that:

- Every tool registered in the agent's `ToolRegistry` (built-in + other skills + future tools) is reachable by the caller, mediated by the skill body's prompt
- A skill author who copies/forks an existing public skill inherits this property
- Defensive skill authoring requires either (a) constraining the system prompt so the LLM avoids invoking sensitive tools, or (b) implementing a `RestrictedRegistry` wrapper for public-skill calls (deferred to a follow-up ADR)

For M4, mote ships **with this property documented**, not patched. CLAUDE.md and the agent card response will both note: "skills with `mcp: public` can transitively access this agent's filesystem and memory tools."

Future hardening (out of scope for M4):

- A `RestrictedRegistry` that wraps the per-call registry for `mcp: public` invocations, exposing only an explicit allowlist
- Per-skill `mcp.tools: ["search_arxiv"]` frontmatter that lists which tools that skill is allowed to dispatch
- Sandbox at the OS layer (Anthropic `srt` / `nono` per the watchlist memory entry) when `bash` / `write_file` tools land

## Consequences

### Positive

- TLS posture is no longer an "operator's responsibility" buried in README — the server fail-closes if the deployment shape is unsafe.
- Token entropy validation kills the "I'll set a real token later" failure mode.
- Token redaction is regression-tested, matching the discipline ADR-0005 already established for the Anthropic API key.
- Skill recursion property is captured in writing so a future user / contributor doesn't assume `mcp: public` is a strong sandbox.

### Negative

- D1 adds two env vars (`MOTE_A2A_BIND`, `MOTE_A2A_TLS_CERT`, `MOTE_A2A_TLS_KEY`) — a small config-surface increase. Acceptable because they are opt-in for the non-default deployment.
- D2's denylist is shallow (6 obvious values). A motivated user can still set a weak token like `aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa` (32 a's) that passes length but is trivially guessable. The 32-char minimum is the floor, not a sufficient strength check. Stronger entropy estimation (zxcvbn-style) is deferred.
- D4 acknowledges a real attack surface (`mcp: public` skill body → tool recursion) that the current implementation does not block. Users who have not internalized this property may expose more than they expected. Mitigation is documentation + future `RestrictedRegistry`.

## Out of scope

- `RestrictedRegistry` wrapper for skill-scoped tool allowlists (deferred to a follow-up ADR; design hinted in D4)
- zxcvbn-style entropy estimation for `MOTE_A2A_TOKEN` (D2)
- Multi-token support / token rotation without restart (deferred from ADR-0010)
- mTLS, OAuth (deferred from ADR-0010)
- Per-tool ACLs (different concern; revisit when authentication granularity matters)

## Verification

For M4 Wave 1 task completion:

- `MOTE_A2A_TOKEN` length < 32 → server exits with "MOTE_A2A_TOKEN must be at least 32 characters" before binding the port
- `MOTE_A2A_TOKEN=changeme` (exact denylist match, padded to ≥32) → server exits citing the denylist
- `MOTE_A2A_BIND=0.0.0.0` without `MOTE_A2A_TLS_CERT` / `MOTE_A2A_TLS_KEY` → server exits with TLS-required error
- `MOTE_A2A_BIND=0.0.0.0` with both TLS env set → server starts, `Bun.serve({ tls })` engages
- `MOTE_A2A_BIND` unset (or `127.0.0.1`) → server starts on localhost without TLS
- Regression test: `tests/channels/a2a.test.ts` proves a canary token value never appears in caught errors / response bodies / log captures
- `agent-card.json` and CLAUDE.md both contain a "skill recursion" note describing D4

## Related

- ADR-0005 (LLM provider strategy) — original API-key sanitization pattern this ADR mirrors
- ADR-0009 (MCP server security model) — `mcp: public` flag whose transitive consequence D4 documents
- ADR-0010 (A2A endpoint security model) — this ADR is its enforcement layer; D1-D4 here harden D2 / D6 there
- Future ADR (post-M4): `RestrictedRegistry` for skill-scoped tool ACLs
- Future ADR (post-M4, was previously planned as 0011): Telegram channel security — renumbered to **ADR-0012**
