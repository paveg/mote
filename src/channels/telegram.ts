export interface InboundEnvelope {
  readonly channel: "telegram";
  readonly from: string;
  readonly timestamp: number;
  readonly body: string;
}

interface TelegramFrom {
  id: number;
  is_bot: boolean;
}

interface TelegramChat {
  id: number;
  type: string;
}

interface TelegramMessage {
  message_id: number;
  from: TelegramFrom;
  chat: TelegramChat;
  date: number;
  text?: string;
  voice?: unknown;
  photo?: unknown;
  document?: unknown;
  sticker?: unknown;
}

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
}

export function normalizeUpdate(update: TelegramUpdate): InboundEnvelope | null {
  const msg = update.message;
  if (!msg) return null;
  if (msg.chat.type !== "private") return null;

  const from = String(msg.from.id);
  const timestamp = msg.date * 1000;

  if (typeof msg.text === "string") {
    return { channel: "telegram", from, timestamp, body: msg.text };
  }
  if (msg.voice !== undefined) {
    return { channel: "telegram", from, timestamp, body: "[unsupported: voice]" };
  }
  if (msg.photo !== undefined) {
    return { channel: "telegram", from, timestamp, body: "[unsupported: photo]" };
  }
  if (msg.document !== undefined) {
    return { channel: "telegram", from, timestamp, body: "[unsupported: document]" };
  }
  if (msg.sticker !== undefined) {
    return { channel: "telegram", from, timestamp, body: "[unsupported: sticker]" };
  }
  return null;
}
