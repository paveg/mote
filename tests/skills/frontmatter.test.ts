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
