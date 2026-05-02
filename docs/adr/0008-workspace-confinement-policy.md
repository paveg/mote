# ADR-0008: Workspace-confinement policy for filesystem tools

## Status

Accepted (2026-05-03)

## Context

mote will expose filesystem tools to the LLM starting with `read_file` in M0 task #6. Future M-tasks may add `write_file`, list-style tools, and a `bash` shell tool (mentioned in implementation-guide §4 and explicitly held back as "whitelist + per-call confirmation"). All of these surfaces share one threat: an adversarial or jailbroken system prompt can cause the model to invoke the tool with crafted arguments that escape the intended scope.

Concrete example: `read_file({ path: "../../../etc/passwd" })` succeeds on any naive implementation that passes the LLM-supplied path directly to `Bun.file(...)`. This is path traversal via prompt injection — a documented attack class against LLM-tool integrations.

The user has stated security is the first-priority concern in mote (2026-05-03). This ADR locks the policy before any filesystem tool ships, so each tool inherits a uniform contract instead of each handler reinventing the check.

## Decision

**Every filesystem tool confines its operations to `ctx.workspaceDir` (`~/.mote/agents/<id>/`). All paths supplied by the LLM are resolved relative to that root and validated before any filesystem access.**

### The contract (binding for every fs tool)

1. **Schema-level rejection (cheap, first line)**
   - The valibot schema for any path argument rejects absolute paths (`/...`, `C:\...`).
   - The schema rejects strings containing `..` segments.
   - This catches the common case before the handler runs and produces a clear error string to the LLM.

2. **Resolve-and-prefix-check (handler-level, second line)**
   - Inside the handler, resolve the path with `path.resolve(ctx.workspaceDir, userPath)`.
   - Resolve symlinks via `fs.realpath(...)` to get the actual on-disk target.
   - Assert `resolved.startsWith(ctx.workspaceDir + path.sep)`. If not, return an error string and abort.

3. **Symlink discipline**
   - Symlinks pointing outside the workspace are rejected at the `realpath` step (the prefix check fails).
   - Symlinks pointing inside the workspace are allowed.
   - Tools never `follow` symlinks during traversal in a way that bypasses the realpath check.

4. **No environment expansion**
   - `~` is not expanded by tool handlers. The user's home directory is not addressable from a tool argument.
   - Environment variable substitution (`$HOME`, `${USER}`) is not performed.

5. **No test-time relaxation**
   - The confinement check is unconditional. No `NODE_ENV === "test"` or `MOTE_UNSAFE_FS=1` escape hatch in production code paths. Tests that need cross-workspace access use a fixture-set `workspaceDir` pointing at the test temp directory.

### Tools to which this applies

| Tool | Status | Confinement enforced via |
|---|---|---|
| `read_file` | M0 task #6 | This ADR |
| `write_file` | not yet planned | Inherits this ADR when introduced |
| Any future list/glob tool | not yet planned | Inherits this ADR |
| `bash` shell tool | not in M0 | Separate ADR required (this ADR is necessary but not sufficient for shell execution) |

### Tools to which this does NOT apply

- `read_memory()` / MEMORY edit tools — these operate on a fixed file path (`<workspaceDir>/MEMORY.md`) constructed by the handler, never on an LLM-supplied path. No confinement check needed because there is no user-controlled component in the path.
- MCP / A2A inbound payloads — these are not filesystem tools. Their security model is covered separately (see proposed ADR-0009).

## Consequences

### Positive

- One uniform check, not one-per-handler. New filesystem tools get the policy by inheritance.
- Both the schema layer and the handler layer enforce the same invariant — defense in depth.
- The `~/.mote/agents/<id>/` workspace becomes the single security boundary for the agent's filesystem reach. Aligns with the existing data-placement policy (CLAUDE.md `## Data placement`).
- Easy to audit: a reviewer can scan for `path.resolve` + prefix-check pairs in every fs tool.

### Negative

- Tools cannot be used to "open the user's recent project" or browse `~/Downloads/` from a chat. If the user wants the agent to operate on files outside `~/.mote/agents/<id>/`, they must symlink them in or copy them — friction. Acceptable for an isolated personal-agent threat model.
- `realpath` is a syscall on every read; for high-frequency file access this could add latency. Not a concern for M0 (interactive turn-rate use).
- Slightly more handler code per tool. ~10 lines of confinement boilerplate; can be factored into a `confinePath(ctx, userPath)` helper (`src/core/security.ts` or similar) once a second filesystem tool exists.

## Rejected alternatives

- **Trust the schema only** — schema rejects `..` and absolute paths but cannot detect a symlink inside the workspace pointing outside. Insufficient.
- **Trust the handler only** — schema-level rejection is a cheap pre-check that gives clearer errors to the LLM ("absolute paths are not allowed" beats "EACCES"). Defense in depth wins.
- **Allow opt-in via env var** (`MOTE_UNSAFE_FS=1`) — creates a path for users to disable security under stress. The escape hatch becomes the most-used setting. Not adopted.
- **Sandbox via Docker / chroot** — the implementation-guide §12 explicitly rejects sandboxes for this stage of the project.

## How to verify

For each filesystem tool that ships, the following two tests must pass:

```ts
// 1. Path-traversal attempt is rejected before any filesystem read
test("read_file rejects ../../etc/passwd", async () => {
  const result = await registry.dispatch({
    name: "read_file",
    args: { path: "../../etc/passwd" },
  }, ctxWithWorkspace("/tmp/mote-test"));
  expect(result).toMatch(/error/i);
  // additionally: prove the handler never reached the read by spying on Bun.file
});

// 2. Workspace-internal symlink pointing outside is rejected
test("read_file rejects symlink that escapes workspace", async () => {
  await fs.symlink("/etc/passwd", `${workspaceDir}/escape`);
  const result = await registry.dispatch({
    name: "read_file",
    args: { path: "escape" },
  }, ctxWithWorkspace(workspaceDir));
  expect(result).toMatch(/error/i);
});
```

Both tests are required acceptance criteria for M0 task #6.
