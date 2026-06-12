import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getSessionTip, pickTip, resetSessionTipForTesting, TIPS } from "./tips.ts";

let tempDir: string;
let previousHome: string | undefined;

describe("tips", () => {
  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "gordon-tips-"));
    previousHome = process.env.GORDON_HOME;
    process.env.GORDON_HOME = tempDir;
    resetSessionTipForTesting();
  });

  afterEach(() => {
    resetSessionTipForTesting();
    if (previousHome === undefined) {
      delete process.env.GORDON_HOME;
    } else {
      process.env.GORDON_HOME = previousHome;
    }
    rmSync(tempDir, { recursive: true, force: true });
  });

  test("pickTip returns the longest-unseen tip and persists history", () => {
    const historyPath = join(tempDir, "tipHistory.json");
    writeFileSync(historyPath, JSON.stringify({
      lastShown: { "0": 10, "1": 1, "2": 9 },
      sessionCount: 10,
    }));

    expect(pickTip(["alpha", "bravo", "charlie"])).toBe("bravo");
    const persisted = JSON.parse(readFileSync(historyPath, "utf-8")) as {
      lastShown: Record<string, number>;
      sessionCount: number;
    };
    expect(persisted.sessionCount).toBe(11);
    expect(persisted.lastShown["1"]).toBe(11);
  });

  test("corrupt history still returns a tip", () => {
    writeFileSync(join(tempDir, "tipHistory.json"), "{not-json");
    const tip = pickTip(["alpha", "bravo"]);
    expect(["alpha", "bravo"]).toContain(tip);
  });

  test("getSessionTip returns the same tip within a process", () => {
    const first = getSessionTip();
    const second = getSessionTip();
    expect(first).toBe(second);
    expect(TIPS).toContain(first);
    expect(existsSync(join(tempDir, "tipHistory.json"))).toBe(true);
  });
});
