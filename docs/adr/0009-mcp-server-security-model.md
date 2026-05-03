# ADR-0009: MCP server security model

## Status

Proposed (2026-05-03; awaiting user accept before M3 implementation begins)

## Context

M3 of the roadmap exposes mote as an MCP (Model Context Protocol) server so other agents — Claude Code in particular — can call into it. ADR-0007 already accepted "MCP both server and client". This ADR locks the **security and surface contract** of the server before any code lands.

Concrete worry: an MCP server that re-exports the full `ToolRegistry` (which already contains `read_file`, `memory_append`, `memory_edit`, all loaded skills, …) gives any caller of the MCP socket the same authority the agent itself has. That is fine for stdio (the caller is a child process the user spawned themselves) but unsafe for TCP. The security model has to be explicit per transport.

ADR-0008 (workspace-confinement) is the binding policy for filesystem tools. This ADR extends the same threat model to the MCP boundary.

## Decision

**Adopt stdio transport only. Define the public MCP surface as 6 tools, with `invoke_skill` gated by an opt-in flag in each SKILL.md. Defer TCP transport to a separate ADR.**

### D1. Transport: stdio only

`bun run mcp-serve` launches an MCP server reading from stdin / writing to stdout, per the MCP `stdio` transport spec. The caller (Claude Code, another mote, another MCP client) launches mote as a child process. Trust model: the OS process boundary plus the user's launch decision.

TCP / WebSocket transport is **deferred** to a separate ADR (-0012 candidate). It needs an explicit auth model (shared-secret token, mTLS, or similar) which stdio does not because the caller already had to be the same OS user.

### D2. Public surface: exactly six tools

| Tool | Purpose | Privilege |
|---|---|---|
| `list_sessions` | List session ids + created_at, latest first | Read-only |
| `get_session(id)` | Fetch all messages for a session | Read-only |
| `search_sessions(query)` | FTS5 search across all sessions | Read-only |
| `read_memory()` | Return MEMORY.md content | Read-only |
| `list_skills()` | List available skills with their `mcp` flag (see D3) | Read-only |
| `invoke_skill(name, args)` | Call a skill (subject to opt-in, see D3) | **Effectful** — runs an LLM call |

Tools NOT exposed in M3:
- `read_file` — file-system I/O is sensitive enough that we keep it agent-internal for now. A future MCP caller wanting to read mote's workspace files calls `get_session` / `read_memory` instead.
- `memory_append` / `memory_edit` — write access to MEMORY.md is reserved for the agent itself. External callers should not be able to mutate mote's durable memory.

These exclusions can be relaxed in a follow-up ADR if a real use case appears.

### D3. `invoke_skill` opt-in via SKILL.md frontmatter

Each `SKILL.md` carries an optional `mcp` frontmatter field:

```yaml
---
name: search-arxiv
description: Search arxiv for papers
mcp: public
---
```

Semantics:

- `mcp: public` → skill is callable via `invoke_skill` from any MCP caller
- `mcp: private` (or field absent — **default**) → skill is NOT callable; `invoke_skill("search-arxiv", ...)` returns an error

`list_skills` returns ALL skills regardless of the flag, but each entry includes the `mcp` value so callers know which can actually be invoked. This makes discovery cheap while keeping invocation gated.

