# ADR-0011: A2A endpoint hardening (TLS, token entropy, log redaction, skill recursion)

## Status

Accepted (2026-05-03; D4 expanded — `RestrictedRegistry` is now M4-in-scope rather than deferred)

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

### D4. RestrictedRegistry: A2A receives a filtered tool surface

A2A's `message/send` runs the user's prompt through `runLoop` with whatever `ToolRegistry` the AgentContext carries. If that registry has `read_file` and `memory_*` registered (it does, by default in `buildContext`), an A2A caller can ask the model to use them — even though those tools are deliberately excluded from the MCP public surface (ADR-0009 D2).

The `mcp: public` flag alone does not stop this — it gates *which skills* are visible, not *which tools the model may call inside a skill or response*.

**M4 fix**: A2A's AgentExecutor constructs a separate `RestrictedRegistry` (a `ToolRegistry` instance populated with a filtered subset) and passes it to `runLoop` via a per-call `AgentContext`. The full agent registry is never reachable from an A2A request.

The filter for M4:

- **Allowed in A2A**: only `ToolDefinition`s built from skills with `mcp: public` in their frontmatter
- **NOT allowed in A2A**: `read_file`, `search_sessions`, `memory_append`, `memory_edit`, all `mcp: private` (or absent) skills, and any future workspace-mutating built-in (`bash` / `write_file` etc.)

Internal MCP `invoke_skill` already runs the skill body as a sub-call with `tools: []` (M1's `createSkillToolDefinition` does this), so the MCP path was safe by construction. A2A `message/send` is the new attack vector this decision closes.

Implementation sketch (M4 Wave 1):

```ts
// src/channels/a2a.ts
const publicSkills = ctx.skills.filter(s => s.mcp === "public");
const a2aRegistry = new ToolRegistry();
for (const skill of publicSkills) {
  a2aRegistry.register(createSkillToolDefinition(skill, { model }));
}
// AgentContext for A2A wraps this restricted registry, NOT ctx.registry
```

The wrapper is tiny (~20 LOC) because `ToolRegistry` is a plain `Map<string, ToolDefinition>`; "restriction" is just constructing a fresh registry with a subset.

Future extensions (genuinely out of scope for M4):

- Per-skill `mcp.tools: ["search_arxiv"]` frontmatter that lets a skill body dispatch a chosen subset of built-in tools — needed when a public skill genuinely requires e.g. `search_sessions` to do its job
- OS-layer sandbox for `bash` / `write_file` when those tools land (per `reference_external_watchlist.md` — `srt` / `nono`)
- Per-token capability scoping (would split today's single bearer token into multiple, each with its own registry)

## Consequences

### Positive

- TLS posture is no longer an "operator's responsibility" buried in README — the server fail-closes if the deployment shape is unsafe.
- Token entropy validation kills the "I'll set a real token later" failure mode.
- Token redaction is regression-tested, matching the discipline ADR-0005 already established for the Anthropic API key.
- Skill recursion property is captured in writing so a future user / contributor doesn't assume `mcp: public` is a strong sandbox.

### Negative

- D1 adds two env vars (`MOTE_A2A_BIND`, `MOTE_A2A_TLS_CERT`, `MOTE_A2A_TLS_KEY`) — a small config-surface increase. Acceptable because they are opt-in for the non-default deployment.
- D2's denylist is shallow (6 obvious values). A motivated user can still set a weak token like `aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa` (32 a's) that passes length but is trivially guessable. The 32-char minimum is the floor, not a sufficient strength check. Stronger entropy estimation (zxcvbn-style) is deferred.
- D4 closes the skill-recursion attack surface mechanically (RestrictedRegistry filters tool visibility per A2A request). Users no longer need to reason about which tools their public skills "could" reach — they only have public skills.

## Out of scope

- Per-skill `mcp.tools: [...]` frontmatter for finer-grained tool ACLs (D4 future extension)
- zxcvbn-style entropy estimation for `MOTE_A2A_TOKEN` (D2)
- Multi-token support / token rotation without restart (deferred from ADR-0010)
- mTLS, OAuth (deferred from ADR-0010)
- Per-tool ACLs across MCP / A2A surfaces (different concern; revisit when authentication granularity matters)

## Verification

For M4 Wave 1 task completion:

- `MOTE_A2A_TOKEN` length < 32 → server exits with "MOTE_A2A_TOKEN must be at least 32 characters" before binding the port
- `MOTE_A2A_TOKEN=changeme` (exact denylist match, padded to ≥32) → server exits citing the denylist
- `MOTE_A2A_BIND=0.0.0.0` without `MOTE_A2A_TLS_CERT` / `MOTE_A2A_TLS_KEY` → server exits with TLS-required error
- `MOTE_A2A_BIND=0.0.0.0` with both TLS env set → server starts, `Bun.serve({ tls })` engages
- `MOTE_A2A_BIND` unset (or `127.0.0.1`) → server starts on localhost without TLS
- Regression test: `tests/channels/a2a.test.ts` proves a canary token value never appears in caught errors / response bodies / log captures
- A2A endpoint test: a `message/send` whose prompt asks the model to call `read_file` / `memory_append` / `search_sessions` results in the model receiving an empty (or skill-only) tool manifest — the tools are not even advertised, let alone callable
- A2A endpoint test: a `mcp: private` skill is not invokable via A2A regardless of how the prompt is shaped

## Related

- ADR-0005 (LLM provider strategy) — original API-key sanitization pattern this ADR mirrors
- ADR-0009 (MCP server security model) — `mcp: public` flag whose transitive consequence D4 documents
- ADR-0010 (A2A endpoint security model) — this ADR is its enforcement layer; D1-D4 here harden D2 / D6 there
- Future ADR (post-M4): `RestrictedRegistry` for skill-scoped tool ACLs
- Future ADR (post-M4, was previously planned as 0011): Telegram channel security — renumbered to **ADR-0012**
