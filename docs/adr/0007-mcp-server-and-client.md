# ADR-0007: Support both MCP server and client (M3+)

## Status

Accepted

## Context

We want mote to be discoverable from other agents, and we may eventually want to import tools from external MCP servers. Candidates:

1. No MCP support
2. MCP client only (import external MCP tools)
3. MCP server only (expose mote)
4. Both server and client (one SDK covers both)

## Decision

**Adopt `@modelcontextprotocol/sdk` and support both server and client.**

- M3: ship the server export (mote becomes callable from other agents)
- M5+: ship the client (external MCP server tools flow into `ToolRegistry`)

Tools exposed by the M3 server:

- `list_sessions`
- `get_session(id)`
- `search_sessions(query)`
- `read_memory()`
- `list_skills()`
- `invoke_skill(name, args)`

`llms.txt` is auto-generated under `~/.mote/agents/<id>/` for external crawlers.

## Consequences

### Positive

- One SDK covers both directions (export and import)
- Claude Code can attach via `claude mcp add mote -- bun run mcp-serve`
- Becomes a reference implementation for the agent interop ecosystem (`docs/agent-interop-ecosystem/`)

### Negative

- MCP SDK upgrades become a maintenance cost
- Implementing both directions adds LOC from M3 onward (already budgeted as +200 in the roadmap)

Rejected: client only (gives up the discoverability win), no MCP (cuts mote off from the discovery surface).
