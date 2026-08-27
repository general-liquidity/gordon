import { describe, expect, it } from "bun:test";

import { LocalMCPServerInstance } from "./server-instance.ts";
import type { MCPServerManifest } from "./types.ts";

function manifest(command: string, args: string[] = []): MCPServerManifest {
  return {
    id: "unsafe-test",
    name: "Unsafe test",
    version: "1.0.0",
    description: "A manifest used only to prove spawn-boundary validation.",
    author: "test",
    category: "utility",
    tools: [],
    authentication: { type: "none" },
    command,
    args,
  };
}

describe("LocalMCPServerInstance spawn boundary", () => {
  it("refuses a directly registered shell launcher before spawning it", async () => {
    const instance = new LocalMCPServerInstance(manifest("sh", ["-c", "echo unsafe"]));

    await expect(instance.start()).rejects.toThrow("Refusing unsafe MCP server command");
    expect(instance.status).toBe("stopped");
  });

  it("refuses Windows expansion and grouping metacharacters in argv", async () => {
    const instance = new LocalMCPServerInstance(manifest("npx", ["%COMSPEC%", "(unsafe)"]));

    await expect(instance.start()).rejects.toThrow("contains shell metacharacters");
    expect(instance.status).toBe("stopped");
  });
});
