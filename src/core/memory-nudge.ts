const NUDGE_TEXT = [
  "Iteration checkpoint: if anything you have learned in this session is worth",
  "remembering long-term — a user preference, a project fact, a decision —",
  "call memory_append now. If nothing fits, ignore this message and continue.",
].join(" ");

// MemoryNudge fires `shouldFire()` every `interval` completed iterations.
// `interval = 0` disables the mechanism entirely (used in tests where
// the periodic nudge would obscure the assertion).
export class MemoryNudge {
  private sinceLast = 0;
  constructor(private readonly interval: number) {}

  // Called by the loop after each iteration's tool dispatch. Returns
  // the nudge text exactly when the counter wraps; null otherwise.
  // The loop is responsible for pushing the returned text as a
  // system-role message into the conversation.
  shouldFire(): string | null {
    if (this.interval <= 0) return null;
    this.sinceLast += 1;
    if (this.sinceLast < this.interval) return null;
    this.sinceLast = 0;
    return NUDGE_TEXT;
  }

  // Test-only escape hatch. Production code never calls this.
  reset(): void {
    this.sinceLast = 0;
  }
}
