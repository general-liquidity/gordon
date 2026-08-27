import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readTextFileViaAcp, writeTextFileViaAcp } from "./fs-bridge.ts";
import type { AgentSideConnection } from "@agentclientprotocol/sdk";

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "gordon-acp-fs-"));
});

afterEach(() => {
  try {
    rmSync(tempDir, { recursive: true, force: true });
  } catch {
    /* */
  }
});

interface FsCall {
  method: "read" | "write";
  path: string;
  content?: string;
}

function makeFakeConnection(readResponder?: (path: string) => string): {
  connection: AgentSideConnection;
  calls: FsCall[];
} {
  const calls: FsCall[] = [];
  const fake = {
    readTextFile: async ({ path }: { path: string }) => {
      calls.push({ method: "read", path });
      if (readResponder) return { content: readResponder(path) };
      return { content: "from-editor" };
    },
    writeTextFile: async ({ path, content }: { path: string; content: string }) => {
      calls.push({ method: "write", path, content });
      return {};
    },
  } as unknown as AgentSideConnection;
  return { connection: fake, calls };
}

// =================== Read path ===================

describe("readTextFileViaAcp", () => {
  it("falls back to local fs when no connection", async () => {
    const path = join(tempDir, "local.txt");
    writeFileSync(path, "local content", "utf-8");
    const content = await readTextFileViaAcp(path);
    expect(content).toBe("local content");
  });

  it("uses connection when capable + connection present", async () => {
    const { connection, calls } = makeFakeConnection((p) => `editor:${p}`);
    const content = await readTextFileViaAcp("/some/virtual/path", {
      connection,
      sessionId: "s1",
      clientReadCapable: true,
    });
    expect(content).toBe("editor:/some/virtual/path");
    expect(calls).toHaveLength(1);
    expect(calls[0]!.method).toBe("read");
  });

  it("falls back to local fs when client lacks capability", async () => {
    const path = join(tempDir, "fallback.txt");
    writeFileSync(path, "local fallback", "utf-8");
    const { connection, calls } = makeFakeConnection();
    const content = await readTextFileViaAcp(path, {
      connection,
      sessionId: "s1",
      clientReadCapable: false,
    });
    expect(content).toBe("local fallback");
    expect(calls).toHaveLength(0);
  });

  it("falls back when connection throws", async () => {
    const path = join(tempDir, "after-fail.txt");
    writeFileSync(path, "post-fail", "utf-8");
    const fake = {
      readTextFile: async () => {
        throw new Error("editor offline");
      },
    } as unknown as AgentSideConnection;
    const content = await readTextFileViaAcp(path, {
      connection: fake,
      sessionId: "s1",
      clientReadCapable: true,
    });
    expect(content).toBe("post-fail");
  });

  it("throws when local fallback also fails", async () => {
    await expect(readTextFileViaAcp(join(tempDir, "does-not-exist.txt"))).rejects.toThrow(
      /not found/,
    );
  });
});

// =================== Write path ===================

describe("writeTextFileViaAcp", () => {
  it("falls back to local fs when no connection", async () => {
    const path = join(tempDir, "out.txt");
    await writeTextFileViaAcp(path, "hello world");
    expect(existsSync(path)).toBe(true);
    expect(readFileSync(path, "utf-8")).toBe("hello world");
  });

  it("uses connection when capable + connection present", async () => {
    const { connection, calls } = makeFakeConnection();
    await writeTextFileViaAcp("/virtual/x.txt", "content", {
      connection,
      sessionId: "s1",
      clientWriteCapable: true,
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.method).toBe("write");
    expect(calls[0]!.content).toBe("content");
  });

  it("falls back to local fs when client lacks capability", async () => {
    const path = join(tempDir, "fallback-write.txt");
    const { connection, calls } = makeFakeConnection();
    await writeTextFileViaAcp(path, "via local", {
      connection,
      sessionId: "s1",
      clientWriteCapable: false,
    });
    expect(calls).toHaveLength(0);
    expect(readFileSync(path, "utf-8")).toBe("via local");
  });

  it("falls back when connection throws", async () => {
    const path = join(tempDir, "post-fail-write.txt");
    const fake = {
      writeTextFile: async () => {
        throw new Error("editor offline");
      },
    } as unknown as AgentSideConnection;
    await writeTextFileViaAcp(path, "fallback content", {
      connection: fake,
      sessionId: "s1",
      clientWriteCapable: true,
    });
    expect(readFileSync(path, "utf-8")).toBe("fallback content");
  });
});
