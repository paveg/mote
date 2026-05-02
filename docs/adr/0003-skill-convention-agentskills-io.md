# ADR-0003: Adopt agentskills.io convention for skills and persona

## Status

Accepted

## Context

Candidates for representing skills, persona, and memory:

1. agentskills.io standard (SOUL.md / MEMORY.md / `skills/<name>/SKILL.md`)
2. A custom convention
3. OpenClaw extension convention (with plugin SDK versioning)

mote wants to interoperate at the data level with Hermes / OpenClaw / Claude Code.

## Decision

**Adopt the agentskills.io convention.**

- `SOUL.md` — persona; always included in the system prompt
- `MEMORY.md` — durable memory; the agent edits it via `memory_append` / `memory_edit` tools
- `skills/<name>/SKILL.md` — Markdown with a YAML frontmatter

Frontmatter schema:

```yaml
---
name: search-arxiv
description: Search arxiv for papers. Pass the query in English.
---
The body holds the procedure. The agent reads the body to act.
```

## Consequences

### Positive

- Plugs into the Hermes / OpenClaw / Claude Code skill ecosystem for free
- Existing SKILL.md files can be imported and run on mote (compatibility verified in M1)
- Differentiation can stay focused on the A2A / ODRL layer

### Negative

- Going off-spec for custom extensions becomes a risk
- ODRL permission metadata has to be layered separately (links to the `docs/ai-agent-contract-layer/` research)

Rejected: custom convention (no justification for losing a free ecosystem), OpenClaw extension (plugin SDK versioning is overkill for personal use).
