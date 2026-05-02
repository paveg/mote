import type { Message, RunOptions } from "@/core/types";
import type { Provider } from "@/providers/types";
import type { ToolRegistry } from "@/core/registry";

// SessionState's full surface lands in M0 task #4 (state.ts). Declared here
// so registry/handlers can typecheck against the contract right now;
// the implementing class will satisfy this interface.
export interface SessionState {
  appendMessages(sessionId: string, messages: Message[]): Promise<void>;
  loadLatestSession(): Promise<Message[]>;
}

// The context every tool handler and the agent loop receives.
// Pure data + service references; no behaviour of its own.
export interface AgentContext {
  readonly agentId: string;
  readonly sessionId: string;
  readonly workspaceDir: string;
  readonly registry: ToolRegistry;
  readonly provider: Provider;
  readonly state: SessionState;
  readonly opts: RunOptions;
  readonly signal: AbortSignal;
  readonly systemPrompt: () => string;
}

import { randomUUID } from "node:crypto";

import { ToolRegistry as ToolRegistryImpl } from "@/core/registry";
import { JsonlState } from "@/core/state";
import { ensureWorkspace } from "@/core/workspace";
import { createAnthropicProvider } from "@/providers/anthropic";
import { createOpenAICompatProvider } from "@/providers/openai-compat";
import type { IterationBudget, Usage } from "@/core/types";
import { readFileTool } from "@/core/tools/read_file";

export interface BuildContextOpts {
  agentId?: string;                // defaults to "default"
  registry?: ToolRegistry;         // defaults to a new registry with built-in tools
  provider?: Provider;             // defaults to createAnthropicProvider()
  signal?: AbortSignal;            // defaults to a new AbortController.signal
  systemPrompt?: () => string;     // defaults to a static "You are mote." prompt
  maxIterations?: number;          // defaults to 50
  initialBudget?: number;          // defaults to 1_000_000 (input+output tokens combined)
  home?: string;                   // injected for tests; defaults to os.homedir()
}

// Picks the LLM provider implementation based on LLM_PROVIDER env var.
// Defaults to "anthropic" so existing setups that only set LLM_API_KEY
// continue to work without change.
function defaultProvider(): Provider {
  const providerType = process.env["LLM_PROVIDER"] ?? "anthropic";
  if (providerType === "anthropic") return createAnthropicProvider();
  if (providerType === "openai-compat") return createOpenAICompatProvider();
  throw new Error(
    `Unknown LLM_PROVIDER: ${JSON.stringify(providerType)} (expected: anthropic | openai-compat)`,
  );
}

// Default IterationBudget implementation.
// remaining tracks tokens; deduct subtracts input+output. The class is
// intentionally simple — M0 just needs a runaway stop. Cost-accuracy work
// (per-model pricing, caching credits) is deferred.
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

// Wires together every piece of the agent for a single CLI session.
//
// - Resolves and creates the workspace at ~/.mote/agents/<agentId>/
// - Generates a new sessionId for this run (s_<uuid>)
// - Registers built-in tools into the registry (just read_file in M0)
// - Constructs JsonlState pointing at the workspace
// - Constructs the default Anthropic provider unless an override is passed
// - Returns a fully-populated AgentContext suitable for runLoop
export async function buildContext(
  opts: BuildContextOpts = {},
): Promise<AgentContext> {
  const agentId = opts.agentId ?? "default";
  const workspaceDir = await ensureWorkspace(agentId, opts.home);
  const sessionId = `s_${randomUUID()}`;

  const registry = opts.registry ?? (() => {
    const r = new ToolRegistryImpl();
    r.register(readFileTool);
    return r;
  })();

  const provider = opts.provider ?? defaultProvider();
  const state = new JsonlState(workspaceDir);
  const signal = opts.signal ?? new AbortController().signal;

  return {
    agentId,
    sessionId,
    workspaceDir,
    registry,
    provider,
    state,
    opts: {
      maxIterations: opts.maxIterations ?? 50,
      budget: new TokenBudget(opts.initialBudget ?? 1_000_000),
    },
    signal,
    systemPrompt: opts.systemPrompt ?? (() => "You are mote, a minimal personal AI agent."),
  };
}
