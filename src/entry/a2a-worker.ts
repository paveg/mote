import { InMemoryTaskStore } from "@a2a-js/sdk/server";
import { createA2aApp } from "@/channels/a2a";
import { ToolRegistry } from "@/core/registry";
import { createAnthropicProvider } from "@/providers/anthropic";
import { createOpenAICompatProvider } from "@/providers/openai-compat";
import type { AgentContext, SessionState, SessionMeta, GetSessionResult } from "@/core/context";
import type { Message, IterationBudget, Usage } from "@/core/types";
import type { SearchHit } from "@/core/state";

// Workers doesn't support bun:sqlite so SqliteState is unavailable.
// The A2A path persists tasks via TaskStore; session history (appendMessages /
// loadLatestSession) is intentionally no-op here.
class MemoryStateStub implements SessionState {
  async appendMessages(_sessionId: string, _messages: Message[]): Promise<void> {
    // no-op on Workers
  }
  async loadLatestSession(): Promise<Message[]> {
    return [];
  }
  async searchSessions(_q: string, _l?: number): Promise<SearchHit[]> {
    return [];
  }
  async listSessions(): Promise<SessionMeta[]> {
    return [];
  }
  async getSession(_id: string, _l: number): Promise<GetSessionResult> {
    return { messages: [], truncated: false };
  }
}

class TokenBudget implements IterationBudget {
  private _remaining: number;
  constructor(initial: number) {
    this._remaining = initial;
  }
  get remaining(): number {
    return this._remaining;
  }
  readonly deduct = (usage: Usage): void => {
    this._remaining -= usage.input + usage.output;
  };
}

interface Env {
  MOTE_A2A_TOKEN: string;
  LLM_API_KEY: string;
  LLM_PROVIDER?: string;
  LLM_MODEL?: string;
  LLM_BASE_URL?: string;
  MOTE_A2A_URL?: string;
  MOTE_A2A_MAX_BODY?: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // Build the provider using env bindings directly. Do NOT write to
    // process.env — Cloudflare Workers share the global namespace across
    // concurrent requests in the same isolate, creating a TOCTOU race (M2).
    const provider =
      (env.LLM_PROVIDER ?? "anthropic") === "openai-compat"
        ? createOpenAICompatProvider({
            apiKey: env.LLM_API_KEY,
            baseURL: env.LLM_BASE_URL,
          })
        : createAnthropicProvider({ apiKey: env.LLM_API_KEY });

    const ctx: AgentContext = {
      agentId: "default",
      sessionId: `worker-${crypto.randomUUID()}`,
      workspaceDir: "/tmp/mote-worker",
      registry: new ToolRegistry(),
      provider,
      state: new MemoryStateStub(),
      opts: {
        maxIterations: 10,
        budget: new TokenBudget(1_000_000),
      },
      signal: new AbortController().signal,
      systemPrompt: () =>
        "You are mote, a minimal personal AI agent (Workers deployment).",
    };

    const app = createA2aApp(ctx, {
      skills: [],
      taskStore: new InMemoryTaskStore(),
      token: env.MOTE_A2A_TOKEN,
      model: env.LLM_MODEL,
      agentCardUrl: env.MOTE_A2A_URL,
      maxBodySize: env.MOTE_A2A_MAX_BODY
        ? parseInt(env.MOTE_A2A_MAX_BODY, 10)
        : undefined,
    });

    return app.fetch(request);
  },
};
