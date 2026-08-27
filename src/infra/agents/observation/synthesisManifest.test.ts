import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { buildSynthesisManifest, summarizeManifest } from "./synthesisManifest.ts";
import { _resetObservationsForTests, recordSymbolObservation } from "./symbolObservationTracker.ts";
import { _resetCacheForTests } from "../../news/cryptoHeadlines.ts";
import { unlinkSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

// Use a scratch lessons file in the OS tmpdir so tests don't touch
// the real ~/.gordon path AND don't clutter the project working dir.
const scratchLessonsPath = join(tmpdir(), `gordon-synthesis-lessons-${process.pid}.json`);
const previousLessonsPath = process.env.GORDON_ACE_LESSONS_PATH;

function writeLessons(lessons: Array<{ id: string; text: string; curatedAt?: string }>): void {
  mkdirSync(dirname(scratchLessonsPath), { recursive: true });
  writeFileSync(
    scratchLessonsPath,
    JSON.stringify({
      version: 1,
      updatedAt: new Date().toISOString(),
      lessons: lessons.map((l) => ({
        id: l.id,
        text: l.text,
        category: "operational",
        evidenceCount: 1,
        firstSeenAt: Date.now(),
        lastSeenAt: Date.now(),
        evidenceEntryIds: [],
        score: 0.6,
        curatedAt: l.curatedAt ?? new Date().toISOString(),
      })),
    }),
    "utf8",
  );
}

beforeEach(() => {
  _resetObservationsForTests();
  _resetCacheForTests();
  process.env.GORDON_ACE_LESSONS_PATH = scratchLessonsPath;
  if (existsSync(scratchLessonsPath)) unlinkSync(scratchLessonsPath);
});

afterEach(() => {
  if (existsSync(scratchLessonsPath)) unlinkSync(scratchLessonsPath);
  if (previousLessonsPath === undefined) delete process.env.GORDON_ACE_LESSONS_PATH;
  else process.env.GORDON_ACE_LESSONS_PATH = previousLessonsPath;
});

describe("buildSynthesisManifest", () => {
  test("cold session — every subsystem returns null/empty without throwing", () => {
    const m = buildSynthesisManifest("BTC/USDT");
    expect(m.symbol).toBe("BTC/USDT");
    expect(m.regime).toBeNull();
    expect(m.news).toBeNull();
    expect(m.observationCount).toBe(0);
    expect(m.matchedLessonIds).toEqual([]);
    expect(typeof m.capturedAt).toBe("number");
    expect(m.observationWindowMs).toBeGreaterThan(0);
  });

  test("observation count reflects recorded observations within window", () => {
    recordSymbolObservation("BTC/USDT");
    recordSymbolObservation("BTC/USDT");
    recordSymbolObservation("BTC/USDT");
    const m = buildSynthesisManifest("BTC/USDT");
    expect(m.observationCount).toBe(3);
  });

  test("normalizes symbol case + matches mixed-case input", () => {
    recordSymbolObservation("btc/usdt");
    const m = buildSynthesisManifest("  btc/usdt  ");
    expect(m.symbol).toBe("BTC/USDT");
    expect(m.observationCount).toBe(1);
  });

  test("matches ACE lessons by base token in lesson text", () => {
    writeLessons([
      { id: "op::btc-rule", text: "BTC entries during overnight Asia tend to fade." },
      { id: "op::eth-rule", text: "ETH funding flips inversely on Sundays." },
      { id: "op::generic", text: "Avoid market orders during the open." },
    ]);
    const m = buildSynthesisManifest("BTC/USDT");
    expect(m.matchedLessonIds).toContain("op::btc-rule");
    expect(m.matchedLessonIds).not.toContain("op::eth-rule");
    expect(m.matchedLessonIds).not.toContain("op::generic");
  });

  test("strips quote suffix to find base token (BTCUSDT → btc)", () => {
    writeLessons([{ id: "op::btc-rule", text: "BTC entries during overnight Asia tend to fade." }]);
    const m = buildSynthesisManifest("BTCUSDT");
    expect(m.matchedLessonIds).toContain("op::btc-rule");
  });

  test("caps matched lesson IDs (sorted by curatedAt desc)", () => {
    const lessons = Array.from({ length: 15 }, (_, i) => ({
      id: `op::btc-${i}`,
      text: `BTC pattern #${i}`,
      curatedAt: new Date(Date.now() - i * 60_000).toISOString(),
    }));
    writeLessons(lessons);
    const m = buildSynthesisManifest("BTC/USDT");
    expect(m.matchedLessonIds.length).toBeLessThanOrEqual(8);
    // Newest first.
    expect(m.matchedLessonIds[0]).toBe("op::btc-0");
  });

  test("malformed ACE lessons file does not throw", () => {
    writeFileSync(scratchLessonsPath, "{ not valid json", "utf8");
    const m = buildSynthesisManifest("BTC/USDT");
    expect(m.matchedLessonIds).toEqual([]);
  });

  test("respects custom observation window", () => {
    recordSymbolObservation("AAPL");
    // 1ms window — observation should fall outside almost immediately.
    const wait = new Promise((resolve) => setTimeout(resolve, 10));
    return wait.then(() => {
      const m = buildSynthesisManifest("AAPL", { observationWindowMs: 1 });
      expect(m.observationCount).toBe(0);
      expect(m.observationWindowMs).toBe(1);
    });
  });
});

describe("summarizeManifest", () => {
  test("always includes observation count, even on cold manifest", () => {
    const summary = summarizeManifest(buildSynthesisManifest("BTC/USDT"));
    expect(summary).toContain("obs: 0");
  });

  test("includes regime + news + lessons when present", () => {
    const summary = summarizeManifest({
      capturedAt: Date.now(),
      symbol: "BTC/USDT",
      regime: { label: "trending_up", confidence: 0.82, timeframe: "1h" },
      news: { headlinesCount: 3, netSentiment: 0.5, windowHoursApprox: 24 },
      observationCount: 5,
      observationWindowMs: 4 * 60 * 60 * 1000,
      matchedLessonIds: ["op::a", "op::b"],
      candleSnapshotRef: null,
    });
    expect(summary).toContain("regime: trending_up");
    expect(summary).toContain("news: 3 hdl");
    expect(summary).toContain("obs: 5");
    expect(summary).toContain("lessons: 2");
  });
});
