import { describe, it, expect, beforeEach } from "bun:test";
import { mkdtempSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  defaultTradingFeatureListPath,
  makeEntry,
  createFeatureList,
  loadFeatureList,
  saveFeatureList,
  pickHighestPriority,
  summarize,
  markPass,
  markFail,
  applyEdit,
  formatFeatureList,
  featureListToPayload,
  MUTABLE_FEATURE_FIELDS,
  TRADING_FEATURE_LIST_PATH_ENV,
  type FeatureEntry,
  type FeatureList,
} from "./tradingFeatureList.ts";

let tempDir: string;
let listPath: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "gordon-trading-feature-list-test-"));
  listPath = join(tempDir, "feature-list.json");
});

function entryA(): FeatureEntry {
  return makeEntry({
    id: "venue-binance-connect",
    category: "venue",
    description: "Agent connects to Binance and fetches OHLCV",
    steps: ["call get_candles", "verify rows > 0"],
    priority: 0,
  });
}

function entryB(): FeatureEntry {
  return makeEntry({
    id: "risk-mandate-block",
    category: "risk",
    description: "Mandate breach blocks order placement",
    steps: ["place mandate", "submit out-of-scope order", "expect block"],
    priority: 1,
  });
}

function freshList(): FeatureList {
  return createFeatureList([entryB(), entryA()], "2026-05-13T00:00:00.000Z");
}

describe("defaultTradingFeatureListPath", () => {
  it("honors env override", () => {
    expect(defaultTradingFeatureListPath({ [TRADING_FEATURE_LIST_PATH_ENV]: "/x.json" })).toBe(
      "/x.json",
    );
  });
  it("falls back to home-dir default", () => {
    expect(defaultTradingFeatureListPath({})).toContain("feature-list.json");
  });
});

describe("makeEntry", () => {
  it("starts with passes=false and null timestamps", () => {
    const e = entryA();
    expect(e.passes).toBe(false);
    expect(e.paperModeVerifiedAt).toBeNull();
    expect(e.failedAt).toBeNull();
    expect(e.failedReason).toBeNull();
  });
});

describe("createFeatureList", () => {
  it("sorts entries by priority ascending", () => {
    const list = freshList();
    expect(list.entries.map((e) => e.id)).toEqual(["venue-binance-connect", "risk-mandate-block"]);
  });

  it("uses injected timestamp", () => {
    const list = freshList();
    expect(list.createdAt).toBe("2026-05-13T00:00:00.000Z");
  });
});

describe("loadFeatureList / saveFeatureList", () => {
  it("round-trips through disk", () => {
    const a = freshList();
    saveFeatureList(a, listPath);
    expect(existsSync(listPath)).toBe(true);
    const b = loadFeatureList(listPath);
    expect(b?.entries.length).toBe(2);
    expect(b?.entries[0]?.id).toBe("venue-binance-connect");
  });

  it("returns null for missing file", () => {
    expect(loadFeatureList(join(tempDir, "no.json"))).toBeNull();
  });

  it("returns null for invalid JSON", () => {
    writeFileSync(listPath, "not-json{", "utf8");
    expect(loadFeatureList(listPath)).toBeNull();
  });

  it("returns null for malformed schema", () => {
    writeFileSync(listPath, JSON.stringify({ entries: "not-an-array" }), "utf8");
    expect(loadFeatureList(listPath)).toBeNull();
  });
});

describe("pickHighestPriority", () => {
  it("returns the lowest-priority-number not-passing entry", () => {
    const list = freshList();
    const next = pickHighestPriority(list);
    expect(next?.id).toBe("venue-binance-connect");
  });

  it("skips passing entries", () => {
    const passed = markPass(freshList(), "venue-binance-connect")!;
    expect(pickHighestPriority(passed)?.id).toBe("risk-mandate-block");
  });

  it("returns null when all pass", () => {
    let list = freshList();
    list = markPass(list, "venue-binance-connect")!;
    list = markPass(list, "risk-mandate-block")!;
    expect(pickHighestPriority(list)).toBeNull();
  });
});

