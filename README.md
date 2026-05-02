# mote

Minimal personal AI agent. Built with Bun + TypeScript, targeting ~1,500 LOC.

> _mote_: a tiny particle. The name is a literal translation of the agent's "thinness".

## Design documents

The primary source for design decisions lives in the sibling research repo:

- [Research README](../research/docs/mote/README.md)
- [roadmap.md](../research/docs/mote/roadmap.md) — milestones M0–M5 and done criteria
- [implementation-guide.md](../research/docs/mote/implementation-guide.md) — layout, data model, module specs

In-repo references:

- [docs/adr/](./docs/adr/) — accepted design decisions
- [tasks/todo.md](./tasks/todo.md) — current milestone

## Quick start

> Note: M0 is in progress. `bun run agent` does not work yet.

```bash
bun install
bun run agent       # starts the interactive session once M0 lands
```

## Development

| Command | Purpose |
|---|---|
| `bun run agent` | Start the CLI interactive session (M0+) |
| `bun run typecheck` | Type-check the project |
| `bun test` | Run tests |

## Workspace

Runtime data lives in `~/.mote/agents/<id>/` and is never committed:

```
~/.mote/agents/default/
├── SOUL.md       # persona
├── MEMORY.md     # durable memory (the agent edits this)
├── sessions/     # M0/M1: jsonl
├── state.db      # M2+: SQLite + FTS5
└── skills/<name>/SKILL.md
```

## License

TBD (decided before public release).
