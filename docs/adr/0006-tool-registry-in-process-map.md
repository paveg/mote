# ADR-0006: Implement the tool registry as a single in-process map

## Status

Accepted

## Context

We need a way to expose tools (built-in / skill / MCP-client tools) to the agent loop. Candidates:

1. A plugin SDK (versioning + hot reload, à la OpenClaw `definePluginEntry`)
2. A file-watcher-based dynamic registry
3. A single in-process `Map`, populated once at startup

## Decision

**Use a single in-process map (`Map<string, ToolDefinition>`).**

- All skill / built-in / MCP-client tools are loaded at startup
- Duplicate registration throws
- No hot reload (process restart is enough)
- One process = one agent

```typescript
export class ToolRegistry {
  private map = new Map<string, ToolDefinition>();
  register(def: ToolDefinition): void {
    if (this.map.has(def.name)) throw new Error(`duplicate tool: ${def.name}`);
    this.map.set(def.name, def);
  }
}
```

## Consequences

### Positive

- The implementation fits in roughly 30 LOC
- Duplicates are caught at startup (no mysterious runtime behavior)
- Introspecting the tool list is `Array.from(map.values())` — directly reusable for the M3 `list_skills` MCP tool

### Negative

- Adding a skill requires a process restart
- Multi-agent concurrency (multiple `agentId`s in one workspace) is not supported (explicitly out of scope)

Rejected: plugin SDK (versioning and hot reload do not earn their cost in personal use), file watcher (implementation cost is not justified).
