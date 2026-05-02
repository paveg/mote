import { test, expect } from "bun:test";
import { composeSystemPrompt } from "@/core/persona";

test("composeSystemPrompt returns just the base when both files are null", () => {
  expect(composeSystemPrompt(null, null)).toBe("You are mote, a minimal personal AI agent.");
});

test("composeSystemPrompt appends SOUL.md under a heading", () => {
  const out = composeSystemPrompt("I am thoughtful.", null);
  expect(out).toContain("You are mote");
  expect(out).toContain("# Persona (SOUL.md)");
  expect(out).toContain("I am thoughtful.");
});

test("composeSystemPrompt appends MEMORY.md under a heading", () => {
  const out = composeSystemPrompt(null, "remembered things");
  expect(out).toContain("# Memory (MEMORY.md)");
  expect(out).toContain("remembered things");
});

test("composeSystemPrompt orders: base, persona, memory", () => {
  const out = composeSystemPrompt("persona", "memory");
  const baseIdx = out.indexOf("You are mote");
  const personaIdx = out.indexOf("# Persona");
  const memoryIdx = out.indexOf("# Memory");
  expect(baseIdx).toBeLessThan(personaIdx);
  expect(personaIdx).toBeLessThan(memoryIdx);
});

test("composeSystemPrompt separates sections with blank lines", () => {
  const out = composeSystemPrompt("persona", "memory");
  expect(out).toContain("\n\n# Persona");
  expect(out).toContain("\n\n# Memory");
});
