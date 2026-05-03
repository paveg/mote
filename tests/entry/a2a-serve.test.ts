import { test, expect, beforeEach } from "bun:test";

// Helpers to isolate env mutations across tests
function withEnv(overrides: Record<string, string | undefined>, fn: () => unknown) {
  const saved: Record<string, string | undefined> = {};
  for (const key of Object.keys(overrides)) {
    saved[key] = process.env[key];
    const val = overrides[key];
    if (val === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = val;
    }
  }
  try {
    return fn();
  } finally {
    for (const key of Object.keys(saved)) {
      const prev = saved[key];
      if (prev === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = prev;
      }
    }
  }
}

// Reset relevant env vars before each test so cached module state
// from a previous test cannot leak. The module itself is stateless
// (parseA2aServeOpts reads process.env at call time), so this is
// belt-and-suspenders.
beforeEach(() => {
  delete process.env["MOTE_A2A_BIND"];
  delete process.env["MOTE_A2A_PORT"];
  delete process.env["MOTE_A2A_TLS_CERT"];
  delete process.env["MOTE_A2A_TLS_KEY"];
  delete process.env["MOTE_A2A_ALLOW_ORIGIN"];
});

test("a2a-opts module imports cleanly (smoke)", async () => {
  const mod = await import("@/entry/a2a-opts");
  expect(mod).toBeDefined();
  expect(typeof mod.parseA2aServeOpts).toBe("function");
});

test("parseA2aServeOpts: accepts default localhost bind without TLS", async () => {
  const { parseA2aServeOpts } = await import("@/entry/a2a-opts");
  const opts = parseA2aServeOpts();
  expect(opts.bind).toBe("127.0.0.1");
  expect(opts.port).toBe(8787);
  expect(opts.tls).toBeUndefined();
});

test("parseA2aServeOpts: refuses non-localhost bind without TLS", async () => {
  const { parseA2aServeOpts } = await import("@/entry/a2a-opts");
  withEnv({ MOTE_A2A_BIND: "0.0.0.0", MOTE_A2A_TLS_CERT: undefined, MOTE_A2A_TLS_KEY: undefined }, () => {
    expect(() => parseA2aServeOpts()).toThrow(/MOTE_A2A_BIND.*TLS/);
  });
});

test("parseA2aServeOpts: rejects MOTE_A2A_ALLOW_ORIGIN=*", async () => {
  const { parseA2aServeOpts } = await import("@/entry/a2a-opts");
  withEnv({ MOTE_A2A_ALLOW_ORIGIN: "*" }, () => {
    expect(() => parseA2aServeOpts()).toThrow(/wildcard CORS/);
  });
});

test("parseA2aServeOpts: accepts custom port", async () => {
  const { parseA2aServeOpts } = await import("@/entry/a2a-opts");
  withEnv({ MOTE_A2A_PORT: "9090" }, () => {
    const opts = parseA2aServeOpts();
    expect(opts.port).toBe(9090);
  });
});

test("parseA2aServeOpts: returns tls opts when both cert and key are provided on localhost", async () => {
  const { parseA2aServeOpts } = await import("@/entry/a2a-opts");
  withEnv({ MOTE_A2A_TLS_CERT: "/tmp/cert.pem", MOTE_A2A_TLS_KEY: "/tmp/key.pem" }, () => {
    const opts = parseA2aServeOpts();
    expect(opts.tls).toEqual({ cert: "/tmp/cert.pem", key: "/tmp/key.pem" });
  });
});

test("parseA2aServeOpts: ::1 is treated as localhost (no TLS required)", async () => {
  const { parseA2aServeOpts } = await import("@/entry/a2a-opts");
  withEnv({ MOTE_A2A_BIND: "::1" }, () => {
    const opts = parseA2aServeOpts();
    expect(opts.bind).toBe("::1");
    expect(opts.tls).toBeUndefined();
  });
});
