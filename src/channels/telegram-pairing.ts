import { randomBytes } from "node:crypto";

export interface PendingPairing {
  readonly code: string;
  readonly userId: number;
  readonly expiresAt: number;
}

export type RedeemResult =
  | { ok: true; userId: number }
  | { ok: false; reason: "not_found" | "expired" };

export interface PairingStore {
  generate(userId: number): PendingPairing;
  redeem(code: string): RedeemResult;
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
  const byUser = new Map<number, string>();

  return {
    generate(userId) {
      const oldCode = byUser.get(userId);
      if (oldCode !== undefined) {
        pending.delete(oldCode);
        byUser.delete(userId);
      }
      const code = randomBytes(16).toString("hex");
      const entry: PendingPairing = { code, userId, expiresAt: clock() + ttlMs };
      pending.set(code, entry);
      byUser.set(userId, code);
      return entry;
    },
    redeem(code) {
      const entry = pending.get(code);
      if (!entry) return { ok: false, reason: "not_found" };
      pending.delete(code);
      byUser.delete(entry.userId);
      if (clock() >= entry.expiresAt) return { ok: false, reason: "expired" };
      return { ok: true, userId: entry.userId };
    },
    sweep(now) {
      const t = now ?? clock();
      let removed = 0;
      for (const [code, entry] of pending) {
        if (t >= entry.expiresAt) {
          pending.delete(code);
          byUser.delete(entry.userId);
          removed += 1;
        }
      }
      return removed;
    },
  };
}
