import { describe, expect, it } from "bun:test";
import { mkdtempSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAuditLogger } from "@/channels/telegram-audit";

const CANARY_TOKEN = "1234567890:CANARY-TOKEN-DO-NOT-LEAK-1234567890";

describe("createAuditLogger", () => {
  it("never logs the bot token (canary regression)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mote-audit-"));
    const file = join(dir, "telegram-audit.log");
    const log = await createAuditLogger(file, { token: CANARY_TOKEN });
    await log.log({ type: "approved", from: 12345, bytes: 42 });
    const body = await readFile(file, "utf8");
    expect(body).not.toContain(CANARY_TOKEN);
    expect(body).not.toContain("CANARY");
  });

  it("redacts the token even if it appears inside an event field", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mote-audit-"));
    const file = join(dir, "telegram-audit.log");
    const log = await createAuditLogger(file, { token: CANARY_TOKEN });
    // Synthesize a "rejected" event whose reason field contains the token.
    // The redactor must replace the substring before append.
    await log.log({ type: "rejected", from: 1, reason: `bad payload: ${CANARY_TOKEN}` });
    const body = await readFile(file, "utf8");
    expect(body).not.toContain(CANARY_TOKEN);
    expect(body).toContain("<redacted>");
  });

  it("logs only first 8 hex chars of pairing code SHA-256", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mote-audit-"));
    const file = join(dir, "telegram-audit.log");
    const log = await createAuditLogger(file, { token: CANARY_TOKEN });
    const code = "0123456789abcdef0123456789abcdef";
    await log.log({ type: "pending-pairing", from: 999, code });
    const body = await readFile(file, "utf8");
    expect(body).not.toContain(code);
    const hash = new Bun.CryptoHasher("sha256").update(code).digest("hex");
    expect(body).toContain(hash.slice(0, 8));
  });

  it("creates the file with mode 0o600", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mote-audit-"));
    const file = join(dir, "telegram-audit.log");
    const log = await createAuditLogger(file, { token: CANARY_TOKEN });
    await log.log({ type: "approved", from: 1, bytes: 0 });
    const s = await stat(file);
    expect(s.mode & 0o777).toBe(0o600);
  });

  it("appends one line per event without overwriting", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mote-audit-"));
    const file = join(dir, "telegram-audit.log");
    const log = await createAuditLogger(file, { token: CANARY_TOKEN });
    await log.log({ type: "approved", from: 1, bytes: 0 });
    await log.log({ type: "tool-dispatched", from: 1, tool: "summarize" });
    await log.log({ type: "rejected", from: 2, reason: "not in allowlist" });
    const body = await readFile(file, "utf8");
    expect(body.trim().split("\n")).toHaveLength(3);
  });

  it("includes ISO-8601 timestamp, from, and result fields per line", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mote-audit-"));
    const file = join(dir, "telegram-audit.log");
    const log = await createAuditLogger(file, { token: CANARY_TOKEN });
    await log.log({ type: "approved", from: 12345, bytes: 42 });
    const body = await readFile(file, "utf8");
    const line = body.trim();
    expect(line).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    expect(line).toContain("from=12345");
    expect(line).toContain("result=approved");
    expect(line).toContain("bytes=42");
  });

  it("preserves prior content when appending", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mote-audit-"));
    const file = join(dir, "telegram-audit.log");
    await Bun.write(file, "preexisting line\n");
    const log = await createAuditLogger(file, { token: CANARY_TOKEN });
    await log.log({ type: "approved", from: 7, bytes: 1 });
    const body = await readFile(file, "utf8");
    expect(body.startsWith("preexisting line\n")).toBe(true);
    expect(body.split("\n").filter(Boolean)).toHaveLength(2);
  });
});
