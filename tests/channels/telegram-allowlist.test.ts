import { describe, expect, it } from "bun:test";
import { mkdtempSync } from "node:fs";
import { stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadAllowlist } from "@/channels/telegram-allowlist";

describe("loadAllowlist", () => {
  it("returns empty allowlist when file does not exist", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mote-allowlist-"));
    const file = join(dir, "telegram-allowlist.json");
    const allowlist = await loadAllowlist(file);
    expect(allowlist.list()).toEqual([]);
    expect(allowlist.has(12345)).toBe(false);
  });

  it("persists add() and round-trips on reload", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mote-allowlist-"));
    const file = join(dir, "telegram-allowlist.json");
    const a = await loadAllowlist(file);
    await a.add({ userId: 12345, approvedAt: 1730000000000, note: "operator" });
    expect(a.has(12345)).toBe(true);
    const b = await loadAllowlist(file);
    expect(b.has(12345)).toBe(true);
    expect(b.list()).toEqual([{ userId: 12345, approvedAt: 1730000000000, note: "operator" }]);
  });

  it("writes file with mode 0o600", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mote-allowlist-"));
    const file = join(dir, "telegram-allowlist.json");
    const a = await loadAllowlist(file);
    await a.add({ userId: 1, approvedAt: 1 });
    const s = await stat(file);
    expect(s.mode & 0o777).toBe(0o600);
  });

  it("rejects malformed JSON", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mote-allowlist-"));
    const file = join(dir, "telegram-allowlist.json");
    await Bun.write(file, "{ this is not valid }");
    await expect(loadAllowlist(file)).rejects.toThrow(/malformed/i);
  });

  it("remove() is idempotent for unknown userId", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mote-allowlist-"));
    const file = join(dir, "telegram-allowlist.json");
    const a = await loadAllowlist(file);
    await a.remove(99); // does not throw
    expect(a.list()).toEqual([]);
  });

  it("add() updates an existing entry in place rather than duplicating", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mote-allowlist-"));
    const file = join(dir, "telegram-allowlist.json");
    const a = await loadAllowlist(file);
    await a.add({ userId: 1, approvedAt: 100 });
    await a.add({ userId: 1, approvedAt: 200, note: "updated" });
    expect(a.list()).toEqual([{ userId: 1, approvedAt: 200, note: "updated" }]);
  });

  it("rejects file content that does not match the v1 schema", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mote-allowlist-"));
    const file = join(dir, "telegram-allowlist.json");
    await Bun.write(file, JSON.stringify({ version: 99, approved: [] }));
    await expect(loadAllowlist(file)).rejects.toThrow(/malformed/i);
  });

  it("remove() drops a present entry and persists on reload", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mote-allowlist-"));
    const file = join(dir, "telegram-allowlist.json");
    const a = await loadAllowlist(file);
    await a.add({ userId: 7, approvedAt: 100 });
    expect(a.has(7)).toBe(true);
    await a.remove(7);
    expect(a.has(7)).toBe(false);
    expect(a.list()).toEqual([]);
    const b = await loadAllowlist(file);
    expect(b.has(7)).toBe(false);
    expect(b.list()).toEqual([]);
  });
});
