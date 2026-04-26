import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  clearExtensionState,
  computeDrift,
  loadExtensionState,
  saveExtensionState,
  setExtensionStateDirForTesting,
} from "./extensionState.ts";

let testDir: string;

describe("extensionState save/load roundtrip", () => {
  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), "ext-state-"));
    setExtensionStateDirForTesting(testDir);
  });
  afterEach(() => {
    setExtensionStateDirForTesting(null);
    try { rmSync(testDir, { recursive: true, force: true }); } catch {/* ignore */}
  });

  it("returns null when no snapshot exists", () => {
    expect(loadExtensionState("fresh-session")).toBeNull();
  });

  it("persists and reloads enabled extension IDs", () => {
    saveExtensionState({
      sessionId: "s1",
      enabledExtensionIds: ["binance-cli", "skills"],
    });
    const loaded = loadExtensionState("s1");
    expect(loaded).not.toBeNull();
    expect(loaded?.enabledExtensionIds).toEqual(["binance-cli", "skills"]);
    expect(loaded?.version).toBe(1);
    expect(typeof loaded?.lastUpdatedAt).toBe("string");
  });

  it("sorts IDs deterministically on save (stable diffs across runs)", () => {
    saveExtensionState({
      sessionId: "s2",
      enabledExtensionIds: ["zebra", "apple", "mango"],
    });
    const loaded = loadExtensionState("s2");
    expect(loaded?.enabledExtensionIds).toEqual(["apple", "mango", "zebra"]);
  });

  it("survives a corrupt JSON file by returning null", () => {
    const file = join(testDir, "s3.extensions.json");
    writeFileSync(file, "{ this is not json", "utf-8");
    expect(loadExtensionState("s3")).toBeNull();
  });

  it("rejects schema-version mismatches by returning null", () => {
    const file = join(testDir, "s4.extensions.json");
    writeFileSync(
      file,
      JSON.stringify({ sessionId: "s4", enabledExtensionIds: ["a"], version: 99 }),
      "utf-8",
    );
    expect(loadExtensionState("s4")).toBeNull();
  });

  it("drops non-string entries defensively", () => {
    const file = join(testDir, "s5.extensions.json");
    writeFileSync(
      file,
      JSON.stringify({
        sessionId: "s5",
        enabledExtensionIds: ["valid", 42, null, "also-valid"],
        lastUpdatedAt: new Date().toISOString(),
        version: 1,
      }),
      "utf-8",
    );
    const loaded = loadExtensionState("s5");
    expect(loaded?.enabledExtensionIds).toEqual(["valid", "also-valid"]);
  });

  it("clearExtensionState removes the file", () => {
    saveExtensionState({ sessionId: "s6", enabledExtensionIds: ["x"] });
    expect(loadExtensionState("s6")).not.toBeNull();
    expect(clearExtensionState("s6")).toBe(true);
    expect(loadExtensionState("s6")).toBeNull();
  });

  it("clearExtensionState returns false when there's nothing to clear", () => {
    expect(clearExtensionState("nonexistent")).toBe(false);
  });
});

describe("computeDrift", () => {
  it("reports zero drift when current matches snapshot", () => {
    const saved = {
      sessionId: "s",
      enabledExtensionIds: ["a", "b"],
      lastUpdatedAt: "2026-01-01T00:00:00Z",
      version: 1 as const,
    };
    const drift = computeDrift(saved, ["a", "b"]);
    expect(drift.totalDrift).toBe(0);
    expect(drift.missingFromCurrent).toEqual([]);
    expect(drift.newSinceSnapshot).toEqual([]);
  });

  it("flags extensions in snapshot but missing from current", () => {
    const saved = {
      sessionId: "s",
      enabledExtensionIds: ["a", "b", "c"],
      lastUpdatedAt: "2026-01-01T00:00:00Z",
      version: 1 as const,
    };
    const drift = computeDrift(saved, ["a"]);
    expect(drift.missingFromCurrent.sort()).toEqual(["b", "c"]);
    expect(drift.newSinceSnapshot).toEqual([]);
    expect(drift.totalDrift).toBe(2);
  });

  it("flags extensions added since the snapshot", () => {
    const saved = {
      sessionId: "s",
      enabledExtensionIds: ["a"],
      lastUpdatedAt: "2026-01-01T00:00:00Z",
      version: 1 as const,
    };
    const drift = computeDrift(saved, ["a", "b", "c"]);
    expect(drift.newSinceSnapshot.sort()).toEqual(["b", "c"]);
    expect(drift.missingFromCurrent).toEqual([]);
    expect(drift.totalDrift).toBe(2);
  });

  it("treats null saved state as zero baseline", () => {
    const drift = computeDrift(null, ["a", "b"]);
    expect(drift.missingFromCurrent).toEqual([]);
    expect(drift.newSinceSnapshot.sort()).toEqual(["a", "b"]);
    expect(drift.totalDrift).toBe(2);
  });
});
