import { afterEach, describe, expect, it } from "bun:test";
import {
  SleepTimeCache,
  runSleepTimePrecompute,
  tickSleepTimePrecompute,
  lookupSleepTimeAnalysis,
  registerSleepAnalyses,
  recordSleepTimeActivity,
  isIdle,
  isSleepTimeEnabled,
  resetSleepTimeState,
  type SleepAnalysis,
} from "./sleepTimeCompute.ts";

function makeAnalyses(counter: { n: number }): SleepAnalysis[] {
  return [
    {
      key: "regime",
      label: "Market regime",
      keywords: ["regime", "btc", "eth"],
      compute: async () => {
        counter.n += 1;
        return `regime computed #${counter.n}`;
      },
    },
    {
      key: "drawdown",
      label: "Portfolio drawdown",
      keywords: ["drawdown", "risk", "loss"],
      compute: async () => "drawdown 4.2%",
    },
  ];
}

afterEach(() => {
  resetSleepTimeState();
  delete process.env.GORDON_SLEEP_TIME;
});

describe("SleepTimeCache", () => {
  it("returns fresh entries and treats stale ones as a miss", () => {
    const cache = new SleepTimeCache(1000);
    cache.put({ key: "regime", label: "R", keywords: ["regime"], value: "v", computedAt: 0 });

    expect(cache.get("regime", 500)?.value).toBe("v");
    expect(cache.get("regime", 2000)).toBeNull(); // stale (past TTL)
  });

  it("matches a query to a fresh entry by keyword overlap", () => {
    const cache = new SleepTimeCache(1000);
    cache.put({
      key: "regime",
      label: "R",
      keywords: ["regime", "eth"],
      value: "trending",
      computedAt: 0,
    });

    expect(cache.match("what's the regime on ETH?", 100)?.value).toBe("trending");
    expect(cache.match("tell me a joke", 100)).toBeNull();
    expect(cache.match("regime?", 5000)).toBeNull(); // stale
  });
});

describe("runSleepTimePrecompute", () => {
  it("runs each analysis on an idle pass and populates the cache", async () => {
    const counter = { n: 0 };
    const cache = new SleepTimeCache(10_000);
    const result = await runSleepTimePrecompute({
      analyses: makeAnalyses(counter),
      cache,
      now: 1000,
    });

    expect(result.ran).toBe(true);
    expect(result.computed).toBe(2);
    expect(result.failed).toBe(0);
    expect(cache.size()).toBe(2);

    // A matching query hits the cache.
    const hit = lookupSleepTimeAnalysis("what's my risk on ETH?", 1500, cache);
    expect(hit?.key).toBe("regime"); // "eth" keyword; "risk" also maps to drawdown but regime wins on ETH
    expect(cache.match("what's my drawdown?", 1500)?.key).toBe("drawdown");
  });

  it("survives a failing analysis without aborting the pass", async () => {
    const cache = new SleepTimeCache(10_000);
    const result = await runSleepTimePrecompute({
      analyses: [
        { key: "ok", label: "ok", keywords: ["ok"], compute: async () => "fine" },
        {
          key: "bad",
          label: "bad",
          keywords: ["bad"],
          compute: async () => {
            throw new Error("boom");
          },
        },
      ],
      cache,
      now: 0,
    });
    expect(result.computed).toBe(1);
    expect(result.failed).toBe(1);
    expect(cache.size()).toBe(1);
  });

  it("recomputes stale entries on a later pass", async () => {
    const counter = { n: 0 };
    const cache = new SleepTimeCache(1000);
    const analyses = makeAnalyses(counter);

    await runSleepTimePrecompute({ analyses, cache, now: 0 });
    expect(counter.n).toBe(1);
    expect(cache.match("regime", 500)?.value).toBe("regime computed #1");

    // Past the TTL, the entry reads as a miss...
    expect(cache.match("regime", 2000)).toBeNull();

    // ...a fresh pass recomputes and repopulates it.
    await runSleepTimePrecompute({ analyses, cache, now: 2000 });
    expect(counter.n).toBe(2);
    expect(cache.match("regime", 2200)?.value).toBe("regime computed #2");
  });
});

describe("tickSleepTimePrecompute (observer entry)", () => {
  it("no-ops when the flag is disabled", async () => {
    delete process.env.GORDON_SLEEP_TIME;
    registerSleepAnalyses(makeAnalyses({ n: 0 }));
    const result = await tickSleepTimePrecompute({ now: 10_000_000 });
    expect(result.ran).toBe(false);
    expect(result.reason).toContain("not enabled");
  });

  it("no-ops when the session is not idle", async () => {
    process.env.GORDON_SLEEP_TIME = "1";
    registerSleepAnalyses(makeAnalyses({ n: 0 }));
    recordSleepTimeActivity(10_000_000); // just active
    const result = await tickSleepTimePrecompute({
      now: 10_000_000 + 1000,
      idleThresholdMs: 60_000,
    });
    expect(result.ran).toBe(false);
    expect(result.reason).toContain("idle");
  });

  it("runs when enabled + idle + analyses registered", async () => {
    process.env.GORDON_SLEEP_TIME = "1";
    const counter = { n: 0 };
    registerSleepAnalyses(makeAnalyses(counter));
    recordSleepTimeActivity(0);
    const now = 10 * 60 * 1000; // 10 min later — idle
    const result = await tickSleepTimePrecompute({ now, idleThresholdMs: 3 * 60 * 1000 });
    expect(result.ran).toBe(true);
    expect(result.computed).toBe(2);
    expect(lookupSleepTimeAnalysis("regime on btc", now + 1)?.key).toBe("regime");
  });
});

describe("idle + flag helpers", () => {
  it("isIdle reflects recorded activity", () => {
    recordSleepTimeActivity(1000);
    expect(isIdle(1000 + 1000, 5000)).toBe(false);
    expect(isIdle(1000 + 6000, 5000)).toBe(true);
  });

  it("isSleepTimeEnabled reads the env flag", () => {
    delete process.env.GORDON_SLEEP_TIME;
    expect(isSleepTimeEnabled()).toBe(false);
    process.env.GORDON_SLEEP_TIME = "1";
    expect(isSleepTimeEnabled()).toBe(true);
  });
});
