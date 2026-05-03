import { describe, expect, it } from "bun:test";
import { normalizeUpdate } from "@/channels/telegram";

const baseFrom = { id: 12345, is_bot: false } as const;
const baseChat = (type: string) => ({ id: 12345, type }) as const;

describe("normalizeUpdate", () => {
  it("normalizes a private DM with text into the canonical envelope", () => {
    const update = {
      update_id: 1,
      message: {
        message_id: 100,
        from: { ...baseFrom },
        chat: baseChat("private"),
        date: 1730000000,
        text: "hello",
      },
    };
    expect(normalizeUpdate(update)).toEqual({
      channel: "telegram",
      from: "12345",
      timestamp: 1730000000000,
      body: "hello",
    });
  });

  it("returns null for group chat", () => {
    expect(
      normalizeUpdate({
        update_id: 1,
        message: {
          message_id: 1,
          from: { ...baseFrom },
          chat: baseChat("group"),
          date: 1,
          text: "x",
        },
      }),
    ).toBeNull();
  });

  it("returns null for supergroup chat", () => {
    expect(
      normalizeUpdate({
        update_id: 1,
        message: {
          message_id: 1,
          from: { ...baseFrom },
          chat: baseChat("supergroup"),
          date: 1,
          text: "x",
        },
      }),
    ).toBeNull();
  });

  it("returns null for channel posts", () => {
    expect(
      normalizeUpdate({
        update_id: 1,
        message: {
          message_id: 1,
          from: { ...baseFrom },
          chat: baseChat("channel"),
          date: 1,
          text: "x",
        },
      }),
    ).toBeNull();
  });

  it("returns null when there is no message (e.g., only callback_query)", () => {
    expect(normalizeUpdate({ update_id: 1 })).toBeNull();
  });

  it("emits an unsupported marker for voice messages", () => {
    expect(
      normalizeUpdate({
        update_id: 1,
        message: {
          message_id: 1,
          from: { ...baseFrom },
          chat: baseChat("private"),
          date: 1,
          voice: {},
        },
      }),
    ).toEqual({ channel: "telegram", from: "12345", timestamp: 1000, body: "[unsupported: voice]" });
  });

  it("emits an unsupported marker for photos", () => {
    expect(
      normalizeUpdate({
        update_id: 1,
        message: {
          message_id: 1,
          from: { ...baseFrom },
          chat: baseChat("private"),
          date: 2,
          photo: [{ file_id: "x" }],
        },
      }),
    ).toEqual({ channel: "telegram", from: "12345", timestamp: 2000, body: "[unsupported: photo]" });
  });

  it("emits an unsupported marker for documents", () => {
    expect(
      normalizeUpdate({
        update_id: 1,
        message: {
          message_id: 1,
          from: { ...baseFrom },
          chat: baseChat("private"),
          date: 3,
          document: { file_id: "x" },
        },
      }),
    ).toEqual({ channel: "telegram", from: "12345", timestamp: 3000, body: "[unsupported: document]" });
  });

  it("emits an unsupported marker for stickers", () => {
    expect(
      normalizeUpdate({
        update_id: 1,
        message: {
          message_id: 1,
          from: { ...baseFrom },
          chat: baseChat("private"),
          date: 4,
          sticker: { file_id: "x" },
        },
      }),
    ).toEqual({ channel: "telegram", from: "12345", timestamp: 4000, body: "[unsupported: sticker]" });
  });

  it("emits an unsupported marker for an empty/unknown-content private message", () => {
    expect(
      normalizeUpdate({
        update_id: 1,
        message: {
          message_id: 1,
          from: { ...baseFrom },
          chat: baseChat("private"),
          date: 1,
        },
      }),
    ).toEqual({ channel: "telegram", from: "12345", timestamp: 1000, body: "[unsupported: unknown]" });
  });

  it("emits unsupported for unrecognized media types (video_note, animation, etc.)", () => {
    expect(
      normalizeUpdate({
        update_id: 1,
        message: {
          message_id: 1,
          from: { ...baseFrom },
          chat: baseChat("private"),
          date: 5,
          // @ts-expect-error - schema is intentionally minimal; video_note isn't in TelegramMessage
          video_note: { file_id: "x" },
        },
      }),
    ).toEqual({ channel: "telegram", from: "12345", timestamp: 5000, body: "[unsupported: unknown]" });
  });

  it("returns null when the message has no from (anonymous channel post)", () => {
    expect(
      normalizeUpdate({
        update_id: 1,
        message: {
          message_id: 1,
          chat: baseChat("private"),
          date: 1,
          text: "x",
        } as never, // type-cast: TS won't let us omit `from` against the public shape
      }),
    ).toBeNull();
  });

  it("preserves negative-id senders (chat with self has id < 0 sometimes; the from id must round-trip)", () => {
    const result = normalizeUpdate({
      update_id: 1,
      message: {
        message_id: 1,
        from: { id: -42, is_bot: false },
        chat: baseChat("private"),
        date: 1,
        text: "x",
      },
    });
    expect(result).toEqual({ channel: "telegram", from: "-42", timestamp: 1000, body: "x" });
  });
});
