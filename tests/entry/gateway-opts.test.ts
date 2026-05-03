import { describe, expect, it } from "bun:test";
import { resolveGatewayOpts } from "@/entry/gateway-opts";

const validToken = `1234567890:${"a".repeat(35)}`;

describe("resolveGatewayOpts", () => {
  it("returns parsed opts on success", () => {
    expect(
      resolveGatewayOpts({
        MOTE_TELEGRAM_TOKEN: validToken,
        MOTE_TELEGRAM_MASTER_ID: "12345",
      }),
    ).toEqual({ token: validToken, masterId: 12345 });
  });

  it("requires MOTE_TELEGRAM_TOKEN", () => {
    expect(() => resolveGatewayOpts({})).toThrow(/MOTE_TELEGRAM_TOKEN/);
  });

  it("rejects empty MOTE_TELEGRAM_TOKEN", () => {
    expect(() =>
      resolveGatewayOpts({ MOTE_TELEGRAM_TOKEN: "", MOTE_TELEGRAM_MASTER_ID: "1" }),
    ).toThrow(/MOTE_TELEGRAM_TOKEN/);
  });

  it("rejects malformed MOTE_TELEGRAM_TOKEN (validateToken integration)", () => {
    expect(() =>
      resolveGatewayOpts({
        MOTE_TELEGRAM_TOKEN: "not-a-token",
        MOTE_TELEGRAM_MASTER_ID: "12345",
      }),
    ).toThrow(/format/i);
  });

  it("requires MOTE_TELEGRAM_MASTER_ID", () => {
    expect(() =>
      resolveGatewayOpts({ MOTE_TELEGRAM_TOKEN: validToken }),
    ).toThrow(/MOTE_TELEGRAM_MASTER_ID/);
  });

  it("rejects empty MOTE_TELEGRAM_MASTER_ID", () => {
    expect(() =>
      resolveGatewayOpts({ MOTE_TELEGRAM_TOKEN: validToken, MOTE_TELEGRAM_MASTER_ID: "" }),
    ).toThrow(/MOTE_TELEGRAM_MASTER_ID/);
  });

  it("rejects non-numeric MOTE_TELEGRAM_MASTER_ID", () => {
    expect(() =>
      resolveGatewayOpts({
        MOTE_TELEGRAM_TOKEN: validToken,
        MOTE_TELEGRAM_MASTER_ID: "abc",
      }),
    ).toThrow(/numeric/i);
  });

  it("rejects MOTE_TELEGRAM_MASTER_ID with trailing garbage (parseInt would silently accept)", () => {
    expect(() =>
      resolveGatewayOpts({
        MOTE_TELEGRAM_TOKEN: validToken,
        MOTE_TELEGRAM_MASTER_ID: "12345abc",
      }),
    ).toThrow(/numeric/i);
  });

  it("accepts negative master id (Telegram chat ids can be negative for some flows; let it through)", () => {
    // Note: bot DMs from real users always have positive ids, but resolveGatewayOpts is
    // a syntactic env-validator — semantic rejection is the gateway's concern.
    expect(
      resolveGatewayOpts({
        MOTE_TELEGRAM_TOKEN: validToken,
        MOTE_TELEGRAM_MASTER_ID: "-42",
      }),
    ).toEqual({ token: validToken, masterId: -42 });
  });
});
