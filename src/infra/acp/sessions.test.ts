import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  appendSessionTurn,
  loadSessionTurns,
  sessionExists,
  getAcpSessionsDir,
  ACP_SESSIONS_PATH_ENV,
} from "./sessions.ts";

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
