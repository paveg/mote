import { writeFile, chmod } from "node:fs/promises";
import { join } from "node:path";
import * as v from "valibot";

import type { ToolDefinition } from "@/core/registry";
import { loadMemory } from "@/core/workspace";

const MEMORY_FILENAME = "MEMORY.md";

const AppendArgs = v.object({
  text: v.pipe(v.string(), v.minLength(1, "text may not be empty")),
});

const EditArgs = v.object({
  find: v.pipe(v.string(), v.minLength(1, "find may not be empty")),
  replace: v.string(),
});

// memory_append: appends `text` as a new paragraph to MEMORY.md.
// Creates the file if it doesn't exist. File mode is forced to 0o600
// after every write — the same defense-in-depth pattern SqliteState
// uses, since this file may contain user-private material the agent
// has decided to remember.
export const memoryAppendTool: ToolDefinition<typeof AppendArgs> = {
  name: "memory_append",
  description:
    "Append a paragraph to MEMORY.md (your durable memory file). Use this when the user shares something worth remembering long-term, or when you reach a decision worth recording. The text is appended on a new line, separated from existing content by a blank line.",
  schema: AppendArgs,
  handler: async (args, ctx) => {
    const path = join(ctx.workspaceDir, MEMORY_FILENAME);
    const existing = (await loadMemory(ctx.workspaceDir)) ?? "";
    const next = existing.length === 0 ? args.text : `${existing}\n\n${args.text}`;
    try {
      await writeFile(path, next + "\n", { mode: 0o600 });
      await chmod(path, 0o600);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return `[error] memory_append: ${msg}`;
    }
    return `Appended ${args.text.length} chars to MEMORY.md.`;
  },
};

// memory_edit: replaces the FIRST AND ONLY occurrence of `find` with
// `replace` in MEMORY.md. Multi-occurrence is rejected so the agent
// has to be precise — agents are notorious for fuzzy edits when given
// global replace.
//
// Errors (returned as strings, not thrown):
// - MEMORY.md does not exist
// - `find` does not appear in the file
// - `find` appears more than once (caller must disambiguate by passing
//   a longer `find` substring)
export const memoryEditTool: ToolDefinition<typeof EditArgs> = {
  name: "memory_edit",
  description:
    "Replace a literal substring in MEMORY.md. The `find` string must appear exactly once. To edit something that appears multiple times, pass a longer `find` that uniquely identifies the target.",
  schema: EditArgs,
  handler: async (args, ctx) => {
    const path = join(ctx.workspaceDir, MEMORY_FILENAME);
    const existing = await loadMemory(ctx.workspaceDir);
    if (existing === null) {
      return "[error] memory_edit: MEMORY.md does not exist yet — use memory_append first.";
    }
    const occurrences = countOccurrences(existing, args.find);
    if (occurrences === 0) {
      return `[error] memory_edit: \`find\` string not present in MEMORY.md.`;
    }
    if (occurrences > 1) {
      return `[error] memory_edit: \`find\` appears ${occurrences} times; pass a longer substring that uniquely identifies the target.`;
    }
    const next = existing.replace(args.find, args.replace);
    try {
      await writeFile(path, next + "\n", { mode: 0o600 });
      await chmod(path, 0o600);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return `[error] memory_edit: ${msg}`;
    }
    return `Replaced ${args.find.length}-char substring with a ${args.replace.length}-char replacement.`;
  },
};

function countOccurrences(haystack: string, needle: string): number {
  if (needle.length === 0) return 0;
  let count = 0;
  let idx = 0;
  while (true) {
    const found = haystack.indexOf(needle, idx);
    if (found === -1) return count;
    count += 1;
    idx = found + needle.length;
  }
}
