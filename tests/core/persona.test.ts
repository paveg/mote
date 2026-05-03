import { test, expect } from "bun:test";
import { composeSystemPrompt } from "@/core/persona";

test("composeSystemPrompt returns a single base section when SOUL/MEMORY are null", () => {
  const sections = composeSystemPrompt(null, null);
  expect(sections).toHaveLength(1);
  expect(sections[0]?.text).toBe("You are mote, a minimal personal AI agent.");
  expect(sections[0]?.cache).toBe(true);
});

test("composeSystemPrompt appends SOUL section when present", () => {
  const sections = composeSystemPrompt("I value brevity.", null);
  expect(sections).toHaveLength(2);
  expect(sections[1]?.text).toContain("# Persona (SOUL.md)");
  expect(sections[1]?.text).toContain("I value brevity.");
  expect(sections[1]?.cache).toBe(true);
});

test("composeSystemPrompt appends MEMORY section when present", () => {
  const sections = composeSystemPrompt(null, "remember this");
  expect(sections).toHaveLength(2);
  expect(sections[1]?.text).toContain("# Memory (MEMORY.md)");
  expect(sections[1]?.text).toContain("remember this");
});

test("composeSystemPrompt orders: base, persona, memory", () => {
  const sections = composeSystemPrompt("p", "m");
  expect(sections).toHaveLength(3);
  expect(sections[0]?.text).toContain("You are mote");
  expect(sections[1]?.text).toContain("Persona");
  expect(sections[2]?.text).toContain("Memory");
});

test("each section is marked cache:true so Anthropic inserts a breakpoint", () => {
  const sections = composeSystemPrompt("p", "m");
  for (const s of sections) {
    expect(s.cache).toBe(true);
  }
});
