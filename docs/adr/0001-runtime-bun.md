# ADR-0001: Use Bun as the runtime

## Status

Accepted

## Context

mote needs single-binary distribution, fast startup, direct SQLite access, and the ability to run TypeScript without a build step. Candidates considered: Node 22 / Deno 2 / Python 3.12 / Bun ≥ 1.2.

Requirements:

- Run TypeScript with no transpile step (do not erode DX)
- Distribute as a single binary (so `scp` to a home server is enough)
- Avoid native SQLite build pain
- Cold start under 100 ms (the CLI is for daily use)
- Be deployable to Cloudflare Workers for the M4 A2A endpoint

## Decision

**Adopt Bun ≥ 1.2.**

- `bun build --compile --target=bun-darwin-arm64 src/entry/agent.ts -o mote` produces a single binary
- `bun:sqlite` removes the need for `better-sqlite3`'s native build
- TypeScript runs directly
- Measured cold start under 50 ms
- For Cloudflare Workers, only the Hono app slice is exported

## Consequences

### Positive

- Develop with no build step
- Native SQLite build failures cannot happen by construction
- Distribution is a single `mote` file

### Negative

- Bun-specific APIs (`Bun.file`, `Bun.Glob`, `bun:sqlite`) reduce portability
- Cloudflare Workers compatibility is limited (the SQLite slice cannot move there)
- A subset of Node ecosystem packages may not work

Rejected: Node 22 (native SQLite + ts-node startup cost), Deno 2 (Anthropic SDK compatibility verification cost), Python 3.12 (worse fit with Hono).
