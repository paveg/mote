import { realpath } from "node:fs/promises";
import { resolve, sep } from "node:path";
import * as v from "valibot";

import type { ToolDefinition } from "@/core/registry";

// Per ADR-0008: workspace-confinement policy.
// Two-layer defense — schema rejects easy cases, handler enforces
// the canonical realpath + prefix-check.
const ReadFileArgs = v.object({
  path: v.pipe(
    v.string(),
    v.minLength(1, "path may not be empty"),
    v.check(
      (s) => !s.split(/[\\/]/).includes(".."),
      "path may not contain `..` segments",
    ),
    v.check(
      (s) => !s.startsWith("/") && !/^[A-Za-z]:[\\/]/.test(s),
      "path must be relative to the workspace (no absolute paths)",
    ),
  ),
});

// `read_file` reads a UTF-8 text file from inside the agent's workspace.
// Paths are resolved relative to ctx.workspaceDir and any escape is rejected
// via realpath + prefix-check. Symlinks pointing outside the workspace are
// silently rejected by the prefix check after realpath resolution.
export const readFileTool: ToolDefinition<typeof ReadFileArgs> = {
  name: "read_file",
  description:
    "Read a UTF-8 text file from the agent's workspace. The path must be relative to the workspace root and may not contain `..` segments.",
  schema: ReadFileArgs,
  handler: async (args, ctx) => {
    const candidate = resolve(ctx.workspaceDir, args.path);
    let real: string;
    try {
      real = await realpath(candidate);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return `[error] read_file: cannot resolve path: ${msg}`;
    }

    // Normalize the workspace root for prefix comparison.
    // Also canonicalize workspaceDir so that macOS /var → /private/var
    // symlinks (and similar host-OS redirects) do not cause false escapes.
    let rootRaw: string;
    try {
      rootRaw = await realpath(ctx.workspaceDir);
    } catch {
      rootRaw = ctx.workspaceDir;
    }
    const root = rootRaw.endsWith(sep) ? rootRaw.slice(0, -1) : rootRaw;
    if (real !== root && !real.startsWith(root + sep)) {
      return "[error] read_file: path escapes workspace";
    }

    try {
      return await Bun.file(real).text();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return `[error] read_file: ${msg}`;
    }
  },
};
