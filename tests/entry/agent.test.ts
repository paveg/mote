import { test, expect } from "bun:test";
import { spawn } from "node:child_process";

const HAS_API_KEY =
  Boolean(process.env["LLM_API_KEY"]) || Boolean(process.env["ANTHROPIC_API_KEY"]);

test.skipIf(!HAS_API_KEY)(
  "bun run agent exits cleanly on /exit without hanging",
  async () => {
    const child = spawn("bun", ["run", "src/entry/agent.ts"], {
      cwd: process.cwd(),
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, MOTE_DEBUG: "1" },
    });

    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (d) => {
      stdout += d.toString();
    });
    child.stderr?.on("data", (d) => {
      stderr += d.toString();
    });

    // Wait for the prompt to appear, then send /exit
    await new Promise<void>((resolve) => {
      const watcher = (chunk: Buffer) => {
        if (chunk.toString().includes("> ")) {
          child.stdout?.off("data", watcher);
          resolve();
        }
      };
      child.stdout?.on("data", watcher);
      // safety timeout
      setTimeout(resolve, 2000);
    });

    child.stdin?.write("/exit\n");
    child.stdin?.end();

    const code = await new Promise<number>((resolve) => {
      child.on("exit", (c) => resolve(c ?? -1));
    });

    expect(code).toBe(0);
    // Should not print a stack trace
    expect(stderr).not.toMatch(/at Object\.<anonymous>/);
  },
  10000,
);

test("CLI module imports cleanly (smoke check)", async () => {
  // Just confirm the entry file parses and imports without side-effects on import.
  // The actual main() is invoked when running as a script.
  const mod = await import("@/entry/agent");
  expect(mod).toBeDefined();
});
