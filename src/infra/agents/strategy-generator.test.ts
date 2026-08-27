import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { StrategyGeneratorAgent, describeAbsentBacktest } from "./strategy-generator.ts";
import { ATTEMPTS_LOG_PATH_ENV, countTrials } from "../trading/ops/multipleTestingTracker.ts";
import { EXAMPLE_RSI_BOUNCE_DSL } from "../../strategies/dsl/schema.ts";
import type { LLMClient } from "../ai/llm/index.ts";

// ---------------------------------------------------------------------------
// Stub LLM: no network, no provider registry. `chatWithJSON` is the only
// method the generator calls.
// ---------------------------------------------------------------------------

interface StubBehaviour {
  /** Fail the intent-parsing call (the one carrying a `style` field). */
  failIntent?: boolean;
  /** Fail the DSL-generation call. */
  failDsl?: boolean;
}

function stubLlm(behaviour: StubBehaviour = {}): LLMClient {
  return {
    chatWithJSON: async (messages: Array<{ role: string; content: string }>) => {
      const system = messages[0]?.content ?? "";
      const isIntent = system.includes("trading strategy analyst");
      if (isIntent) {
        if (behaviour.failIntent) throw new Error("intent provider down");
        return {
          style: "momentum",
          indicators: ["rsi"],
          entryLogic: "rsi crosses up",
          exitLogic: "atr stop",
          riskProfile: "moderate",
          marketConditions: ["trending"],
        };
      }
      if (behaviour.failDsl) throw new Error("dsl provider down");
      return structuredClone(EXAMPLE_RSI_BOUNCE_DSL);
    },
  } as unknown as LLMClient;
}

const OPTIONS = {
  riskLevel: "medium" as const,
  timeframes: ["4h"],
  backtestDays: 90,
  symbol: "BTCUSDT",
};

let previousLogPath: string | undefined;

beforeEach(() => {
  previousLogPath = process.env[ATTEMPTS_LOG_PATH_ENV];
  const dir = mkdtempSync(join(tmpdir(), "gordon-stratgen-"));
  process.env[ATTEMPTS_LOG_PATH_ENV] = join(dir, "attempts.jsonl");
});

afterEach(() => {
  if (previousLogPath === undefined) delete process.env[ATTEMPTS_LOG_PATH_ENV];
  else process.env[ATTEMPTS_LOG_PATH_ENV] = previousLogPath;
});

describe("StrategyGeneratorAgent: absent backtest is typed, not fabricated (item 1)", () => {
  it("returns a null backtest with a reason when no exchange client exists", async () => {
    // No exchange => a backtest is IMPOSSIBLE, not merely unsuccessful.
    const agent = new StrategyGeneratorAgent(stubLlm());
    const result = await agent.generateFromPrompt("rsi bounce on btc", OPTIONS);

    // Before the fix this was a `mock_bt_*` BacktestResult shaped exactly like
    // a real one, carrying maxDrawdown: 0, the theoretical BEST value.
    expect(result.backtestResult).toBeNull();
    expect(result.backtestAbsent).toEqual({ reason: "no_exchange_client" });
  });

  it("never reports meeting thresholds on an absent backtest", async () => {
    const agent = new StrategyGeneratorAgent(stubLlm());
    const result = await agent.generateFromPrompt("rsi bounce on btc", {
      ...OPTIONS,
      // Thresholds a zero-metric mock would trivially satisfy on drawdown.
      minSharpe: 0,
      minWinRate: 0,
      maxDrawdown: 100,
    });

    expect(result.meetsThresholds).toBe(false);
  });

  it("does not expose a mock backtest factory", () => {
    // `createMockBacktestResult` is deleted; nothing may resurrect it.
    expect(
      (StrategyGeneratorAgent.prototype as unknown as Record<string, unknown>)
        .createMockBacktestResult,
    ).toBeUndefined();
  });

  it("describes each absence reason distinctly", () => {
    expect(describeAbsentBacktest({ reason: "no_exchange_client" })).toContain(
      "exchange client unavailable",
    );
    expect(describeAbsentBacktest({ reason: "backtest_failed", detail: "no candles" })).toContain(
      "no candles",
    );
  });
});

describe("StrategyGeneratorAgent: every emitted candidate is a trial (item 4)", () => {
  it("counts a candidate that could not be backtested", async () => {
    const agent = new StrategyGeneratorAgent(stubLlm());
    await agent.generateFromPrompt("rsi bounce on btc", OPTIONS);

    // Before the fix `recordAttempt` ran only AFTER a successful backtest, so a
    // candidate that never got backtested consumed a null draw invisibly and
    // the multiple-testing bar stayed artificially low.
    const trials = countTrials(`momentum/${OPTIONS.symbol}`);
    expect(trials.distinctCount).toBe(1);
    expect(trials.totalCount).toBe(1);
  });

  it("scopes the trial count to the strategy family", async () => {
    const agent = new StrategyGeneratorAgent(stubLlm());
    await agent.generateFromPrompt("rsi bounce on btc", OPTIONS);

    expect(countTrials("mean-reversion/BTCUSDT").distinctCount).toBe(0);
  });
});

describe("StrategyGeneratorAgent: silent recovery is surfaced (item 5)", () => {
  it("still returns a strategy when intent parsing fails", async () => {
    const agent = new StrategyGeneratorAgent(stubLlm({ failIntent: true }));
    const result = await agent.generateFromPrompt("rsi bounce on btc", OPTIONS);

    // Recovery is retained; this is not turned into a hard failure.
    expect(result.strategy).toBeDefined();
    // ...but the caller can now SEE that defaults were substituted.
    const kinds = result.degradations.map((d) => d.kind);
    expect(kinds).toContain("intent_parse_defaulted");
    expect(result.degradations[0]!.detail).toContain("trend-following");
  });

  it("flags a substituted template when DSL generation fails", async () => {
    const agent = new StrategyGeneratorAgent(stubLlm({ failDsl: true }));
    const result = await agent.generateFromPrompt("rsi bounce on btc", OPTIONS);

    expect(result.strategy).toBeDefined();
    expect(result.degradations.map((d) => d.kind)).toContain("dsl_generation_substituted");
  });

  it("reports no degradations on a clean run", async () => {
    const agent = new StrategyGeneratorAgent(stubLlm());
    const result = await agent.generateFromPrompt("rsi bounce on btc", OPTIONS);

    expect(result.degradations).toEqual([]);
  });
});
