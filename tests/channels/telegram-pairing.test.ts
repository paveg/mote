import { describe, expect, it } from "bun:test";
import { createPairingStore } from "@/channels/telegram-pairing";

describe("createPairingStore", () => {
  it("generates 32-hex-char codes (128-bit entropy)", () => {
    const store = createPairingStore();
    const p = store.generate(12345);
    expect(p.code).toMatch(/^[0-9a-f]{32}$/);
    expect(p.userId).toBe(12345);
  });

  it("redeem() returns ok on first call, not_found on second (single-use)", () => {
    const store = createPairingStore();
    const p = store.generate(42);
    expect(store.redeem(p.code)).toEqual({ ok: true, userId: 42 });
    expect(store.redeem(p.code)).toEqual({ ok: false, reason: "not_found" });
  });

  it("redeem() returns not_found for an unknown code", () => {
    const store = createPairingStore();
    expect(store.redeem("0".repeat(32))).toEqual({ ok: false, reason: "not_found" });
  });

  it("redeem() returns the stored userId just before expiry", () => {
    let now = 0;
    const store = createPairingStore({ ttlMs: 1000, clock: () => now });
    const p = store.generate(7);
    now = 999;
    expect(store.redeem(p.code)).toEqual({ ok: true, userId: 7 });
  });

  it("redeem() returns expired at and after the expiry instant", () => {
    let now = 0;
    const store = createPairingStore({ ttlMs: 1000, clock: () => now });
    const p = store.generate(8);
    now = 1000;
    expect(store.redeem(p.code)).toEqual({ ok: false, reason: "expired" });
    expect(store.redeem(p.code)).toEqual({ ok: false, reason: "not_found" });
  });

  it("sweep() removes expired pending codes and returns the count", () => {
    let now = 0;
    const store = createPairingStore({ ttlMs: 1000, clock: () => now });
    store.generate(1);
    store.generate(2);
    now = 2000;
    expect(store.sweep()).toBe(2);
    expect(store.sweep()).toBe(0);
  });

  it("sweep() leaves still-valid codes in place", () => {
    let now = 0;
    const store = createPairingStore({ ttlMs: 1000, clock: () => now });
    const fresh = store.generate(11);
    now = 500;
    expect(store.sweep()).toBe(0);
    expect(store.redeem(fresh.code)).toEqual({ ok: true, userId: 11 });
  });

  it("generate() yields distinct codes across calls", () => {
    const store = createPairingStore();
    const a = store.generate(1).code;
    const b = store.generate(1).code;
    expect(a).not.toBe(b);
  });

  it("expiresAt reflects clock + ttl", () => {
    let now = 100;
    const store = createPairingStore({ ttlMs: 50, clock: () => now });
    const p = store.generate(99);
    expect(p.expiresAt).toBe(150);
  });
});
