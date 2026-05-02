# ADR-0005: Two LLM wire formats — Anthropic native + OpenAI-compatible

## Status

Accepted

## Context

The first draft of this ADR (originally "single OpenAI-compatible API") prescribed funneling every provider — including Anthropic — through an OpenAI-shaped wire format, with `@anthropic-ai/sdk` behind a thin adapter that normalizes to OpenAI shape.

Reviewing the draft revealed two structural problems:

1. The naming and the implementation sketch (`isAnthropic = baseURL.includes("anthropic")`) read as an OpenAI bias, even though Anthropic is the default.
2. Routing everything through OpenAI shape erases Anthropic-native features that mote actively benefits from:
   - `cache_control` for prompt caching. mote sends the same `SOUL.md` and `MEMORY.md` every turn, so the cache hit rate is structurally high. Caching is a 10× cost reduction on hits — not a nice-to-have.
   - `thinking` content blocks (extended thinking on Claude reasoning models)
   - Tool use semantics (parallel tool calls, the `input_schema` shape)
   - Citations and document content blocks (relevant once M2 memory features land)

The agent loop, tool registry, and state can be aggressively thin without losing user value. The provider boundary is the one place where being too thin actively costs money.

## Decision

**Adopt two wire formats: Anthropic native and OpenAI-compatible. Both implement the same `Provider` interface.**

- `src/providers/types.ts` — `Provider` interface plus `CompletionRequest` / `CompletionResponse` shapes. Provider-agnostic.
- `src/providers/anthropic.ts` — uses `@anthropic-ai/sdk` natively. Owns the prompt caching policy (`cache_control` automatically applied to system + `SOUL.md` + `MEMORY.md`) and the thinking-block path. Default. Lands in M0.
- `src/providers/openai-compat.ts` — covers OpenRouter, vLLM, z.ai, Together, Fireworks, Groq, etc. via the OpenAI chat-completions wire format. **Not added in M0** — only when an actual non-Anthropic use case appears (YAGNI).

Provider-specific behavior (cache_control, thinking, citations) lives **inside** `anthropic.ts` and never leaks into `CompletionRequest`. The agent loop stays provider-agnostic.

Provider selection uses four env vars:

- `LLM_PROVIDER` — `anthropic` | `openai-compat` (default `anthropic`)
- `LLM_BASE_URL` — defaults per provider
- `LLM_API_KEY`
- `LLM_MODEL`

## Consequences

### Positive

- Anthropic prompt caching is usable from day one — direct cost win
- `thinking` blocks and Anthropic-native tool semantics are preserved
- OpenRouter (added later) unlocks 200+ non-Anthropic models behind the same `Provider` interface
- The agent loop never branches on provider; only the provider implementations branch
- Mock provider for tests is trivial (single interface to fake)

### Negative

- The provider layer grows from the original ~50 LOC budget to ~125 LOC by M0 end (Anthropic native ~100 + types ~25). This is a doubling of the original budget but bought with concrete value
- Gemini-native features (grounding, native multi-modal) are not picked up directly; they go through OpenRouter's OpenAI shape, which loses some fidelity. If we ever want them natively, that becomes a new ADR
- Two wire formats = two real test paths once `openai-compat.ts` lands. M0 only has one

### LOC impact on M0

Original M0 budget: agent loop 150 / state 50 / Anthropic adapter 50 / CLI 50 = 300.
Revised M0 budget: agent loop 150 / state 50 / **Anthropic native 100** / **provider types 25** / CLI 50 + registry/workspace ~50 ≈ **425**.

Net overage: ~125 LOC. Accepted because the alternative (give up prompt caching) is structurally more expensive in dollars per session than 125 LOC is in maintenance.

## Rejected alternatives

- **Single OpenAI-compatible wire format (the previous draft)** — would have meant losing prompt caching and thinking blocks. Cheaper in LOC, more expensive in dollars and capability.
- **Vercel AI SDK as the provider abstraction** — heavy abstraction, conflicts with the "no third-party abstraction in the core" stance, and gives up control over provider-specific edges.
- **Per-provider native SDKs for everyone (Anthropic + OpenAI + Gemini + …)** — LOC explosion, hits the M2 600-LOC freeze threshold, premature for personal use.

## Related rejected items

"Multiple providers used simultaneously" remains in CLAUDE.md `## Out of scope`. Adding it requires a separate ADR.
