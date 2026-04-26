/**
 * End-to-end smoke test for the binance-cli MCP wrapper. Spawns the
 * wrapper as a real MCP server, asserts the binance_cli tool is
 * advertised. No actual binance-cli invocation — that requires the
 * binary to be installed.
 */

import { describe, it, expect } from "bun:test";
import { spawn } from "node:child_process";
import { join } from "node:path";

describe("binance-cli-mcp wrapper", () => {
  it("advertises binance_cli via tools/list", async () => {
    const entry = join(import.meta.dir, "index.ts");
    const child = spawn("bun", ["run", entry], {
      stdio: ["pipe", "pipe", "inherit"],
    });

    const init = {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "smoke-test", version: "0" },
      },
    };
    const list = { jsonrpc: "2.0", id: 2, method: "tools/list" };

    child.stdin.write(JSON.stringify(init) + "\n");
    child.stdin.write(JSON.stringify(list) + "\n");

    const output = await new Promise<string>((resolve) => {
      let buf = "";
      child.stdout.on("data", (chunk: Buffer) => {
        buf += chunk.toString("utf8");
        const lines = buf.split("\n").filter(Boolean);
        if (lines.length >= 2) resolve(buf);
      });
      setTimeout(() => resolve(buf), 4_000);
    });

    child.kill("SIGTERM");

    expect(output).toContain("binance_cli");
    // Description should mention the safety gate.
    expect(output).toContain("GORDON_BINANCE_CLI_WRITE");
  }, 10_000);
});
