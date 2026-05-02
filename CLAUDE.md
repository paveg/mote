# CLAUDE.md — mote project instructions

## Project overview

mote is a minimal personal AI agent. Primary design sources:

- `../research/docs/mote/roadmap.md` — milestones M0–M5
- `../research/docs/mote/implementation-guide.md` — module specs
- `docs/adr/` — accepted design decisions

## Hard constraints

### Design goals

- Target **~1,500 LOC** for a personal assistant that runs on a home server
- Each milestone adds **no more than 300 LOC** of new code
- Every milestone is **usable on its own** (incremental usable)

### Stop condition

If the project exceeds **600 LOC by the end of M2**, freeze and redesign — the design is not thin enough.

## Accepted technical decisions (ADRs)

| # | Decision | Detail |
|---|---|---|
| 1 | Runtime = Bun ≥ 1.2 | Includes `bun:sqlite`. Node / Deno / Python rejected |
| 2 | Language = TypeScript strict | `noUncheckedIndexedAccess: true` enabled |
| 3 | Skill convention = agentskills.io | SOUL.md / MEMORY.md / SKILL.md. No custom format |
| 4 | Storage = SQLite + FTS5 trigram | Introduced in M2. M0/M1 use jsonl |
| 5 | LLM provider = two wire formats | Anthropic native (default, with prompt caching). OpenAI-compatible added when needed |
| 6 | Channel order = CLI → A2A → messaging | M0/M1 are CLI-only |
| 7 | MCP = both server and client | Server export lands in M3 |

## Explicitly out of scope

- Plugin SDK / extension mechanism
- TUI (multi-line editor, autocomplete UI)
- Multiple providers used **simultaneously** (provider switching at startup is supported; mid-session swap is not)
- Vector search (FTS5 is enough)
- Voice wake / TTS
- Sandbox (Docker / SSH backend)
- Multi-agent concurrency
- **Adding configurability before the implementation needs it**

If you start wanting any of these, write an ADR first, then implement.

## Implementation policy

### Code style

- No TUI libraries (ink, blessed). `readline` is enough
- Hand-write the frontmatter parser (~30 lines). Do not pull in `gray-matter`
- Tool errors return a string instead of throwing (so the model can reason about them)
- The iteration budget covers both runaway protection and cost accounting

### Module boundaries

- `src/core/` — agent loop, tool registry, state, types (shared foundation)
- `src/providers/` — LLM abstraction. `types.ts` (shared `Provider` interface), `anthropic.ts` (native, M0+), `openai-compat.ts` (added when needed). Provider-specific fields (cache_control, thinking) **never leak into `CompletionRequest`**
- `src/skills/` — SKILL.md loader
- `src/memory/` — MEMORY.md editing and the nudge mechanism
- `src/channels/` — CLI / A2A / Telegram entrypoints
- `src/mcp/` — MCP server / client (M3+)
- `src/entry/` — `bun run` entrypoints

### Data placement

Runtime data lives in `~/.mote/agents/<id>/`. **Never commit this to the repo.** `.gitignore` already excludes `.mote/`.

## Test strategy

| Layer | Framework | Focus |
|---|---|---|
| Unit | `bun:test` | Tool registry, frontmatter parser, state CRUD |
| Integration | `bun:test` + mock provider | Iteration budget / interrupt / tool error paths |
| E2E | Shell script | The done scripts in roadmap.md |

LLM calls go through a swappable `complete()` so a mock provider can stand in.

## Git / PR policy

- Follow `~/.claude/rules/pr-size.md`: effective logic ≤ 300 LOC per PR
- Cut one PR per milestone (M0 → 1 PR, M1 → 1 PR, …)
- Split further within a milestone if the change can be decomposed
- Push and PR creation require explicit user confirmation

## Current milestone

See `tasks/todo.md`.

## Reference: connection to derivative research

- `../research/docs/a2a-protocol/` — M4's A2A endpoint dogfoods this research
- `../research/docs/agent-interop-ecosystem/` — reference implementation of the workspace + MCP export pattern
- `../research/docs/ai-agent-contract-layer/` — leaves room to layer ODRL permission metadata onto SKILL.md later
