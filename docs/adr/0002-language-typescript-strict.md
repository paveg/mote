# ADR-0002: Use TypeScript (strict)

## Status

Accepted

## Context

Candidates: TypeScript / Python / Go / Rust.

Considerations:

- Alignment with the user's research direction (Hono / A2A / ODRL)
- Type safety in the agent loop and tool registry
- Maturity of the LLM SDK ecosystem
- Possibility of cross-compatibility with Hermes (Python)

## Decision

**Adopt TypeScript with `"strict": true` and `"noUncheckedIndexedAccess": true`.**

Key options:

- `strict: true`
- `noUncheckedIndexedAccess: true` (forces undefined handling on array / object access)
- `noImplicitOverride: true`
- `verbatimModuleSyntax: true` (makes type-only imports explicit)
- `noPropertyAccessFromIndexSignature: true` (safer access on externally-sourced data)

## Consequences

### Positive

- Aligns fully with the user's research direction (Hono / A2A / ODRL)
- The tool registry's `inputSchema` and handler signature can be linked at the type level
- Prevents bugs when handling externally-sourced YAML such as agentskills.io SKILL.md frontmatter

### Negative

- Type definitions need maintenance
- Hermes (Python) cannot be ported directly; only the design is reused

Rejected: Python (worse fit with Hono, misaligned with research direction), Go / Rust (worse DX and less mature AI SDK ecosystem).