describe("summarize", () => {
  it("counts passing/total globally and per-category", () => {
    const list = markPass(freshList(), "venue-binance-connect")!;
    const s = summarize(list);
    expect(s.passingCount).toBe(1);
    expect(s.totalCount).toBe(2);
    expect(s.byCategory.venue.passing).toBe(1);
    expect(s.byCategory.risk.passing).toBe(0);
  });

  it("includes nextPriority", () => {
    const s = summarize(freshList());
    expect(s.nextPriority?.id).toBe("venue-binance-connect");
  });

  it("nextPriority is null when all pass", () => {
    let list = freshList();
    list = markPass(list, "venue-binance-connect")!;
    list = markPass(list, "risk-mandate-block")!;
    expect(summarize(list).nextPriority).toBeNull();
  });
});

describe("markPass / markFail", () => {
  it("does not mutate the input list", () => {
    const a = freshList();
    const beforeSnapshot = JSON.stringify(a);
    markPass(a, "venue-binance-connect");
    expect(JSON.stringify(a)).toBe(beforeSnapshot);
  });

  it("markPass sets passes=true and timestamp; clears failedAt/failedReason", () => {
    const failed = markFail(freshList(), "venue-binance-connect", "broker timeout")!;
    expect(failed.entries.find((e) => e.id === "venue-binance-connect")!.failedReason).toBe(
      "broker timeout",
    );
    const passed = markPass(failed, "venue-binance-connect", "2026-05-13T10:00:00.000Z")!;
    const entry = passed.entries.find((e) => e.id === "venue-binance-connect")!;
    expect(entry.passes).toBe(true);
    expect(entry.paperModeVerifiedAt).toBe("2026-05-13T10:00:00.000Z");
    expect(entry.failedAt).toBeNull();
    expect(entry.failedReason).toBeNull();
  });

  it("markFail sets passes=false and records reason", () => {
    const failed = markFail(freshList(), "venue-binance-connect", "broker timeout")!;
    const entry = failed.entries.find((e) => e.id === "venue-binance-connect")!;
    expect(entry.passes).toBe(false);
    expect(entry.failedReason).toBe("broker timeout");
    expect(entry.failedAt).not.toBeNull();
  });

  it("returns null for unknown id", () => {
    expect(markPass(freshList(), "ghost")).toBeNull();
    expect(markFail(freshList(), "ghost", "x")).toBeNull();
  });
});

describe("MUTABLE_FEATURE_FIELDS — schema discipline", () => {
  it("includes only passes/timestamps/reason", () => {
    expect(MUTABLE_FEATURE_FIELDS.has("passes")).toBe(true);
    expect(MUTABLE_FEATURE_FIELDS.has("paperModeVerifiedAt")).toBe(true);
    expect(MUTABLE_FEATURE_FIELDS.has("failedAt")).toBe(true);
    expect(MUTABLE_FEATURE_FIELDS.has("failedReason")).toBe(true);
  });

  it("does NOT include description / steps / priority / id / category", () => {
    expect(MUTABLE_FEATURE_FIELDS.has("description")).toBe(false);
    expect(MUTABLE_FEATURE_FIELDS.has("steps")).toBe(false);
    expect(MUTABLE_FEATURE_FIELDS.has("priority")).toBe(false);
    expect(MUTABLE_FEATURE_FIELDS.has("id")).toBe(false);
    expect(MUTABLE_FEATURE_FIELDS.has("category")).toBe(false);
  });
});

