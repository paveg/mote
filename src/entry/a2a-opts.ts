// ADR-0010 / ADR-0011: parse and validate env-var options for a2a-serve.
// Exported as a standalone module so the options logic is testable without
// spawning a server process.

export interface ServerOpts {
  bind: string;
  port: number;
  tls?: { cert: string; key: string };
}

// Reads process.env and returns validated ServerOpts.
// Throws descriptively for any constraint violation so the caller can
// surface the message and exit with a clear error.
//
// Constraints:
// - Non-localhost MOTE_A2A_BIND requires MOTE_A2A_TLS_CERT + MOTE_A2A_TLS_KEY
//   (ADR-0011 D1: TLS mandatory outside loopback)
// - MOTE_A2A_ALLOW_ORIGIN=* is rejected (ADR-0010 D3: bearer-token auth
//   is undermined by wildcard CORS)
export function parseA2aServeOpts(): ServerOpts {
  const bind = process.env["MOTE_A2A_BIND"] ?? "127.0.0.1";
  const port = parseInt(process.env["MOTE_A2A_PORT"] ?? "8787", 10);

  const certPath = process.env["MOTE_A2A_TLS_CERT"];
  const keyPath = process.env["MOTE_A2A_TLS_KEY"];

  // ADR-0011 D1: non-localhost bind requires TLS
  const isLocalhost =
    bind === "127.0.0.1" || bind === "::1" || bind === "localhost";
  if (!isLocalhost && (!certPath || !keyPath)) {
    throw new Error(
      `MOTE_A2A_BIND=${bind} requires both MOTE_A2A_TLS_CERT and MOTE_A2A_TLS_KEY (TLS is mandatory for non-localhost binds; see ADR-0011 D1)`,
    );
  }

  // Wildcard CORS rejection (ADR-0010 D3)
  if (process.env["MOTE_A2A_ALLOW_ORIGIN"] === "*") {
    throw new Error(
      "MOTE_A2A_ALLOW_ORIGIN=* is rejected — bearer-token auth is undermined by wildcard CORS (see ADR-0010 D3); use a specific origin allowlist instead",
    );
  }

  if (certPath && keyPath) {
    return { bind, port, tls: { cert: certPath, key: keyPath } };
  }
  return { bind, port };
}
