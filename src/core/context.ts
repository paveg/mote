import type { Message, RunOptions } from "@/core/types";
import type { Provider } from "@/providers/types";
import type { ToolRegistry } from "@/core/registry";

// SessionState's full surface lands in M0 task #4 (state.ts). Declared here
// so registry/handlers can typecheck against the contract right now;
// the implementing class will satisfy this interface.
export interface SessionState {
  appendMessages(messages: Message[]): Promise<void>;
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
