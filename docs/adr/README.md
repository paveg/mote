# Architecture Decision Records

Accepted design decisions for mote. To add a new one:

1. Name the file `NNNN-short-description.md` (4-digit, zero-padded)
2. If a new ADR overturns an existing one, mark the old one `Status: Superseded by ADR-NNNN`
3. A decision that overturns the "Out of scope" list must update both CLAUDE.md and the table below

## Index

| # | Title | Status |
|---|---|---|
| 0001 | [Use Bun as the runtime](./0001-runtime-bun.md) | Accepted |
| 0002 | [Use TypeScript (strict)](./0002-language-typescript-strict.md) | Accepted |
| 0003 | [Adopt agentskills.io convention for skills and persona](./0003-skill-convention-agentskills-io.md) | Accepted |
| 0004 | [Use SQLite + FTS5 (trigram tokenizer) for storage](./0004-storage-sqlite-fts5-trigram.md) | Accepted |
| 0005 | [Two LLM wire formats — Anthropic native + OpenAI-compatible](./0005-llm-provider-strategy.md) | Accepted |
| 0006 | [Implement the tool registry as a single in-process map](./0006-tool-registry-in-process-map.md) | Accepted |
| 0007 | [Support both MCP server and client (M3+)](./0007-mcp-server-and-client.md) | Accepted |
| 0008 | [Workspace-confinement policy for filesystem tools](./0008-workspace-confinement-policy.md) | Accepted |