Rationale: the agent is the primary caller of skills (registered as tools in the agent's own ToolRegistry). MCP exposure is a separate, narrower contract. Opt-in default avoids leaking skills the user wrote for their own use into other-agent territory.

### D4. `get_session` response shape

Returns the full message list as a JSON array, capped at the most recent **200 messages** of the session. If the session has more, the response includes a `truncated: true` flag and the oldest 200 only — i.e., the cap protects the caller from accidentally pulling a huge session. M3 ships with the cap; M3+ may add a `before` / `after` cursor.

### D5. `llms.txt` format

Generated to `<workspaceDir>/llms.txt` per [llmstxt.org](https://llmstxt.org/). Minimum content:

```
# mote — minimal personal AI agent

> Personal AI agent exposing skills and session memory via MCP.

## Skills
- skill-name-1: short description (mcp: public|private)
- skill-name-2: …

## Public MCP tools
- list_sessions: List session ids
- get_session(id): Fetch messages
- search_sessions(query): FTS5 search
- read_memory: Read MEMORY.md
- list_skills: List skills with mcp flag
- invoke_skill(name, args): Call a public skill
```

Regenerated at server startup (cheap — small file). Static; no LLM call to generate.

### D6. Error semantics

Internal mote tool errors return strings (per the established pattern, M0 ADR). MCP wraps these in the standard `tools/call` response with `isError: true` and the string as the error message. The protocol-level error envelope is used; mote does NOT throw out of the MCP server.

## Consequences

### Positive

- A future agent / Claude Code session can attach via `claude mcp add mote -- bun run mcp-serve` and immediately have access to read mote's session history, search past conversations, and inspect skills — useful interop without sacrificing security.
- The opt-in `mcp` flag means a user who writes a private skill (e.g., one that contains personal credentials in the body) doesn't accidentally expose it.
- Error semantics piggyback on the existing string-error pattern; no new error infrastructure.
- Read/write asymmetry (read tools public, write tools agent-internal) means an attacker who somehow reaches the MCP socket cannot mutate mote's state — only inspect it.

### Negative

- TCP transport is unavailable in M3. Users wanting remote mote-to-mote communication wait for a follow-up ADR.
- Existing skill files without `mcp: public` are silently invisible to MCP callers. Users have to opt in per skill — friction.
- The 200-message cap on `get_session` is arbitrary. Real long sessions might be truncated unhelpfully. Caller can use `search_sessions` to navigate; pagination is M3+ work.

### LOC impact

| Component | Estimated LOC |
|---|---|
| `src/mcp/server.ts` (server + tool definitions) | ~150 |
| `src/mcp/llms-txt.ts` (generator) | ~40 |
| `src/entry/mcp-serve.ts` (entrypoint) | ~30 |
| `src/skills/types.ts` extension (mcp field) | ~5 |
| `src/skills/loader.ts` extension (parse mcp field) | ~5 |
| Tests | ~250 |
| Total production | **~230 LOC** |

Within the per-PR budget (≤ 300 effective LOC).

## Rejected alternatives

- **Expose the full `ToolRegistry` directly via MCP**. Effectively gives any MCP caller the same authority as the agent. Acceptable for trusted local use, but the opt-in model is only marginally more code and far safer.
- **Default-public skills with `mcp: private` opt-out**. More aggressive interop, but the user noted security as first-priority on 2026-05-03; opt-in default fits that stance.
- **Stdio + TCP in one ADR**. TCP needs an auth model that stdio doesn't, mixing the two scopes obscures both. Two ADRs is cleaner.
- **No `llms.txt`**. roadmap explicitly calls for it. Cheap to generate; useful for crawlers / future discovery surfaces.

## Verification

For M3 task completion:

- `bun run mcp-serve` exits 0 on `Ctrl+C` after handling at least one stdio request
- A separate Claude Code session attached via `claude mcp add mote -- bun run mcp-serve` can call all 6 tools
- A skill with `mcp: public` is invokable via `invoke_skill`; without the flag, `invoke_skill` returns `[error] skill "name" is not exposed via MCP (set mcp: public in frontmatter)`
- `<workspaceDir>/llms.txt` is regenerated on server start with current skill / tool list
- `get_session` on a 250-message session returns 200 messages with `truncated: true`

## Related

- ADR-0007 — Both MCP server and client (this ADR refines the server scope)
- ADR-0008 — Workspace-confinement policy (this ADR's read-only public tools inherit it)
- Future ADR-0010 (M4): A2A endpoint security
- Future ADR (post-M3): TCP / WebSocket transport for MCP server
