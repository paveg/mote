# ADR-0015: Sub-call cost containment

## Status

Accepted (2026-05-03) — pentest-driven hardening; F3 / D4-HIGH-3 source findings

## Context

`src/skills/handler.ts:56-58` carries an explicit comment:

```ts
// Budget deduction is intentionally NOT done here — the sub-call
// is invisible to the outer iteration budget in M1. M2 can revisit
// when usage tracking matures.
```

The pentest pass (2026-05-03) flagged this as F3 / D4-HIGH-3 — confirmed independently by two reviewer subagents.

The exploit chain:

1. Attacker influences a skill body (FS access, OR a future channel like a "skill marketplace") to produce a 4000-token detailed analysis on every invocation.
2. Attacker influences the parent conversation (Telegram / A2A / CLI) to dispatch that skill repeatedly. A single iteration that calls 5 skills triggers 5 sub-completions.
3. The parent's `runLoop` deducts only the parent's own usage from `ctx.opts.budget`. Skill sub-calls are free in budget terms.
4. `maxIterations` (default 50) caps the outer loop, but the per-iteration tool dispatch loop runs until the model stops requesting tools — many skill calls per iteration.
5. Operator's API bill explodes; abort signal (SIGINT) only checks at the top of the outer while loop, so the bill is already spent by the time the operator notices.

The "M1 keeps it simple, M2 revisits" justification has expired now that M5 (Telegram) exposes the agent to non-operator inputs through public skills (ADR-0012 D5 RestrictedRegistry).

## Decisions

### D1. Skill sub-calls deduct from the same iteration budget

`createSkillToolDefinition`'s handler calls `ctx.opts.budget.deduct(res.usage)` after every sub-completion, identical to how `runLoop` does it for the outer call:

```ts
// in src/skills/handler.ts handler:
const res = await ctx.provider.complete({...});
ctx.opts.budget.deduct(res.usage);
const texts: string[] = [...];
return texts.join("") || "(skill produced no text output)";
```

There is one budget per `AgentContext`. Skills, the future bash tool, write_file — every tool that issues an LLM call inherits the same accounting.

### D2. Budget exhaustion inside a sub-call returns an error string, never throws

When `budget.remaining` reaches 0 mid-call, the sub-handler must NOT throw — `runLoop` already handles thrown errors by formatting them as tool_result strings, but throwing through a sub-handler can corrupt downstream state (mid-iteration tool dispatch loop). Instead:

- Before issuing the sub-call: check `if (ctx.opts.budget.remaining <= 0) return "[error] budget exhausted; cannot dispatch skill";`
- After the sub-call: deduct, no further checks needed (next sub-call's pre-check catches any overflow)

This matches the existing `ToolHandler` contract: error strings, never throws.

### D3. Future tool surfaces inherit this contract

When `bash` (per ADR-0013), `write_file`, or `network-fetch` lands, each handler that dispatches an LLM call (none of these directly do today, but bash via subagent could) **must** call `budget.deduct` and pre-check `budget.remaining`. The contract is: any code path that triggers `provider.complete()` accounts for its usage.

This becomes a checklist item in any future "ADR for tool X" review.

### D4. AbortSignal propagation is out of scope here

The pentest also flagged that `provider.complete()` does not honor `ctx.signal.aborted` mid-call (M10 / D4-MEDIUM-2). That is the real fix for "operator hits Ctrl-C, agent keeps spending" — but it requires plumbing `AbortSignal` through `CompletionRequest` and into both Anthropic SDK and openai-compat fetch. Tracked separately in the next pentest follow-up; not addressed by this ADR.

This ADR strictly addresses the cost-counting hole.

## Consequences

### Positive

- F3 / cost-DoS via skill recursion closed with one budget.deduct call
- Future tool surfaces have a clear contract — no "we'll add accounting later" loophole survives
- Iteration budget remains the single accounting unit; operators tune one number to bound cost

### Negative

- Skills that previously could "run free" in budget terms now consume budget — long agent sessions with skill-heavy workflows may hit the budget faster than before. The operator can raise `initialBudget` to compensate.
- Per-call pre-check adds a tiny overhead per sub-completion; negligible vs the LLM call itself.

### LOC impact

- `src/skills/handler.ts` +5 LOC (deduct + pre-check)
- Tests ~30 LOC (deduct happens, pre-check returns error string when exhausted)

## Out of scope

- AbortSignal propagation to in-flight `provider.complete()` (D4 above)
- Per-skill quota (e.g., "skill X may run at most 5 times per session") — different concern, not budget
- Provider-side retry storms (Anthropic SDK retries, openai-compat fetch retries) — those are orthogonal and live in the provider implementation

## Verification

- Test: a skill sub-call that returns `usage: { input: 100, output: 50 }` deducts 150 from the budget
- Test: when `budget.remaining` is 0, the skill handler returns `[error] budget exhausted...` without invoking `provider.complete`
- Regression test: an outer `runLoop` that calls a skill inside an iteration sees the budget reduced AFTER the iteration, including the skill's usage
- Documentation: ADR-0013 (bash) + future ADR (write_file) explicitly call out "must deduct from budget per ADR-0015 D3"

## Related

- ADR-0011 D4 RestrictedRegistry (Telegram / A2A skill surface — these now consume budget per this ADR)
- ADR-0013 D5 (bash tool timeout / output cap — orthogonal limits, complement this ADR's token budget)
- pentest report 2026-05-03: F3 / D4-HIGH-3 are the source findings
- M10 / abort-signal propagation: deferred follow-up
