import { describe, it, expect, beforeEach } from "bun:test";
import { existsSync, mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  isDecisionsLogEnabled,
  recordDecision,
  readDecisions,
  summarizeDecisionsForResume,
  defaultDecisionsLogPath,
} from "./decisionLog.ts";

let tempDir: string;
let logPath: string;
const enabledEnv = (path: string): NodeJS.ProcessEnv =>
  ({ GORDON_DECISIONS_LOG: "1", GORDON_DECISIONS_LOG_PATH: path }) as NodeJS.ProcessEnv;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "gordon-decisions-test-"));
  logPath = join(tempDir, "decisions.jsonl");
});

describe("isDecisionsLogEnabled", () => {
  it("respects the flag", () => {
    expect(isDecisionsLogEnabled({})).toBe(false);
    expect(isDecisionsLogEnabled({ GORDON_DECISIONS_LOG: "1" })).toBe(true);
    expect(isDecisionsLogEnabled({ GORDON_DECISIONS_LOG: "true" })).toBe(true);
  });
});

describe("defaultDecisionsLogPath", () => {
  it("honors GORDON_DECISIONS_LOG_PATH override", () => {
    expect(defaultDecisionsLogPath({ GORDON_DECISIONS_LOG_PATH: "/custom/path" } as NodeJS.ProcessEnv))
      .toBe("/custom/path");
  });
});

describe("recordDecision", () => {
  it("returns null when disabled", () => {
    const res = recordDecision({
      category: "plan",
      context: "test",
      selected: "A",
      rationale: "because",
    }, {});
    expect(res).toBeNull();
    expect(existsSync(logPath)).toBe(false);
  });

  it("appends a JSONL line when enabled", () => {
    const env = enabledEnv(logPath);
    const entry = recordDecision({
      category: "plan",
      context: "choose strategy",
      selected: "regime-rsi",
      alternatives: ["smc", "bounce"],
      rationale: "current regime favors RSI mean reversion",
      threadId: "t1",
      symbols: ["BTCUSDT"],
    }, env, logPath);
    expect(entry).not.toBeNull();
    expect(entry?.id).toMatch(/^dec-/);
    const content = readFileSync(logPath, "utf8");
    expect(content.split("\n").filter(Boolean)).toHaveLength(1);
    const parsed = JSON.parse(content.split("\n")[0]!);
    expect(parsed.category).toBe("plan");
    expect(parsed.selected).toBe("regime-rsi");
    expect(parsed.alternatives).toEqual(["smc", "bounce"]);
  });

  it("creates the parent directory if missing", () => {
    const env = enabledEnv(logPath);
    const deepPath = join(tempDir, "a", "b", "decisions.jsonl");
    recordDecision({
      category: "plan",
      context: "test",
      selected: "X",
      rationale: "r",
    }, env, deepPath);
    expect(existsSync(deepPath)).toBe(true);
  });
});

describe("readDecisions", () => {
  function seed(decisions: Array<Partial<Parameters<typeof recordDecision>[0]> & {
    category?: Parameters<typeof recordDecision>[0]["category"];
    selected?: string;
    rationale?: string;
    context?: string;
  }>): void {
    const env = enabledEnv(logPath);
    for (const d of decisions) {
      recordDecision({
        category: d.category ?? "plan",
        context: d.context ?? "ctx",
        selected: d.selected ?? "sel",
        rationale: d.rationale ?? "r",
        ...d,
      } as Parameters<typeof recordDecision>[0], env, logPath);
    }
  }

  it("returns empty when log doesn't exist", () => {
    expect(readDecisions({}, {}, logPath)).toEqual([]);
  });

  it("returns most-recent-first", async () => {
    seed([{ context: "first", selected: "A" }]);
    // Force a >1ms delta so the recordedAt timestamps differ
    await new Promise((resolve) => setTimeout(resolve, 5));
    seed([{ context: "second", selected: "B" }]);
    const decisions = readDecisions({}, {}, logPath);
    expect(decisions).toHaveLength(2);
    expect(decisions[0]?.context).toBe("second");
    expect(decisions[1]?.context).toBe("first");
  });

  it("filters by threadId", () => {
    seed([
      { threadId: "t1", selected: "A" },
      { threadId: "t2", selected: "B" },
    ]);
    const decisions = readDecisions({ threadId: "t1" }, {}, logPath);
    expect(decisions).toHaveLength(1);
    expect(decisions[0]?.selected).toBe("A");
  });

  it("filters by symbol", () => {
    seed([
      { symbols: ["BTCUSDT"], selected: "btc-trade" },
      { symbols: ["ETHUSDT"], selected: "eth-trade" },
      { symbols: ["BTCUSDT", "ETHUSDT"], selected: "both" },
    ]);
    const decisions = readDecisions({ symbol: "BTCUSDT" }, {}, logPath);
    expect(decisions.map((d) => d.selected).sort()).toEqual(["both", "btc-trade"]);
  });

  it("filters by category", () => {
    seed([
      { category: "plan", selected: "A" },
      { category: "venue", selected: "B" },
      { category: "risk-override", selected: "C" },
    ]);
    const decisions = readDecisions({ categories: ["plan", "venue"] }, {}, logPath);
    expect(decisions.map((d) => d.selected).sort()).toEqual(["A", "B"]);
  });

  it("respects limit", () => {
    seed([
      { selected: "A" },
      { selected: "B" },
      { selected: "C" },
    ]);
    expect(readDecisions({ limit: 2 }, {}, logPath)).toHaveLength(2);
  });

  it("skips malformed lines without throwing", () => {
    seed([{ selected: "good" }]);
    // Corrupt the file by appending garbage
    const { appendFileSync } = require("node:fs");
    appendFileSync(logPath, "not-json{\n");
    appendFileSync(logPath, "{ \"id\": \"\", \"truncated\":\n");
    const decisions = readDecisions({}, {}, logPath);
    expect(decisions).toHaveLength(1);
    expect(decisions[0]?.selected).toBe("good");
  });
});

describe("summarizeDecisionsForResume", () => {
  it("returns empty string when no decisions", () => {
    expect(summarizeDecisionsForResume([])).toBe("");
  });

  it("formats one line per decision with symbol prefix", () => {
    const out = summarizeDecisionsForResume([
      {
        id: "1", recordedAt: "2026-01-15T10:00:00.000Z",
        category: "plan", context: "ctx", selected: "X",
        alternatives: ["Y"], rationale: "good reason",
        symbols: ["BTCUSDT"],
      },
    ]);
    expect(out).toContain("[BTCUSDT]");
    expect(out).toContain("chose X");
    expect(out).toContain("good reason");
  });

  it("truncates at maxLines", () => {
    const decisions = Array.from({ length: 20 }, (_, i) => ({
      id: `${i}`, recordedAt: `2026-01-${(i + 1).toString().padStart(2, "0")}T00:00:00.000Z`,
      category: "plan" as const, context: "", selected: `s${i}`, alternatives: [], rationale: "r",
    }));
    const lines = summarizeDecisionsForResume(decisions, 5).split("\n");
    expect(lines).toHaveLength(5);
  });
});
