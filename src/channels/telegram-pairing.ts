import { randomBytes } from "node:crypto";

export interface PendingPairing {
  readonly code: string;
  readonly userId: number;
  readonly expiresAt: number;
}

export interface PairingStore {
  generate(userId: number): PendingPairing;
  redeem(code: string): { userId: number } | null;
  sweep(now?: number): number;
}

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

export function createPairingStore(
  opts: {
    ttlMs?: number;
    clock?: () => number;
  } = {},
): PairingStore {
  const ttlMs = opts.ttlMs ?? DEFAULT_TTL_MS;
  const clock = opts.clock ?? (() => Date.now());
  const pending = new Map<string, PendingPairing>();

  return {
    generate(userId) {
      const code = randomBytes(16).toString("hex");
      const entry: PendingPairing = { code, userId, expiresAt: clock() + ttlMs };
      pending.set(code, entry);
      return entry;
    },
    redeem(code) {
      const entry = pending.get(code);
      if (!entry) return null;
      pending.delete(code);
      if (clock() >= entry.expiresAt) return null;
      return { userId: entry.userId };
    },
    sweep(now) {
      const t = now ?? clock();
      let removed = 0;
      for (const [code, entry] of pending) {
        if (t >= entry.expiresAt) {
          pending.delete(code);
          removed += 1;
        }
      }
      return removed;
    },
  };
}
