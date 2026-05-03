import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import * as v from "valibot";
import { toJsonSchema } from "@valibot/to-json-schema";

import type { AgentContext } from "@/core/context";
import type { LoadedSkill } from "@/skills/types";

// Resolves the per-call get_session cap from env, falling back to 200
// per ADR-0009 D4. Re-read on every call so an operator can tweak the
// env at runtime (e.g., for an interactive debug session).
function getSessionLimit(): number {
  const raw = process.env["MOTE_MCP_GET_SESSION_LIMIT"];
  const parsed = raw === undefined ? NaN : parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 200;
}

// One MCP-exposed tool. Schema is valibot (consistent with the agent
// tool registry); the SDK consumes its JSON-Schema form via
// @valibot/to-json-schema. The handler receives the valibot-parsed
// output and must be typed as `any` at the public interface level
// because `v.InferOutput<v.GenericSchema>` resolves to `unknown`.
export interface McpTool<TSchema extends v.GenericSchema = v.GenericSchema> {
  readonly name: string;
  readonly description: string;
  readonly schema: TSchema;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly handler: (args: any) => Promise<string>;
}

// Builds the public tool list for the MCP server. `skills` is captured
// at build time so list_skills / invoke_skill see a consistent view
// for the lifetime of one connection. The server can be rebuilt on
// reconnect to pick up newly-added skills.
function buildTools(
  ctx: AgentContext,
  skills: ReadonlyArray<LoadedSkill>,
): ReadonlyArray<McpTool> {
  const tools: McpTool[] = [];

  // list_sessions — no args
  tools.push({
    name: "list_sessions",
    description: "List session ids ordered by created_at (latest first).",
    schema: v.object({}),
    handler: async () => {
      const meta = await ctx.state.listSessions();
      if (meta.length === 0) return "(no sessions)";
      const lines = meta.map(
        m => `- ${m.id}  ${new Date(m.createdAt).toISOString()}`,
      );
      return lines.join("\n");
    },
  });

  // get_session
  tools.push({
    name: "get_session",
    description:
      "Fetch the most recent messages for a session as JSON. Capped at MOTE_MCP_GET_SESSION_LIMIT (default 200).",
    schema: v.object({
      session_id: v.pipe(v.string(), v.minLength(1)),
    }),
    handler: async (args) => {
      const limit = getSessionLimit();
      const result = await ctx.state.getSession(args.session_id, limit);
      return JSON.stringify(
        { truncated: result.truncated, messages: result.messages },
        null,
        2,
      );
    },
  });

  // search_sessions — wraps existing state method
  tools.push({
    name: "search_sessions",
    description: "FTS5 search across all sessions.",
    schema: v.object({
      query: v.pipe(v.string(), v.minLength(1)),
      limit: v.optional(
        v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(50)),
      ),
    }),
    handler: async (args) => {
      const hits = await ctx.state.searchSessions(args.query, args.limit ?? 20);
      if (hits.length === 0) return `No matches for "${args.query}".`;
      return hits
        .map(
          h =>
            `- [${h.role}] ${new Date(h.createdAt).toISOString()} (session ${h.sessionId.slice(0, 12)}...): ${h.snippet}`,
        )
        .join("\n");
    },
  });

  // read_memory
  tools.push({
    name: "read_memory",
    description: "Read MEMORY.md (durable agent memory). Returns the file contents or an empty string if it does not exist.",
    schema: v.object({}),
    handler: async () => {
      const { loadMemory } = await import("@/core/workspace");
      const memory = await loadMemory(ctx.workspaceDir);
      return memory ?? "";
    },
  });

  // list_skills
  tools.push({
    name: "list_skills",
    description: "List installed skills with their MCP visibility flag.",
    schema: v.object({}),
    handler: async () => {
      if (skills.length === 0) return "(no skills installed)";
      return skills
        .map(s => `- ${s.name} [mcp:${s.mcp}]: ${s.description}`)
        .join("\n");
    },
  });

  // invoke_skill — opt-in via mcp: public per ADR-0009 D3
  tools.push({
    name: "invoke_skill",
    description: "Invoke a skill by name. Only skills with `mcp: public` in their SKILL.md frontmatter are callable.",
    schema: v.object({
      name: v.pipe(v.string(), v.minLength(1)),
      args: v.optional(v.record(v.string(), v.unknown())),
    }),
    handler: async (args) => {
      const skill = skills.find(s => s.name === args.name);
      if (!skill) {
        return `[error] unknown skill: "${args.name}"`;
      }
      if (skill.mcp !== "public") {
        return `[error] skill "${args.name}" is not exposed via MCP (set mcp: public in its SKILL.md frontmatter)`;
      }
      const result = await ctx.registry.dispatch(
        { id: `mcp-${args.name}-${Date.now()}`, name: args.name, args: args.args ?? {} },
        ctx,
      );
      return result;
    },
  });

  return tools;
}

// Constructs an MCP Server with the public tool surface from
// ADR-0009 D2. Caller is responsible for connecting it to a transport
// (StdioServerTransport in production; nothing in tests — tools are
// exercised directly).
export function createMoteMcpServer(
  ctx: AgentContext,
  skills: ReadonlyArray<LoadedSkill>,
): { server: Server; tools: ReadonlyArray<McpTool> } {
  const tools = buildTools(ctx, skills);
  const server = new Server(
    { name: "mote", version: "0.1.0" },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: tools.map(t => ({
        name: t.name,
        description: t.description,
        inputSchema: toJsonSchema(t.schema, { errorMode: "ignore" }) as object,
      })),
    };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: rawArgs } = request.params;
    const tool = tools.find(t => t.name === name);
    if (!tool) {
      return {
        isError: true,
        content: [{ type: "text", text: `[error] unknown tool: ${name}` }],
      };
    }
    const parsed = v.safeParse(tool.schema, rawArgs ?? {});
    if (!parsed.success) {
      const issues = parsed.issues.map(i => i.message).join("; ");
      return {
        isError: true,
        content: [
          { type: "text", text: `[error] invalid args for ${name}: ${issues}` },
        ],
      };
    }
    try {
      const text = await tool.handler(parsed.output);
      return { content: [{ type: "text", text }] };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return {
        isError: true,
        content: [{ type: "text", text: `[error] ${msg}` }],
      };
    }
  });

  return { server, tools };
}
