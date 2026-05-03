import { timingSafeEqual, randomUUID } from "node:crypto";

import { Hono } from "hono";
import type { Context } from "hono";
import { a2aApp } from "hono-a2a";
import type { UserBuilder } from "hono-a2a";
import {
  DefaultRequestHandler,
  type AgentExecutor,
  type TaskStore,
  type ExecutionEventBus,
  type RequestContext,
} from "@a2a-js/sdk/server";
import type { AgentCard, Task } from "@a2a-js/sdk";

import type { AgentContext } from "@/core/context";
import { ToolRegistry } from "@/core/registry";
import { runLoop } from "@/core/loop";
import { createSkillToolDefinition } from "@/skills/handler";
import type { LoadedSkill } from "@/skills/types";

export interface CreateA2aAppOpts {
  readonly skills: ReadonlyArray<LoadedSkill>;
  readonly taskStore: TaskStore;
  readonly maxBodySize?: number;
  // Test seam: override the runtime token validator. Production reads MOTE_A2A_TOKEN.
  readonly token?: string;
}

const TOKEN_DENYLIST = new Set([
  "changeme",
  "mote123",
  "password",
  "secret",
  "token",
  "admin",
  "test",
  "example",
]);
const TOKEN_MIN_LENGTH = 32;

function validateToken(token: string | undefined): string {
  if (!token) {
    throw new Error("MOTE_A2A_TOKEN is required (must be set in environment)");
  }
  if (token.length < TOKEN_MIN_LENGTH) {
    throw new Error(
      `MOTE_A2A_TOKEN must be at least ${TOKEN_MIN_LENGTH} characters (got ${token.length})`,
    );
  }
  if (TOKEN_DENYLIST.has(token.toLowerCase())) {
    throw new Error(
      "MOTE_A2A_TOKEN matches an obvious-weak denylist value; pick a stronger token",
    );
  }
  return token;
}

// Constant-time string compare. Native crypto.timingSafeEqual requires
// equal-length buffers; we wrap with a length-equalize step that itself
// runs in constant time over the longer string.
function tokensEqual(a: string, b: string): boolean {
  // Even when lengths differ, both buffer constructions take O(max(|a|,|b|))
  // time, and timingSafeEqual returns false when lengths differ — without
  // leaking the actual length difference via an early return.
  const maxLen = Math.max(a.length, b.length);
  const ab = Buffer.alloc(maxLen);
  const bb = Buffer.alloc(maxLen);
  ab.write(a);
  bb.write(b);
  return timingSafeEqual(ab, bb) && a.length === b.length;
}

// Builds a fresh ToolRegistry containing ONLY ToolDefinitions for skills
// with `mcp: public`. The full agent registry (with read_file, memory_*,
// search_sessions) is NEVER reachable from an A2A request — this is the
// RestrictedRegistry per ADR-0011 D4.
function buildPublicRegistry(
  skills: ReadonlyArray<LoadedSkill>,
  model: string,
): ToolRegistry {
  const registry = new ToolRegistry();
  for (const skill of skills) {
    if (skill.mcp === "public") {
      registry.register(createSkillToolDefinition(skill, { model }));
    }
  }
  return registry;
}

function buildAgentCard(
  publicSkills: ReadonlyArray<LoadedSkill>,
): AgentCard {
  return {
    name: "mote",
    description: "Minimal personal AI agent",
    url: process.env["MOTE_A2A_URL"] ?? "http://localhost:8787",
    version: "0.1.0",
    capabilities: { streaming: true },
    defaultInputModes: ["text/plain"],
    defaultOutputModes: ["text/plain"],
    skills: publicSkills.map(s => ({
      id: s.name,
      name: s.name,
      description: s.description,
      tags: [],
    })),
    protocolVersion: "0.3.0",
  };
}

// requestLogger that sets a context flag so downstream loggers know to
// redact the Authorization header value (ADR-0011 D3).
function buildLogRedactor() {
  return async (c: Context, next: () => Promise<void>) => {
    c.set("redact-auth", true);
    await next();
  };
}

