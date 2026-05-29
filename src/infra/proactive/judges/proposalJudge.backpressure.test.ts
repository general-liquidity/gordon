import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { HeuristicJudge, ORCHESTRATION_BACKPRESSURE_ENV } from "./proposalJudge.ts";
import { getSuggestionStore } from "../storage/suggestionStore.ts";
import type { ProactiveCategory, ProactiveSuggestion } from "../types.ts";

function suggestion(
  category: ProactiveCategory,
  overrides: Partial<ProactiveSuggestion> = {},
): ProactiveSuggestion {
  return {
    id: `s-${Math.floor(Math.random() * 1e9)}`,
    category,
    title: `${category} card`,
    body: "body",
    confidence: 0.9,
    createdAt: new Date().toISOString(),
    status: "pending",
    triggers: { source: "test" },
    ...overrides,
  } as ProactiveSuggestion;
}

/** Flood the store with pending cards (a category that won't collide with the
 *  candidates under test on the near-dup check). */
function floodPending(n: number): void {
  const store = getSuggestionStore();
  for (let i = 0; i < n; i++) {
    store.add(suggestion("news_event", { id: `flood-${i}`, triggers: { source: "test", symbol: `SYM${i}` } }));
  }
}

const originalFlag = process.env[ORCHESTRATION_BACKPRESSURE_ENV];

beforeEach(() => {
  getSuggestionStore().clear();
});

afterEach(() => {
  getSuggestionStore().clear();
  if (originalFlag === undefined) delete process.env[ORCHESTRATION_BACKPRESSURE_ENV];
  else process.env[ORCHESTRATION_BACKPRESSURE_ENV] = originalFlag;
});

describe("HeuristicJudge — orchestration backpressure", () => {
  test("flag OFF: non-critical card fires even with a deep pending queue", async () => {
    delete process.env[ORCHESTRATION_BACKPRESSURE_ENV];
    floodPending(20); // 20/6 ≈ 3.3h backlog → would be overloaded
    const judge = new HeuristicJudge();
    const verdict = await judge.evaluate(suggestion("playbook_suggest"));
    expect(verdict.shouldFire).toBe(true);
  });

  test("flag ON + overloaded: non-critical card is deferred", async () => {
    process.env[ORCHESTRATION_BACKPRESSURE_ENV] = "1";
    floodPending(20);
    const judge = new HeuristicJudge();
    const verdict = await judge.evaluate(suggestion("playbook_suggest"));
    expect(verdict.shouldFire).toBe(false);
    expect(verdict.rejections.some((r) => r.includes("orchestration backpressure"))).toBe(true);
  });

  test("flag ON + overloaded: safety-critical card still fires (exempt)", async () => {
    process.env[ORCHESTRATION_BACKPRESSURE_ENV] = "1";
    floodPending(20);
    const judge = new HeuristicJudge();
    const riskVerdict = await judge.evaluate(suggestion("risk_warning"));
    const stopVerdict = await judge.evaluate(suggestion("stop_loss_tighten", { triggers: { source: "test", symbol: "BTC" } }));
    expect(riskVerdict.shouldFire).toBe(true);
    expect(stopVerdict.shouldFire).toBe(true);
  });

  test("flag ON + slack queue: non-critical card fires (no backpressure)", async () => {
    process.env[ORCHESTRATION_BACKPRESSURE_ENV] = "1";
    floodPending(2); // 2/6 ≈ 0.33h → slack
    const judge = new HeuristicJudge();
    const verdict = await judge.evaluate(suggestion("playbook_suggest"));
    expect(verdict.shouldFire).toBe(true);
  });
});
