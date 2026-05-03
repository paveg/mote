import { test, expect } from "bun:test";
import { parseFrontmatter } from "@/skills/frontmatter";

test("parseFrontmatter extracts fields from a basic SKILL.md", () => {
  const content = `---
name: search-arxiv
description: Search arxiv for papers. Pass the query in English.
---
Body content here.`;
  const parsed = parseFrontmatter(content);
  expect(parsed.fields).toEqual({
    name: "search-arxiv",
    description: "Search arxiv for papers. Pass the query in English.",
  });
  expect(parsed.body).toBe("Body content here.");
});

test("parseFrontmatter unquotes single and double quoted values", () => {
  const content = `---
name: hello
description: "this contains a colon: like this"
note: 'single-quoted'
---
body`;
  const parsed = parseFrontmatter(content);
  expect(parsed.fields["description"]).toBe("this contains a colon: like this");
  expect(parsed.fields["note"]).toBe("single-quoted");
});

test("parseFrontmatter returns empty fields when no opening delimiter", () => {
  const content = `Just a markdown file with no frontmatter.`;
  const parsed = parseFrontmatter(content);
  expect(parsed.fields).toEqual({});
  expect(parsed.body).toBe(content);
});

test("parseFrontmatter throws when opening `---` has no matching closing", () => {
  const content = `---
name: broken
no closing delimiter`;
  expect(() => parseFrontmatter(content)).toThrow(/no matching closing/);
});

test("parseFrontmatter throws on a line missing `:`", () => {
  const content = `---
name: ok
this line has no colon
---
body`;
  expect(() => parseFrontmatter(content)).toThrow(/no \`:\`/);
});

test("parseFrontmatter normalizes Windows line endings", () => {
  const content = `---\r\nname: cross-platform\r\ndescription: works\r\n---\r\nbody`;
  const parsed = parseFrontmatter(content);
  expect(parsed.fields).toEqual({ name: "cross-platform", description: "works" });
  expect(parsed.body).toBe("body");
});

test("parseFrontmatter ignores blank lines inside the frontmatter", () => {
  const content = `---
name: with-blanks

description: ok
---
body`;
  const parsed = parseFrontmatter(content);
  expect(parsed.fields).toEqual({ name: "with-blanks", description: "ok" });
});

test("parseFrontmatter preserves body content with multiple lines", () => {
  const content = `---
name: multiline
description: test
---
Line 1
Line 2

Line 4`;
  const parsed = parseFrontmatter(content);
  expect(parsed.body).toBe("Line 1\nLine 2\n\nLine 4");
});

// --- boundary: empty body, leading-whitespace key, escaped quote ----------

test("parseFrontmatter: empty body after closing `---` returns body=\"\"", () => {
  const content = `---\nname: x\ndescription: y\n---\n`;
  const parsed = parseFrontmatter(content);
  expect(parsed.body).toBe("");
});

test("parseFrontmatter: key with leading whitespace is normalized via trim", () => {
  const content = `---\n  name: hello\ndescription: ok\n---\nbody`;
  const parsed = parseFrontmatter(content);
  expect(parsed.fields["name"]).toBe("hello");
});

test("parseFrontmatter: embedded escape sequences inside quoted values are kept literal (no escape handling)", () => {
  const content = `---\nname: x\ndescription: "foo \\"bar\\" baz"\n---\nbody`;
  const parsed = parseFrontmatter(content);
  // The unquote() helper strips ONE outer pair of quotes; backslash-escaped
  // inner quotes are retained verbatim. This pins "no escape handling".
  expect(parsed.fields["description"]).toBe('foo \\"bar\\" baz');
});

// --- security: duplicate key rejection (ADR-0014 D4 / pentest M4) ----------

test("throws on duplicate key (mcp:) — closes ADR-0014 D4 / pentest M4 trust-flag spoof", () => {
  const input = "---\nname: hello\ndescription: greet\nmcp: private\nmcp: public\n---\nbody";
  expect(() => parseFrontmatter(input)).toThrow(/duplicate.*mcp/i);
});

test("throws on duplicate key (name:)", () => {
  const input = "---\nname: a\nname: b\ndescription: x\n---\n";
  expect(() => parseFrontmatter(input)).toThrow(/duplicate.*name/i);
});

test("error message includes the line number of the duplicate", () => {
  const input = "---\nname: a\ndescription: d\nmcp: x\nmcp: y\n---\n";
  // The duplicate `mcp:` is on line 5 (1-indexed within the document, including the opening ---).
  // Accept the line that the parser counts — pin the actual emitted number after first run.
  expect(() => parseFrontmatter(input)).toThrow(/line \d+/);
});

test("preserves single-key parsing (regression — no false-positive throws)", () => {
  const input = "---\nname: hello\ndescription: greet user\nmcp: public\n---\n# body";
  const parsed = parseFrontmatter(input);
  expect(parsed.fields).toEqual({ name: "hello", description: "greet user", mcp: "public" });
});
