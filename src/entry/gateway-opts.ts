import { validateToken } from "@/channels/telegram";

export interface GatewayOpts {
  readonly token: string;
  readonly masterId: number;
}

export function resolveGatewayOpts(env: Record<string, string | undefined>): GatewayOpts {
  const token = env["MOTE_TELEGRAM_TOKEN"];
  if (!token) throw new Error("MOTE_TELEGRAM_TOKEN is required");
  validateToken(token);
  const masterRaw = env["MOTE_TELEGRAM_MASTER_ID"];
  if (!masterRaw) throw new Error("MOTE_TELEGRAM_MASTER_ID is required");
  const masterId = Number.parseInt(masterRaw, 10);
  if (!Number.isFinite(masterId) || String(masterId) !== masterRaw.trim()) {
    throw new Error("MOTE_TELEGRAM_MASTER_ID must be a numeric Telegram user id");
  }
  return { token, masterId };
}
