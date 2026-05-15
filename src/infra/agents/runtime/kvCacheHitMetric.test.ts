import { describe, it, expect, beforeEach } from "bun:test";
import { mkdtempSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  isKvCacheMetricEnabled,
  defaultKvCacheMetricPath,
  recordCacheCall,
  readCacheCalls,
  summarizeHitRate,
  formatHitRateSummary,
  summaryToPayload,
  KV_CACHE_METRIC_FLAG_ENV,
  KV_CACHE_METRIC_PATH_ENV,
} from "./kvCacheHitMetric.ts";

let tempDir: string;
let logPath: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "gordon-kv-cache-test-"));
  logPath = join(tempDir, "metrics.jsonl");
});

describe("isKvCacheMetricEnabled", () => {
  it("respects the flag", () => {
    expect(isKvCacheMetricEnabled({})).toBe(false);
    expect(isKvCacheMetricEnabled({ [KV_CACHE_METRIC_FLAG_ENV]: "1" })).toBe(true);
    expect(isKvCacheMetricEnabled({ [KV_CACHE_METRIC_FLAG_ENV]: "true" })).toBe(true);
  });
});

describe("defaultKvCacheMetricPath", () => {
  it("honors env override", () => {
    expect(defaultKvCacheMetricPath({ [KV_CACHE_METRIC_PATH_ENV]: "/x.jsonl" })).toBe("/x.jsonl");
  });
  it("falls back to home-dir default", () => {
    expect(defaultKvCacheMetricPath({})).toContain("kv-cache-metrics.jsonl");
  });
});

describe("recordCacheCall", () => {
  it("appends a JSONL line", () => {
    recordCacheCall(
      {
        callId: "c1",
        prefixHash: "h1",
        hit: true,
        cachedTokens: 1000,
        totalInputTokens: 1500,
      },
      logPath,
    );
    expect(existsSync(logPath)).toBe(true);
    const parsed = JSON.parse(readFileSync(logPath, "utf8").trim());
    expect(parsed.callId).toBe("c1");
    expect(parsed.hit).toBe(true);
  });

  it("defaults cachedTokens to 0", () => {
    const r = recordCacheCall(
      { callId: "c1", prefixHash: "h", hit: false, totalInputTokens: 100 },
      logPath,
    );
    expect(r.cachedTokens).toBe(0);
  });

  it("creates parent dir", () => {
    const nested = join(tempDir, "a", "b", "c.jsonl");
    recordCacheCall(
      { callId: "c", prefixHash: "h", hit: false, totalInputTokens: 1 },
      nested,
    );
    expect(existsSync(nested)).toBe(true);
  });
});

describe("readCacheCalls", () => {
  it("returns empty for missing file", () => {
    expect(readCacheCalls({}, join(tempDir, "no.jsonl"))).toEqual([]);
  });

  it("returns newest-first", () => {
    recordCacheCall(
      { callId: "old", prefixHash: "h", hit: false, totalInputTokens: 1, now: "2026-01-01T00:00:00Z" },
      logPath,
    );
    recordCacheCall(
      { callId: "new", prefixHash: "h", hit: false, totalInputTokens: 1, now: "2026-05-01T00:00:00Z" },
      logPath,
    );
    const out = readCacheCalls({}, logPath);
    expect(out[0]!.callId).toBe("new");
  });

  it("filters by sinceMs", () => {
    recordCacheCall(
      { callId: "old", prefixHash: "h", hit: false, totalInputTokens: 1, now: "2025-01-01T00:00:00Z" },
      logPath,
    );
    recordCacheCall(
      { callId: "new", prefixHash: "h", hit: false, totalInputTokens: 1, now: "2026-01-01T00:00:00Z" },
      logPath,
    );
    const cutoff = Date.parse("2025-06-01T00:00:00Z");
    const out = readCacheCalls({ sinceMs: cutoff }, logPath);
    expect(out.map((c) => c.callId)).toEqual(["new"]);
  });

  it("respects limit", () => {
    for (let i = 0; i < 5; i++) {
      recordCacheCall(
        { callId: `c${i}`, prefixHash: "h", hit: false, totalInputTokens: 1 },
        logPath,
      );
    }
    expect(readCacheCalls({ limit: 2 }, logPath).length).toBe(2);
  });

  it("tolerates malformed lines", () => {
    recordCacheCall({ callId: "c1", prefixHash: "h", hit: false, totalInputTokens: 1 }, logPath);
    const { appendFileSync } = require("node:fs");
    appendFileSync(logPath, "not-json{\n");
    recordCacheCall({ callId: "c2", prefixHash: "h", hit: false, totalInputTokens: 1 }, logPath);
    expect(readCacheCalls({}, logPath).length).toBe(2);
  });
});

describe("summarizeHitRate", () => {
  it("returns zeros for empty input", () => {
    const s = summarizeHitRate([]);
    expect(s.hits).toBe(0);
    expect(s.hitRate).toBe(0);
    expect(s.estimatedSavingsUsd).toBe(0);
  });

  it("computes hit rate correctly", () => {
    const calls = [
      { callId: "1", prefixHash: "h", hit: true, cachedTokens: 0, totalInputTokens: 100, capturedAt: "x" },
      { callId: "2", prefixHash: "h", hit: false, cachedTokens: 0, totalInputTokens: 100, capturedAt: "x" },
      { callId: "3", prefixHash: "h", hit: true, cachedTokens: 0, totalInputTokens: 100, capturedAt: "x" },
    ];
    const s = summarizeHitRate(calls);
    expect(s.hits).toBe(2);
    expect(s.misses).toBe(1);
    expect(s.hitRate).toBeCloseTo(2 / 3);
  });

  it("computes cache token ratio", () => {
    const calls = [
      { callId: "1", prefixHash: "h", hit: true, cachedTokens: 800, totalInputTokens: 1000, capturedAt: "x" },
    ];
    expect(summarizeHitRate(calls).cacheTokenRatio).toBeCloseTo(0.8);
  });

  it("computes estimated savings (Manus 10x anchor)", () => {
    // 1M cached tokens at $3/M uncached price → saved 90% of $3 = $2.70
    const calls = [
      { callId: "1", prefixHash: "h", hit: true, cachedTokens: 1_000_000, totalInputTokens: 1_000_000, capturedAt: "x" },
    ];
    const s = summarizeHitRate(calls);
    expect(s.estimatedSavingsUsd).toBeCloseTo(2.7, 1);
  });

  it("respects custom price override", () => {
    const calls = [
      { callId: "1", prefixHash: "h", hit: true, cachedTokens: 1_000_000, totalInputTokens: 1_000_000, capturedAt: "x" },
    ];
    const s = summarizeHitRate(calls, { usdPerMillionUncached: 15 });
    expect(s.estimatedSavingsUsd).toBeCloseTo(15 * 0.9, 1);
  });
});

describe("formatHitRateSummary", () => {
  it("includes hit rate, ratio, and savings", () => {
    const calls = [
      { callId: "1", prefixHash: "h", hit: true, cachedTokens: 500, totalInputTokens: 1000, capturedAt: "x" },
    ];
    const out = formatHitRateSummary(summarizeHitRate(calls));
    expect(out).toContain("hit rate");
    expect(out).toContain("cached-token ratio");
    expect(out).toContain("savings");
  });
});

describe("summaryToPayload", () => {
  it("emits stable shape", () => {
    const p = summaryToPayload(summarizeHitRate([]));
    expect(p.kind).toBe("kv_cache.hit_rate_recorded");
    expect(p.windowSize).toBe(0);
  });
});
