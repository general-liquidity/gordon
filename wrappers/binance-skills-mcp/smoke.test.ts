/**
 * End-to-end smoke test for the binance-skills MCP wrapper.
 * Spawns the wrapper as a real MCP server, sends a tools/list request
 * over stdio, asserts both tools are advertised. Hits no network.
 */

import { describe, it, expect } from "bun:test";
import { spawn } from "node:child_process";
import { join } from "node:path";

describe("binance-skills-mcp wrapper", () => {
  it("advertises list_binance_skills + load_binance_skill via tools/list", async () => {
    const entry = join(import.meta.dir, "index.ts");
    const child = spawn("bun", ["run", entry], {
      stdio: ["pipe", "pipe", "inherit"],
    });

    // MCP framing: each message is JSON-RPC 2.0, line-delimited.
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
        // We expect 2 line-delimited JSON-RPC responses; resolve once
        // we've seen the second.
        const lines = buf.split("\n").filter(Boolean);
        if (lines.length >= 2) resolve(buf);
      });
      // Hard timeout — if the server hangs, fail fast.
      setTimeout(() => resolve(buf), 4_000);
    });

    child.kill("SIGTERM");

    expect(output).toContain("list_binance_skills");
    expect(output).toContain("load_binance_skill");
  }, 10_000);
});