describe("applyEdit — accepts passes-only mutations", () => {
  it("accepts flipping passes via the canonical helpers", () => {
    const cur = freshList();
    const next = markPass(cur, "venue-binance-connect")!;
    const result = applyEdit(cur, next);
    expect(result.ok).toBe(true);
    expect(result.violations).toEqual([]);
    expect(result.applied!.entries.find((e) => e.id === "venue-binance-connect")!.passes).toBe(
      true,
    );
  });

  it("accepts a no-op edit", () => {
    const cur = freshList();
    const result = applyEdit(cur, cur);
    expect(result.ok).toBe(true);
  });
});

describe("applyEdit — rejects non-mutable field changes", () => {
  it("rejects description edits", () => {
    const cur = freshList();
    const cand = JSON.parse(JSON.stringify(cur)) as FeatureList;
    cand.entries[0]!.description = "MUTATED";
    const result = applyEdit(cur, cand);
    expect(result.ok).toBe(false);
    expect(result.violations[0]!.field).toBe("description");
  });

  it("rejects steps edits", () => {
    const cur = freshList();
    const cand = JSON.parse(JSON.stringify(cur)) as FeatureList;
    cand.entries[0]!.steps = ["malicious step"];
    const result = applyEdit(cur, cand);
    expect(result.ok).toBe(false);
    expect(result.violations.some((v) => v.field === "steps")).toBe(true);
  });

  it("rejects priority edits", () => {
    const cur = freshList();
    const cand = JSON.parse(JSON.stringify(cur)) as FeatureList;
    cand.entries[0]!.priority = 99;
    const result = applyEdit(cur, cand);
    expect(result.ok).toBe(false);
    expect(result.violations.some((v) => v.field === "priority")).toBe(true);
  });

  it("rejects category change", () => {
    const cur = freshList();
    const cand = JSON.parse(JSON.stringify(cur)) as FeatureList;
    cand.entries[0]!.category = "analysis";
    const result = applyEdit(cur, cand);
    expect(result.ok).toBe(false);
    expect(result.violations.some((v) => v.field === "category")).toBe(true);
  });

  it("rejects entry removal", () => {
    const cur = freshList();
    const cand: FeatureList = { ...cur, entries: [cur.entries[0]!] };
    const result = applyEdit(cur, cand);
    expect(result.ok).toBe(false);
    expect(result.violations.some((v) => v.message.includes("removal"))).toBe(true);
  });

  it("rejects entry addition", () => {
    const cur = freshList();
    const cand: FeatureList = {
      ...cur,
      entries: [
        ...cur.entries,
        makeEntry({
          id: "stranger",
          category: "venue",
          description: "x",
          steps: [],
          priority: 9,
        }),
      ],
    };
    const result = applyEdit(cur, cand);
    expect(result.ok).toBe(false);
    expect(result.violations.some((v) => v.message.includes("addition"))).toBe(true);
  });

  it("collects all violations rather than short-circuiting", () => {
    const cur = freshList();
    const cand = JSON.parse(JSON.stringify(cur)) as FeatureList;
    cand.entries[0]!.description = "X";
    cand.entries[0]!.steps = ["Y"];
    cand.entries[0]!.priority = 99;
    const result = applyEdit(cur, cand);
    expect(result.violations.length).toBeGreaterThanOrEqual(3);
  });
});

describe("formatFeatureList", () => {
  it("renders passing-count + per-category + next priority", () => {
    const passed = markPass(freshList(), "venue-binance-connect")!;
    const out = formatFeatureList(passed);
    expect(out).toContain("1/2 passing");
    expect(out).toContain("venue");
    expect(out).toContain("Next:");
  });

  it("says 'all features passing' when complete", () => {
    let list = freshList();
    list = markPass(list, "venue-binance-connect")!;
    list = markPass(list, "risk-mandate-block")!;
    expect(formatFeatureList(list)).toContain("All features passing");
  });
});

describe("featureListToPayload", () => {
  it("emits stable shape", () => {
    const p = featureListToPayload(freshList());
    expect(p.kind).toBe("trading_feature_list.summary_recorded");
    expect(p.nextPriorityId).toBe("venue-binance-connect");
  });
});