export function createA2aApp(ctx: AgentContext, opts: CreateA2aAppOpts): Hono {
  const token = validateToken(opts.token ?? process.env["MOTE_A2A_TOKEN"]);
  const maxBodySize = opts.maxBodySize ?? 100 * 1024;
  const model = process.env["LLM_MODEL"] ?? "claude-sonnet-4-6";

  const publicSkills = opts.skills.filter(s => s.mcp === "public");
  const restrictedRegistry = buildPublicRegistry(publicSkills, model);
  const agentCard = buildAgentCard(publicSkills);

  const userBuilder: UserBuilder = async (c) => {
    const headerValue = c.req.header("authorization") ?? "";
    const presented = headerValue.replace(/^Bearer\s+/i, "").trim();
    if (!tokensEqual(presented, token)) {
      // isAuthenticated: false signals the SDK that the caller is not authenticated.
      // The authentication enforcement middleware (below) returns 401 before
      // the JSON-RPC handler is reached, so this path is a belt-and-suspenders
      // fallback — the middleware already rejects unauthenticated requests.
      return { isAuthenticated: false, userName: "" };
    }
    return { isAuthenticated: true, userName: "operator" };
  };

  // Authentication enforcement middleware. The JSON-RPC endpoint (POST /)
  // requires a valid Bearer token. The agent card (GET /.well-known/…) is
  // public and intentionally skipped here.
  // hono-a2a's userBuilder alone is not sufficient for rejection — it only
  // passes user info to ServerCallContext; the transport layer does not
  // gate on isAuthenticated. We enforce it at the Hono middleware layer.
  const authMiddleware = async (c: Context, next: () => Promise<void>) => {
    // Only protect the JSON-RPC endpoint
    if (c.req.method === "POST" && c.req.path === "/") {
      const headerValue = c.req.header("authorization") ?? "";
      const presented = headerValue.replace(/^Bearer\s+/i, "").trim();
      if (!tokensEqual(presented, token)) {
        return c.json(
          {
            jsonrpc: "2.0",
            id: null,
            error: { code: -32600, message: "Unauthorized" },
          },
          401,
        );
      }
    }
    await next();
  };

  // The AgentExecutor: bridges incoming A2A messages to runLoop with a
  // per-call AgentContext that uses the RestrictedRegistry.
  const executor: AgentExecutor = {
    async execute(requestContext: RequestContext, eventBus: ExecutionEventBus) {
      const a2aMessage = requestContext.userMessage;
      // Extract text from A2A message parts
      const textParts: string[] = [];
      for (const part of a2aMessage.parts) {
        if ("text" in part && typeof part.text === "string") {
          textParts.push(part.text);
        }
      }
      const userText = textParts.join("\n") || "(no text content)";

      // Build a per-request AgentContext with the RestrictedRegistry.
      // The full ctx is in the closure but only the restricted registry
      // reaches runLoop — ADR-0011 D4.
      const perRequestSessionId = `a2a_${randomUUID()}`;
      const restrictedCtx: AgentContext = {
        ...ctx,
        registry: restrictedRegistry,
        sessionId: perRequestSessionId,
      };

      const userMessage = {
        role: "user" as const,
        content: [{ type: "text" as const, text: userText }],
        createdAt: Date.now(),
      };

      let assistantText = "(no response)";
      try {
        const result = await runLoop([userMessage], restrictedCtx);
        // Extract text from the last assistant message
        const texts: string[] = [];
        for (const msg of result.messages) {
          if (msg.role === "assistant") {
            for (const block of msg.content) {
              if (block.type === "text") texts.push(block.text);
            }
          }
        }
        assistantText = texts.join("") || "(no text response)";
      } catch (e) {
        // Errors must NEVER leak the bearer token. Surface only the message.
        if (process.env["MOTE_DEBUG"] === "1") {
          console.error("[a2a executor] error:", e);
        }
        assistantText = `[error] ${e instanceof Error ? e.message : "unknown error"}`;
      }

      // Emit a completed TaskStatusUpdateEvent
      const taskId = requestContext.taskId;
      const contextId = requestContext.contextId;
      const completedTask: Task = {
        id: taskId,
        contextId,
        kind: "task",
        status: {
          state: "completed",
          timestamp: new Date().toISOString(),
          message: {
            kind: "message",
            messageId: `msg_${randomUUID()}`,
            role: "agent",
            parts: [{ kind: "text", text: assistantText }],
            taskId,
            contextId,
          },
        },
      };
      eventBus.publish(completedTask);
      eventBus.finished();
    },

    async cancelTask(taskId: string, eventBus: ExecutionEventBus) {
      const canceledTask: Task = {
        id: taskId,
        contextId: "",
        kind: "task",
        status: {
          state: "canceled",
          timestamp: new Date().toISOString(),
        },
      };
      eventBus.publish(canceledTask);
      eventBus.finished();
    },
  };

  const requestHandler = new DefaultRequestHandler(agentCard, opts.taskStore, executor);

  // Build the inner a2aApp (routes: POST / and GET /.well-known/agent-card.json)
  const innerApp = a2aApp({
    requestHandler,
    userBuilder,
    maxBodySize,
  });

  // Wrap with an outer Hono app so middleware runs BEFORE the inner routes.
  // Hono applies middleware in registration order; routes registered before
  // a middleware call are not protected by it, so we must register all
  // middleware on the outer app first, then mount the inner app.
  const outer = new Hono();
  outer.use("*", buildLogRedactor());
  outer.use("*", authMiddleware);
  outer.route("/", innerApp);

  return outer;
}
