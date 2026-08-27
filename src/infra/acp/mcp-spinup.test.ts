import { afterEach, describe, expect, it } from "bun:test";
import type { McpServer } from "@agentclientprotocol/sdk";
import {
  ACP_FORWARDED_STDIO_MCP_FLAG_ENV,
  acpServerToMastraDefinition,
  createPublicOnlyLookup,
  createAcpMcpClient,
  instrumentAcpMcpToolsets,
  isPublicNetworkAddress,
  isSafeForwardedUrl,
} from "./mcp-spinup.ts";
import { clearHooks, registerHook } from "../hooks/engine.ts";

afterEach(() => clearHooks());

describe("acpServerToMastraDefinition — command-exec guard", () => {
  it("skips a forwarded stdio server with a shell command + metacharacters", () => {
    const server = { command: "sh", args: ["-c", "x"] } as unknown as McpServer;
    expect(acpServerToMastraDefinition(server)).toBeNull();
  });

  it("rejects stdio forwarding by default even for an allowlisted launcher", () => {
    const server = {
      name: "benign",
      command: "npx",
      args: ["-y", "srv"],
    } as unknown as McpServer;
    expect(acpServerToMastraDefinition(server, {})).toBeNull();
  });

  it("accepts an allowlisted launcher only after explicit operator opt-in", () => {
    const server = {
      name: "benign",
      command: "npx",
      args: ["-y", "srv"],
    } as unknown as McpServer;
    const result = acpServerToMastraDefinition(server, {
      [ACP_FORWARDED_STDIO_MCP_FLAG_ENV]: "1",
    });
    expect(result).not.toBeNull();
    expect(result!.name).toBe("benign");
    expect((result!.def as { command?: string }).command).toBe("npx");
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
    expect((result!.def as { url?: URL }).url?.href).toBe("https://api.example.com/mcp");
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
    expect(isSafeForwardedUrl("http://2130706433/")).toBe(false);
    expect(isSafeForwardedUrl("http://[::ffff:127.0.0.1]/")).toBe(false);
    expect(isSafeForwardedUrl("http://[fc00::1]/")).toBe(false);
    expect(isSafeForwardedUrl("http://[fe80::1]/")).toBe(false);
    expect(isSafeForwardedUrl("http://192.0.2.1/")).toBe(false);
    expect(isSafeForwardedUrl("http://198.51.100.1/")).toBe(false);
    expect(isSafeForwardedUrl("http://203.0.113.1/")).toBe(false);
    expect(isSafeForwardedUrl("http://[2001:db8::1]/")).toBe(false);
  });

  it("allows public hosts over http(s)", () => {
    expect(isSafeForwardedUrl("https://api.example.com/mcp")).toBe(true);
    expect(isSafeForwardedUrl("http://example.com/")).toBe(true);
    expect(isSafeForwardedUrl("http://172.32.0.1/")).toBe(true); // just outside 172.16/12
    expect(isSafeForwardedUrl("https://[2001:4860:4860::8888]/mcp")).toBe(true);
  });

  it("the connector lookup rejects a hostname with any private DNS answer", async () => {
    const resolver = ((
      _hostname: string,
      _options: unknown,
      callback: (
        error: NodeJS.ErrnoException | null,
        addresses: Array<{ address: string; family: number }>,
      ) => void,
    ) => {
      callback(null, [
        { address: "93.184.216.34", family: 4 },
        { address: "127.0.0.1", family: 4 },
      ]);
    }) as unknown as typeof import("node:dns")["lookup"];
    const lookup = createPublicOnlyLookup(resolver);
    const error = await new Promise<NodeJS.ErrnoException | null>((resolve) => {
      lookup("rebinding.example", { all: false }, (err) => resolve(err));
    });
    expect(error?.code).toBe("EACCES");
  });

  it("the connector lookup accepts only globally routable answers", async () => {
    expect(isPublicNetworkAddress("93.184.216.34")).toBe(true);
    expect(isPublicNetworkAddress("2001:4860:4860::8888")).toBe(true);
    const resolver = ((
      _hostname: string,
      _options: unknown,
      callback: (
        error: NodeJS.ErrnoException | null,
        addresses: Array<{ address: string; family: number }>,
      ) => void,
    ) => {
      callback(null, [{ address: "93.184.216.34", family: 4 }]);
    }) as unknown as typeof import("node:dns")["lookup"];
    const lookup = createPublicOnlyLookup(resolver);
    const result = await new Promise<{ error: NodeJS.ErrnoException | null; address?: string }>(
      (resolve) => {
        lookup("public.example", { all: false }, (error, address) => {
          resolve({ error, address: typeof address === "string" ? address : undefined });
        });
      },
    );
    expect(result).toEqual({ error: null, address: "93.184.216.34" });
  });
});

describe("createAcpMcpClient", () => {
  it("rejects duplicate forwarded server names instead of silently replacing one", async () => {
    const servers = [
      { type: "http", name: "same", url: "https://one.example/mcp" },
      { type: "http", name: "same", url: "https://two.example/mcp" },
    ] as unknown as McpServer[];
    await expect(createAcpMcpClient("duplicate-test", servers)).rejects.toThrow(
      /Duplicate ACP-forwarded MCP server name/,
    );
  });

  it("gives unnamed forwarded servers a deterministic identity", () => {
    const server = {
      type: "http",
      url: "https://api.example.com/mcp",
    } as unknown as McpServer;
    expect(acpServerToMastraDefinition(server)?.name).toBe(
      acpServerToMastraDefinition(server)?.name,
    );
  });
});

describe("instrumentAcpMcpToolsets", () => {
  it("routes forwarded tool execution through Gordon's lifecycle wrapper", async () => {
    const observed: string[] = [];
    registerHook({
      id: "observe-forwarded-tool",
      point: "PreToolUse",
      handler: ({ toolName }) => {
        observed.push(`pre:${toolName}`);
        return { action: "allow" };
      },
    });
    registerHook({
      id: "observe-forwarded-result",
      point: "PostToolUse",
      handler: ({ toolName, success }) => {
        observed.push(`post:${toolName}:${success}`);
        return { action: "allow" };
      },
    });
    const toolsets = instrumentAcpMcpToolsets({
      editor: {
        quote: {
          id: "quote",
          inputSchema: {},
          execute: async () => ({ price: 42 }),
        },
      },
    });
    const tool = toolsets.editor?.quote as { execute?: (...args: unknown[]) => Promise<unknown> };
    expect(await tool.execute?.({})).toEqual({ price: 42 });
    expect(observed).toEqual(["pre:quote", "post:quote:true"]);
  });
});
