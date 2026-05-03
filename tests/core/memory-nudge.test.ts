import { test, expect } from "bun:test";
import { MemoryNudge } from "@/core/memory-nudge";

test("MemoryNudge fires every `interval` calls", () => {
  const n = new MemoryNudge(3);
  expect(n.shouldFire()).toBeNull();
  expect(n.shouldFire()).toBeNull();
  expect(n.shouldFire()).not.toBeNull(); // 3rd call fires
  expect(n.shouldFire()).toBeNull();     // counter reset
  expect(n.shouldFire()).toBeNull();
  expect(n.shouldFire()).not.toBeNull(); // 6th call fires
});

test("MemoryNudge with interval 0 never fires (disabled)", () => {
  const n = new MemoryNudge(0);
  for (let i = 0; i < 100; i++) {
    expect(n.shouldFire()).toBeNull();
  }
});

test("MemoryNudge with negative interval also never fires", () => {
  const n = new MemoryNudge(-5);
  expect(n.shouldFire()).toBeNull();
});

test("MemoryNudge text mentions memory_append by name", () => {
  const n = new MemoryNudge(1);
  const text = n.shouldFire();
  expect(text).not.toBeNull();
  expect(text!).toContain("memory_append");
});
