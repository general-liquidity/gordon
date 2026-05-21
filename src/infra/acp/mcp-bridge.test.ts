import { describe, it, expect } from "bun:test";
import {
  captureSessionMcpServers,
  getSessionMcpServers,
  dropSessionMcpServers,
  summarizeSessionMcpServers,
} from "./mcp-bridge.ts";
import type { McpServer } from "@agentclientprotocol/sdk";

describe("mcp-bridge — capture + lookup", () => {
  it("stores forwarded MCP servers for a session", () => {
    const servers: McpServer[] = [
      { type: "http", name: "ctx7", url: "https://ctx7.example.com/mcp", headers: [] },
      { type: "sse", name: "events", url: "https://events.example.com/sse", headers: [] },
    ] as unknown as McpServer[];
    captureSessionMcpServers("s1", servers);
    expect(getSessionMcpServers("s1")).toEqual(servers);
  });

  it("returns empty array when nothing forwarded", () => {
    expect(getSessionMcpServers("never-captured")).toEqual([]);
  });

  it("captures null/undefined as no-op (drops existing)", () => {
    const servers: McpServer[] = [
      { type: "http", name: "x", url: "https://x.test/mcp", headers: [] },
    ] as unknown as McpServer[];
    captureSessionMcpServers("s2", servers);
    expect(getSessionMcpServers("s2")).toHaveLength(1);
    captureSessionMcpServers("s2", undefined);
    expect(getSessionMcpServers("s2")).toEqual([]);
  });

  it("dropSessionMcpServers removes stored state", () => {
    const servers: McpServer[] = [
      { type: "http", name: "x", url: "https://x.test/mcp", headers: [] },
    ] as unknown as McpServer[];
    captureSessionMcpServers("s3", servers);
    dropSessionMcpServers("s3");
    expect(getSessionMcpServers("s3")).toEqual([]);
  });

  it("isolates state per sessionId", () => {
    captureSessionMcpServers("a", [
      { type: "http", name: "alpha", url: "https://a.test/mcp", headers: [] },
    ] as unknown as McpServer[]);
    captureSessionMcpServers("b", [
      { type: "http", name: "beta", url: "https://b.test/mcp", headers: [] },
    ] as unknown as McpServer[]);
    expect(getSessionMcpServers("a")[0]?.name).toBe("alpha");
    expect(getSessionMcpServers("b")[0]?.name).toBe("beta");
  });
});

describe("mcp-bridge — summary", () => {
  it("returns (none) when no servers captured", () => {
    expect(summarizeSessionMcpServers("fresh-id")).toBe("(none)");
  });

  it("summarizes http servers with host only (no path/query leakage)", () => {
    captureSessionMcpServers("s4", [
      { type: "http", name: "github", url: "https://api.github.com/mcp?token=secret", headers: [] },
    ] as unknown as McpServer[]);
    const summary = summarizeSessionMcpServers("s4");
    expect(summary).toContain("github@http:api.github.com");
    expect(summary).not.toContain("secret");
    expect(summary).not.toContain("token=");
  });

  it("summarizes stdio servers as @stdio:<command>", () => {
    captureSessionMcpServers("s5", [
      { name: "local-mcp", command: "node", args: ["mcp.js"], env: [] },
    ] as unknown as McpServer[]);
    const summary = summarizeSessionMcpServers("s5");
    expect(summary).toContain("local-mcp@stdio:node");
  });

  it("handles multiple servers separated by commas", () => {
    captureSessionMcpServers("s6", [
      { type: "http", name: "a", url: "https://a.test/mcp", headers: [] },
      { type: "http", name: "b", url: "https://b.test/mcp", headers: [] },
    ] as unknown as McpServer[]);
    const summary = summarizeSessionMcpServers("s6");
    expect(summary).toContain(", ");
    expect(summary.split(", ")).toHaveLength(2);
  });
});
