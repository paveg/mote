import * as v from "valibot";

import type { ToolDefinition } from "@/core/registry";

const SearchArgs = v.object({
  query: v.pipe(v.string(), v.minLength(1, "query may not be empty")),
  limit: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(50))),
});

// Surfaces FTS5 hits as a Markdown bullet list — easier for the LLM to
// scan than a JSON dump. Each hit shows the role, a relative
// timestamp, and the FTS5 snippet with [match] highlighting.
export const searchSessionsTool: ToolDefinition<typeof SearchArgs> = {
  name: "search_sessions",
  description:
    "Full-text search across your past conversations using FTS5 trigram. Returns up to 20 (or `limit`) matching messages with snippets, sorted by BM25 relevance.",
  schema: SearchArgs,
  handler: async (args, ctx) => {
    const hits = await ctx.state.searchSessions(args.query, args.limit ?? 20);
    if (hits.length === 0) {
      return `No matches for "${args.query}".`;
    }
    const lines: string[] = [`Found ${hits.length} match(es) for "${args.query}":`];
    for (const h of hits) {
      const date = new Date(h.createdAt).toISOString();
      lines.push(`- [${h.role}] ${date} (session ${h.sessionId.slice(0, 12)}...): ${h.snippet}`);
    }
    return lines.join("\n");
  },
};
