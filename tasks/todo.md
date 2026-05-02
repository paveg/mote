# Current tasks

## Active milestone: M0 — walking skeleton

> Goal: a turn-based agent loop runs over the CLI and reaches a tool dispatch.
> New LOC budget: ~425 (loop 150 / state(jsonl) 50 / Anthropic native 100 / provider types 25 / CLI 50 / registry+workspace+core types ~50). Revised from the original 300 in ADR-0005 — see the ADR for the trade-off.

### M0 done criteria

- [ ] `bun run agent` starts an interactive session
- [ ] An LLM response comes back via the Anthropic API
- [ ] One built-in tool (`read_file`) is actually dispatched
- [ ] Session log is appended to `~/.mote/sessions/<id>.jsonl`
- [ ] `Ctrl+C` interrupts; restart resumes from the last state

### M0 verification scripts (judge done)

- [ ] `printf '%s\n' "ls /tmp/test/" | bun run agent` triggers a tool call
- [ ] Start → talk → `Ctrl+C` → restart loads the previous final state

### M0 implementation tasks (in dependency order)

#### 1. Shared data types — `src/core/types.ts` (per `docs/superpowers/specs/2026-05-02-types-design.md`)

Pure data shapes only. `ToolDefinition` and `AgentContext` are split out (see tasks 1b and 3).

- [ ] `Role = "user" | "assistant" | "system"` (no `"tool"` role; tool results live as `tool_result` blocks)
- [ ] `ContentBlock` discriminated union: `text` / `tool_use` / `tool_result` / `thinking`
- [ ] `Message` (role, content: ContentBlock[], createdAt)
- [ ] `ToolCall` (id, name, args)
- [ ] `Usage` (input, output)
- [ ] `IterationBudget` interface (readonly remaining + deduct)
- [ ] `RunOptions` (maxIterations, budget)
- [ ] `RunResult` (messages, iter)

#### 1b. Provider I/O types — `src/providers/types.ts`

- [ ] `ToolSchema` (name, description, input_schema as JSON Schema object)
- [ ] `CompletionRequest` (model, messages, tools, system) — provider-agnostic, no Anthropic-specific fields
- [ ] `CompletionResponse` (assistant: Message, toolCalls: ToolCall[], usage: Usage)
- [ ] `Provider` interface — single method `complete(req): Promise<CompletionResponse>`
- [ ] Imports from `@/core/types` only (type-only)

#### 2. Workspace resolution — `src/core/workspace.ts`

- [ ] Resolve `~/.mote/agents/<id>/`
- [ ] Create the directory if it does not exist
- [ ] Ensure the `sessions/` directory exists

#### 3. Tool registry — `src/core/registry.ts`

- [ ] `ToolHandler<TSchema>` — generic handler signature inferring args from a valibot schema
- [ ] `ToolDefinition<TSchema>` — `{ name, description, schema, handler }` with `schema` as a valibot schema
- [ ] `ToolRegistry` class backed by `Map<string, ToolDefinition>`
- [ ] Duplicate registration throws
- [ ] `schemas()` runs each `schema` through `@valibot/to-json-schema` once and returns `ToolSchema[]` for the LLM
- [ ] Unit tests (duplicate / unknown / happy path / schema → JSON Schema conversion)

#### 3b. Agent context — `src/core/context.ts`

- [ ] `AgentContext` interface aggregating registry, provider, state, opts, signal, sessionId, workspaceDir, systemPrompt
- [ ] `buildContext(opts)` factory wires everything together for the CLI entrypoint

#### 4. State persistence (jsonl) — `src/core/state.ts`

- [ ] `appendMessages(sessionId, messages[])` → `<workspace>/sessions/<id>.jsonl`
- [ ] `loadLatestSession()` returns the messages of the most recent session
- [ ] Flush is guaranteed on `Ctrl+C` (`process.on('SIGINT')`)
- [ ] Unit tests

#### 5. Anthropic provider — `src/providers/anthropic.ts` (per ADR-0005)

(`src/providers/types.ts` is split into task #1b above.)

- [ ] `src/providers/anthropic.ts` — native via `@anthropic-ai/sdk`
  - [ ] Map `Message[]` → `messages.create` request shape
  - [ ] Auto `cache_control` on system + `SOUL.md` + `MEMORY.md` (when those slots are present)
  - [ ] Map `tool_use` ↔ internal `ToolCall`; map `tool_result` for the next turn
  - [ ] Return usage so the iteration budget can deduct
- [ ] Mock provider for tests (drop-in replacement of the `Provider` interface)
- [ ] OpenAI-compat is **out of scope for M0** — added later when an actual non-Anthropic use case appears

#### 6. Built-in tool — `read_file` only

- [ ] Implement `read_file({ path: string })` as a `ToolDefinition`
- [ ] Errors return strings; never throw

#### 7. Agent loop — `src/core/loop.ts`

- [ ] Implement `runLoop(initial, ctx)` (mirrors implementation-guide §3 pseudocode)
- [ ] Stop on iteration budget
- [ ] Stop on `signal.aborted`
- [ ] Stringify tool errors
- [ ] Integration tests (mock provider, tool error path, abort)

#### 8. CLI entrypoint — `src/entry/agent.ts`

- [ ] Interactive loop on `node:readline/promises`
- [ ] `/exit` ends the session
- [ ] Call `loadLatestSession()` on startup to resume
- [ ] Graceful shutdown on `SIGINT`

#### 9. E2E verification

- [ ] Land the M0 done script from roadmap.md as `tests/e2e/m0.sh`
- [ ] Run it manually once

### Out of scope for M0

Skill mechanism / SQLite / memory nudge / multiple channels / MCP / A2A.

---

## Next milestone: M1 (notes for later)

Pick up after M0 lands.

- Workspace loader (read `~/.mote/agents/<id>/SOUL.md` / `MEMORY.md`)
- Skill scanner (`Bun.Glob` over `skills/*/SKILL.md`)
- Frontmatter parser (~30 hand-written lines)
- CLI slash commands (`/<skill-name>`)

---

## Completed milestones

None.
