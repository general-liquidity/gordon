import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  appendSessionTurn,
  loadSessionTurns,
  sessionExists,
  sanitizeSessionId,
  getAcpSessionsDir,
  ACP_SESSIONS_PATH_ENV,
} from "./sessions.ts";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

let tempDir: string;
let originalEnv: string | undefined;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "gordon-acp-sessions-"));
  originalEnv = process.env[ACP_SESSIONS_PATH_ENV];
  process.env[ACP_SESSIONS_PATH_ENV] = tempDir;
});

afterEach(() => {
  if (originalEnv === undefined) delete process.env[ACP_SESSIONS_PATH_ENV];
  else process.env[ACP_SESSIONS_PATH_ENV] = originalEnv;
  try { rmSync(tempDir, { recursive: true, force: true }); } catch { /* */ }
});

describe("getAcpSessionsDir", () => {
  it("returns the env override when set", () => {
    expect(getAcpSessionsDir()).toBe(tempDir);
  });

  it("falls back to ~/.gordon/acp-sessions when env is unset", () => {
    delete process.env[ACP_SESSIONS_PATH_ENV];
    expect(getAcpSessionsDir()).toContain(".gordon");
    expect(getAcpSessionsDir()).toContain("acp-sessions");
  });
});

describe("appendSessionTurn + loadSessionTurns", () => {
  it("round-trips a single turn", () => {
    appendSessionTurn("s1", { role: "user", content: "hello", ts: 1 });
    const turns = loadSessionTurns("s1");
    expect(turns).toHaveLength(1);
    expect(turns[0]!.role).toBe("user");
    expect(turns[0]!.content).toBe("hello");
  });

  it("appends multiple turns in order", () => {
    appendSessionTurn("s2", { role: "user", content: "q1", ts: 1 });
    appendSessionTurn("s2", { role: "assistant", content: "a1", ts: 2 });
    appendSessionTurn("s2", { role: "user", content: "q2", ts: 3 });
    appendSessionTurn("s2", { role: "assistant", content: "a2", ts: 4 });
    const turns = loadSessionTurns("s2");
    expect(turns).toHaveLength(4);
    expect(turns.map((t) => t.content)).toEqual(["q1", "a1", "q2", "a2"]);
  });

  it("returns empty array for nonexistent session", () => {
    expect(loadSessionTurns("nonexistent")).toEqual([]);
  });

  it("skips malformed JSONL lines silently", () => {
    // Append a valid turn, then write garbage, then another valid turn
    appendSessionTurn("s3", { role: "user", content: "valid", ts: 1 });
    const { appendFileSync } = require("node:fs");
    appendFileSync(join(tempDir, "s3.jsonl"), "not json\n");
    appendSessionTurn("s3", { role: "assistant", content: "also valid", ts: 2 });
    const turns = loadSessionTurns("s3");
    expect(turns).toHaveLength(2);
    expect(turns.map((t) => t.content)).toEqual(["valid", "also valid"]);
  });

  it("rejects lines with invalid role/content shape", () => {
    const { appendFileSync } = require("node:fs");
    appendFileSync(
      join(tempDir, "s4.jsonl"),
      JSON.stringify({ role: "system", content: "x", ts: 1 }) + "\n",
    );
    appendFileSync(
      join(tempDir, "s4.jsonl"),
      JSON.stringify({ role: "user", content: 42, ts: 2 }) + "\n",
    );
    appendFileSync(
      join(tempDir, "s4.jsonl"),
      JSON.stringify({ role: "user", content: "valid", ts: 3 }) + "\n",
    );
    const turns = loadSessionTurns("s4");
    expect(turns).toHaveLength(1);
    expect(turns[0]!.content).toBe("valid");
  });
});

describe("sessionExists", () => {
  it("returns false before any turns are appended", () => {
    expect(sessionExists("fresh")).toBe(false);
  });

  it("returns true after the first append", () => {
    appendSessionTurn("populated", { role: "user", content: "x", ts: 1 });
    expect(sessionExists("populated")).toBe(true);
  });
});

describe("sessionId path-traversal hardening", () => {
  const TRAVERSAL = "../../../../etc/passwd";

  it("sanitizeSessionId accepts safe ids and rejects traversal", () => {
    expect(sanitizeSessionId("abc-123_DEF")).toBe("abc-123_DEF");
    expect(() => sanitizeSessionId(TRAVERSAL)).toThrow();
    expect(() => sanitizeSessionId("a/b")).toThrow();
    expect(() => sanitizeSessionId("..")).toThrow();
    expect(() => sanitizeSessionId("")).toThrow();
  });

  it("loadSessionTurns rejects a traversal id (does not read outside the dir)", () => {
    expect(() => loadSessionTurns(TRAVERSAL)).toThrow();
  });

  it("appendSessionTurn does not write outside the sessions dir for a traversal id", () => {
    // appendSessionTurn is best-effort (swallows errors), so it must not
    // throw — but it also must not create a file outside tempDir.
    appendSessionTurn(TRAVERSAL, { role: "user", content: "pwn", ts: 1 });
    const escaped = resolve(tempDir, "..", "..", "..", "..", "etc", "passwd.jsonl");
    expect(existsSync(escaped)).toBe(false);
  });

  it("sessionExists rejects a traversal id", () => {
    expect(() => sessionExists(TRAVERSAL)).toThrow();
  });

  it("a normal id still round-trips", () => {
    appendSessionTurn("normal-id_1", { role: "user", content: "hi", ts: 1 });
    const turns = loadSessionTurns("normal-id_1");
    expect(turns).toHaveLength(1);
    expect(turns[0]!.content).toBe("hi");
  });
});
