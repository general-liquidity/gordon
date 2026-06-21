import { describe, expect, it } from "bun:test";
import type { McpServer } from "@agentclientprotocol/sdk";
import { acpServerToMastraDefinition, isSafeForwardedUrl } from "./mcp-spinup.ts";

describe("acpServerToMastraDefinition — command-exec guard", () => {
  it("skips a forwarded stdio server with a shell command + metacharacters", () => {
    const server = { command: "sh", args: ["-c", "x"] } as unknown as McpServer;
    expect(acpServerToMastraDefinition(server)).toBeNull();
  });

  it("returns a def for a benign npx-launched stdio server", () => {
    const server = {
      name: "benign",
      command: "npx",
      args: ["-y", "srv"],
    } as unknown as McpServer;
    const result = acpServerToMastraDefinition(server);
    expect(result).not.toBeNull();
    expect(result?.name).toBe("benign");
    expect((result?.def as { command?: string }).command).toBe("npx");
  });
});

describe("acpServerToMastraDefinition — SSRF guard", () => {
  it("skips a forwarded http server pointing at the cloud metadata endpoint", () => {
    const server = {
      type: "http",
      url: "http://169.254.169.254/",
    } as unknown as McpServer;
    expect(acpServerToMastraDefinition(server)).toBeNull();
  });

  it("skips a forwarded http server pointing at localhost", () => {
    const server = {
      type: "http",
      url: "http://localhost/mcp",
    } as unknown as McpServer;
    expect(acpServerToMastraDefinition(server)).toBeNull();
  });

  it("returns a def for a normal remote https MCP server", () => {
    const server = {
      type: "http",
      name: "remote",
      url: "https://api.example.com/mcp",
    } as unknown as McpServer;
    const result = acpServerToMastraDefinition(server);
    expect(result).not.toBeNull();
    expect((result?.def as { url?: URL }).url?.href).toBe("https://api.example.com/mcp");
  });
});

describe("isSafeForwardedUrl", () => {
  it("rejects non-http(s) schemes", () => {
    expect(isSafeForwardedUrl("file:///etc/passwd")).toBe(false);
    expect(isSafeForwardedUrl("ftp://example.com/")).toBe(false);
    expect(isSafeForwardedUrl("not a url")).toBe(false);
  });

  it("rejects loopback / private / link-local / metadata hosts", () => {
    expect(isSafeForwardedUrl("http://localhost/")).toBe(false);
    expect(isSafeForwardedUrl("http://127.0.0.1/")).toBe(false);
    expect(isSafeForwardedUrl("http://127.1.2.3/")).toBe(false);
    expect(isSafeForwardedUrl("http://[::1]/")).toBe(false);
    expect(isSafeForwardedUrl("http://0.0.0.0/")).toBe(false);
    expect(isSafeForwardedUrl("http://10.0.0.5/")).toBe(false);
    expect(isSafeForwardedUrl("http://172.16.0.1/")).toBe(false);
    expect(isSafeForwardedUrl("http://172.31.255.255/")).toBe(false);
    expect(isSafeForwardedUrl("http://192.168.1.1/")).toBe(false);
    expect(isSafeForwardedUrl("http://169.254.169.254/")).toBe(false);
    expect(isSafeForwardedUrl("http://foo.internal/")).toBe(false);
    expect(isSafeForwardedUrl("http://foo.local/")).toBe(false);
  });

  it("allows public hosts over http(s)", () => {
    expect(isSafeForwardedUrl("https://api.example.com/mcp")).toBe(true);
    expect(isSafeForwardedUrl("http://example.com/")).toBe(true);
    expect(isSafeForwardedUrl("http://172.32.0.1/")).toBe(true); // just outside 172.16/12
  });
});
