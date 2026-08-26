import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  OFFLOAD_READ_MAX_CHARS,
  offloadRoots,
  readOffloadedResult,
  readOffloadedResultTool,
} from "./offloadedResult.ts";

const tmpRoot = path.join(os.tmpdir(), "gordon-tool-results");
mkdirSync(tmpRoot, { recursive: true });
const threadDir = mkdtempSync(path.join(tmpRoot, "test-"));
const spillPath = path.join(threadDir, "1700000000000-get_candles.json");
const payload = JSON.stringify({ candles: Array.from({ length: 500 }, (_, i) => ({ close: i })) });
writeFileSync(spillPath, payload, "utf-8");

const outsideDir = mkdtempSync(path.join(os.tmpdir(), "not-gordon-"));
const outsidePath = path.join(outsideDir, "secrets.txt");
writeFileSync(outsidePath, "sk-live-should-never-be-read", "utf-8");

afterAll(() => {
  rmSync(threadDir, { recursive: true, force: true });
  rmSync(outsideDir, { recursive: true, force: true });
});

describe("readOffloadedResult", () => {
  test("reads back a spilled tool result", () => {
    const res = readOffloadedResult({ path: spillPath });
    expect(res.ok).toBe(true);
    expect(res.totalChars).toBe(payload.length);
    expect(res.content).toBe(payload);
    expect(res.truncated).toBe(false);
  });

  test("pages through a payload larger than the window", () => {
    const first = readOffloadedResult({ path: spillPath, maxChars: 50 });
    expect(first.returnedChars).toBe(50);
    expect(first.truncated).toBe(true);
    const second = readOffloadedResult({ path: spillPath, startChar: 50, maxChars: 50 });
    expect(`${first.content}${second.content}`).toBe(payload.slice(0, 100));
  });

  test("refuses a path outside the offload directories", () => {
    const res = readOffloadedResult({ path: outsidePath });
    expect(res.ok).toBe(false);
    expect(res.content).toBeUndefined();
    expect(res.error).toContain("outside the tool-result offload directories");
  });

  test("refuses traversal out of an offload root", () => {
    const escape = path.join(threadDir, "..", "..", "..", "etc", "passwd");
    const res = readOffloadedResult({ path: escape });
    expect(res.ok).toBe(false);
    expect(res.content).toBeUndefined();
  });

  test("reports a missing spill instead of throwing", () => {
    const res = readOffloadedResult({ path: path.join(threadDir, "gone.json") });
    expect(res.ok).toBe(false);
    expect(res.error).toContain("No offloaded result");
  });

  test("clamps an oversized window to the hard ceiling", () => {
    const res = readOffloadedResult({ path: spillPath, maxChars: OFFLOAD_READ_MAX_CHARS * 10 });
    expect(res.ok).toBe(true);
    expect(res.returnedChars!).toBeLessThanOrEqual(OFFLOAD_READ_MAX_CHARS);
  });

  test("covers both offload roots", () => {
    const roots = offloadRoots();
    expect(roots.some((r) => r.endsWith(path.join("gordon-tool-results")))).toBe(true);
    expect(roots.some((r) => r.endsWith(path.join("tool-results")))).toBe(true);
  });
});

describe("read_offloaded_result tool", () => {
  test("is registered under the id the spill messages name", () => {
    expect(readOffloadedResultTool.id).toBe("read_offloaded_result");
  });
});
