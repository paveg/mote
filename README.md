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

```bash
bun install
```

`bun run agent` is the M0+ CLI. Network channels (A2A / MCP / Telegram) are wired in via separate entry points — see the table below.

## Development

| Command | Purpose |
|---|---|
| `bun run agent` | Start the CLI interactive session (M0+) |
| `bun run mcp-serve` | MCP server over stdio (M3+) — see [ADR-0009](./docs/adr/0009-mcp-server-security-model.md) |
| `bun run a2a-serve` | A2A endpoint (Bun, local) (M4+) — see [ADR-0010](./docs/adr/0010-a2a-endpoint-security-model.md) |
| `bun run a2a-deploy` | Deploy A2A endpoint to Cloudflare Workers (M4+) |
| `bun run gateway` | Telegram bot gateway, long-poll (M5+) — see [ADR-0012](./docs/adr/0012-telegram-channel-security-model.md) |
| `bun run typecheck` | Type-check the project |
| `bun test` | Run unit tests |
| `bash tests/e2e/m0.sh` | Run the e2e smoke (auto-skips paths without the relevant API key / token) |

## Workspace

Runtime data lives in `~/.mote/agents/<id>/` and is never committed:

```
~/.mote/agents/default/
├── SOUL.md                       # persona
├── MEMORY.md                     # durable memory (the agent edits this)
├── sessions/                     # M0/M1: jsonl
├── state.db                      # M2+: SQLite + FTS5
├── skills/<name>/SKILL.md
├── llms.txt                      # M3+: MCP discovery surface
├── telegram-allowlist.json       # M5+: 0o600, separate from state.db (ADR-0012 D3)
└── telegram-audit.log            # M5+: 0o600, token-redacted (ADR-0012 D7)
```

## Telegram setup (M5)

The `bun run gateway` entry connects mote to a Telegram bot via long-polling.

1. Talk to [@BotFather](https://t.me/BotFather) and create a new bot. Save the token.
2. DM your own bot once from the master account, then visit `https://api.telegram.org/bot<TOKEN>/getUpdates` in a browser to read your numeric Telegram user id from the JSON response.
3. Run the gateway:

   ```bash
   MOTE_TELEGRAM_TOKEN="<bot token from BotFather>" \
   MOTE_TELEGRAM_MASTER_ID="<your numeric Telegram user id>" \
   bun run gateway
   ```

Per [ADR-0012](./docs/adr/0012-telegram-channel-security-model.md):

- Master can `/approve <code>` and `/revoke <userId>`. Pending users get a 128-bit single-use pairing code (24h TTL).
- The Telegram surface is **always** restricted to skills with `mcp: public` frontmatter — no `read_file` / `memory_*` from Telegram, even for the master. Use the CLI / A2A for full-registry work.
- Only text DMs are processed. Voice / photo / file get a "text only" reply. Group chats are silently ignored.

## License

TBD (decided before public release).
