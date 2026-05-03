import { appendFile, chmod, open } from "node:fs/promises";

export type AuditEvent =
  | { type: "approved"; from: number; bytes: number }
  | { type: "tool-dispatched"; from: number; tool: string }
  | { type: "pending-pairing"; from: number; code: string }
  | { type: "rejected"; from: number; reason: string };

export interface AuditLogger {
  log(event: AuditEvent): Promise<void>;
}

export async function createAuditLogger(
  filePath: string,
  opts: { token: string },
): Promise<AuditLogger> {
  // Ensure file exists with 0o600. open() with "a" creates if missing.
  const handle = await open(filePath, "a", 0o600);
  await handle.close();
  await chmod(filePath, 0o600);

  const tokenRedactor = new RegExp(escapeRegExp(opts.token), "g");

  return {
    log: async (event) => {
      const ts = new Date().toISOString();
      let line: string;
      switch (event.type) {
        case "approved":
          line = `${ts}\tfrom=${event.from}\tresult=approved\tbytes=${event.bytes}`;
          break;
        case "tool-dispatched":
          line = `${ts}\tfrom=${event.from}\tresult=tool-dispatched\ttool=${event.tool}`;
          break;
        case "pending-pairing": {
          const prefix = new Bun.CryptoHasher("sha256")
            .update(event.code)
            .digest("hex")
            .slice(0, 8);
          line = `${ts}\tfrom=${event.from}\tresult=pending-pairing\tcode=${prefix}`;
          break;
        }
        case "rejected":
          line = `${ts}\tfrom=${event.from}\tresult=rejected\treason=${event.reason}`;
          break;
      }
      const safe = line.replace(tokenRedactor, "<redacted>");
      await appendFile(filePath, `${safe}\n`);
    },
  };
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
