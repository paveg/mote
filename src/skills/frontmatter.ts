// Hand-rolled minimal YAML-frontmatter parser.
//
// Supports exactly what agentskills.io SKILL.md uses:
// - File starts with `---` on its own line
// - Followed by N lines of `key: value` (value may be quoted or unquoted)
// - Closed with `---` on its own line
// - Everything after the closing `---` is the body
//
// Out of scope: nested objects, arrays, anchors, multi-line scalars,
// flow style, comments. If you need them, write an ADR first.

export interface ParsedFrontmatter {
  readonly fields: Readonly<Record<string, string>>;
  readonly body: string;
}

const FRONTMATTER_DELIMITER = "---";

export function parseFrontmatter(content: string): ParsedFrontmatter {
  // Normalize line endings so Windows-authored SKILL.md files parse the same way.
  const normalized = content.replace(/\r\n?/g, "\n");
  const lines = normalized.split("\n");

  if (lines[0]?.trim() !== FRONTMATTER_DELIMITER) {
    return { fields: {}, body: normalized };
  }

  // Find the closing delimiter
  let endIndex = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i]?.trim() === FRONTMATTER_DELIMITER) {
      endIndex = i;
      break;
    }
  }
  if (endIndex === -1) {
    throw new Error("frontmatter: opening `---` has no matching closing `---`");
  }

  const fields: Record<string, string> = {};
  for (let i = 1; i < endIndex; i++) {
    const line = lines[i] ?? "";
    if (line.trim() === "") continue;
    const colonIndex = line.indexOf(":");
    if (colonIndex === -1) {
      throw new Error(`frontmatter: line ${i + 1} has no \`:\` (got: ${JSON.stringify(line)})`);
    }
    const key = line.slice(0, colonIndex).trim();
    const rawValue = line.slice(colonIndex + 1).trim();
    if (key === "") {
      throw new Error(`frontmatter: line ${i + 1} has empty key`);
    }
    if (key in fields) {
      throw new Error(`frontmatter: duplicate key "${key}" at line ${i + 1}`);
    }
    fields[key] = unquote(rawValue);
  }

  const body = lines.slice(endIndex + 1).join("\n");
  return { fields, body };
}

// Strip a single pair of surrounding quotes if present. agentskills.io's
// description sometimes includes a colon (e.g. "Run: command") and quoting
// is the standard way to keep that on one line.
function unquote(s: string): string {
  if (s.length >= 2) {
    if (s.startsWith('"') && s.endsWith('"')) return s.slice(1, -1);
    if (s.startsWith("'") && s.endsWith("'")) return s.slice(1, -1);
  }
  return s;
}
