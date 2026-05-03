import type {
  ContentBlock,
  Message,
  RunResult,
  ToolCall,
} from "@/core/types";
import type { AgentContext } from "@/core/context";

// Resolve the model id at the loop's call site rather than via a top-level
// constant — the env var should be readable late so tests / wrapper code
// can override it without restarting the process. Default mirrors ADR-0005.
function resolveModel(): string {
  return process.env["LLM_MODEL"] ?? "claude-sonnet-4-6";
}

// Builds the user-role tool-result message that follows an assistant turn
// containing tool_use blocks. Anthropic puts tool results inside a user
// message (per ADR-0005 D2 / spec §4); the loop never mints a "tool" role.
function buildToolResultMessage(
  results: ReadonlyArray<{ readonly call: ToolCall; readonly output: string }>,
): Message {
  const blocks: ContentBlock[] = results.map(({ call, output }) => ({
    type: "tool_result",
    toolUseId: call.id,
    content: output,
  }));
  return {
    role: "user",
    content: blocks,
    createdAt: Date.now(),
  };
}

// Run the agent loop until the model stops requesting tools or a stop
// condition fires. Returns the full message list (including `initial`)
// and the number of completed iterations.
//
// Persistence guarantee: every new message is appended to ctx.state
// before the next provider call. SIGINT mid-iteration loses at most the
// in-flight network call — never a message that the model already
// produced. The CLI / agent loop owner is responsible for honoring
// ctx.signal in its own outer loop.
//
// Tool errors do NOT throw out of the loop. ToolRegistry.dispatch returns
// a string, including for unknown tools, invalid args, and handler
// exceptions. The loop forwards that string verbatim as the tool_result
// content so the model can reason over the failure on the next turn.
export async function runLoop(
  initial: Message[],
  ctx: AgentContext,
): Promise<RunResult> {
  const messages: Message[] = [...initial];
  let iter = 0;

  while (
    iter < ctx.opts.maxIterations &&
    ctx.opts.budget.remaining > 0 &&
    !ctx.signal.aborted
  ) {
    const res = await ctx.provider.complete({
      model: resolveModel(),
      messages,
      tools: ctx.registry.schemas(),
      system: ctx.systemPrompt(),
    });
    messages.push(res.assistant);
    ctx.opts.budget.deduct(res.usage);
    await ctx.state.appendMessages(ctx.sessionId, [res.assistant]);

    if (res.toolCalls.length === 0) break;

    const dispatched: { call: ToolCall; output: string }[] = [];
    for (const call of res.toolCalls) {
      if (ctx.signal.aborted) break;
      const output = await ctx.registry.dispatch(call, ctx);
      dispatched.push({ call, output });
    }

    if (dispatched.length > 0) {
      const toolResultMessage = buildToolResultMessage(dispatched);
      messages.push(toolResultMessage);
      await ctx.state.appendMessages(ctx.sessionId, [toolResultMessage]);
    }

    iter++;

    const nudge = ctx.memoryNudge?.shouldFire();
    if (nudge !== null && nudge !== undefined) {
      const nudgeMessage: Message = {
        role: "system",
        content: [{ type: "text", text: nudge }],
        createdAt: Date.now(),
      };
      messages.push(nudgeMessage);
      await ctx.state.appendMessages(ctx.sessionId, [nudgeMessage]);
    }
  }

  return { messages, iter };
}
