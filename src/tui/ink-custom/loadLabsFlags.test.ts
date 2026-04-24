/**
 * Tests for loadLabsFlagsIntoEnv — verifies precedence rules:
 *   env var wins over persisted; persisted wins over unset.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { loadLabsFlagsIntoEnv, _resetLoadLabsFlagsLatch } from "./loadLabsFlags.ts";

const TEST_FLAGS = [
  "GORDON_TEST_FLAG_A",
  "GORDON_TEST_FLAG_B",
  "GORDON_TEST_FLAG_C",
];

let tmpHome: string;
let prevHome: string | undefined;

function clearTestEnv() {
  for (const name of TEST_FLAGS) delete process.env[name];
}

beforeEach(() => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "gordon-labs-test-"));
  prevHome = process.env.GORDON_HOME;
  process.env.GORDON_HOME = tmpHome;
  clearTestEnv();
  _resetLoadLabsFlagsLatch();
});

afterEach(() => {
  if (prevHome !== undefined) process.env.GORDON_HOME = prevHome;
  else delete process.env.GORDON_HOME;
  clearTestEnv();
  try { fs.rmSync(tmpHome, { recursive: true, force: true }); } catch {}
});

function writeLabsJson(flags: Record<string, "true" | "false">) {
  fs.writeFileSync(path.join(tmpHome, "labs.json"), JSON.stringify({ flags }));
}

describe("loadLabsFlagsIntoEnv", () => {
  test("returns empty list when no labs.json exists", () => {
    const applied = loadLabsFlagsIntoEnv();
    expect(applied).toEqual([]);
  });

  test("merges persisted true flags into process.env when unset", () => {
    writeLabsJson({ GORDON_TEST_FLAG_A: "true", GORDON_TEST_FLAG_B: "false" });
    const applied = loadLabsFlagsIntoEnv();
    expect(applied).toContain("GORDON_TEST_FLAG_A");
    expect(applied).not.toContain("GORDON_TEST_FLAG_B");
    expect(process.env.GORDON_TEST_FLAG_A).toBe("1");
    expect(process.env.GORDON_TEST_FLAG_B).toBeUndefined();
  });

  test("env var wins over persisted (does not overwrite)", () => {
    process.env.GORDON_TEST_FLAG_C = "0";
    writeLabsJson({ GORDON_TEST_FLAG_C: "true" });
    const applied = loadLabsFlagsIntoEnv();
    expect(applied).not.toContain("GORDON_TEST_FLAG_C");
    expect(process.env.GORDON_TEST_FLAG_C).toBe("0");
  });

  test("idempotent — second call is a no-op", () => {
    writeLabsJson({ GORDON_TEST_FLAG_A: "true" });
    const first = loadLabsFlagsIntoEnv();
    const second = loadLabsFlagsIntoEnv();
    expect(first).toContain("GORDON_TEST_FLAG_A");
    expect(second).toEqual([]);
  });

  test("malformed labs.json swallows error and returns empty", () => {
    fs.writeFileSync(path.join(tmpHome, "labs.json"), "{not valid json");
    const applied = loadLabsFlagsIntoEnv();
    expect(applied).toEqual([]);
  });

  test("missing flags object swallows and returns empty", () => {
    fs.writeFileSync(path.join(tmpHome, "labs.json"), JSON.stringify({ other: "data" }));
    const applied = loadLabsFlagsIntoEnv();
    expect(applied).toEqual([]);
  });
});
