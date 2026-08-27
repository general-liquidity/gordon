import { describe, it, expect } from "bun:test";
import {
  EXTENDED_THINKING_BUDGETS,
  MAX_THINKING_BUDGET,
  MIN_THINKING_BUDGET,
  buildExtendedThinkingConfig,
  providerOptionsForDepth,
  toMastraProviderOptions,
} from "./extendedThinking.ts";

describe("buildExtendedThinkingConfig", () => {
  it("returns disabled for depth=off", () => {
    const r = buildExtendedThinkingConfig("off");
    expect(r.type).toBe("disabled");
    expect(r.budgetTokens).toBe(0);
  });

  it("uses depth-tier budget by default", () => {
    expect(buildExtendedThinkingConfig("low").budgetTokens).toBe(EXTENDED_THINKING_BUDGETS.low);
    expect(buildExtendedThinkingConfig("medium").budgetTokens).toBe(
      EXTENDED_THINKING_BUDGETS.medium,
    );
    expect(buildExtendedThinkingConfig("high").budgetTokens).toBe(EXTENDED_THINKING_BUDGETS.high);
  });

  it("clamps below maxTokens-1 to satisfy Anthropic constraint", () => {
    const r = buildExtendedThinkingConfig("high", { maxTokens: 4096 });
    expect(r.budgetTokens).toBeLessThan(4096);
    expect(r.type).toBe("enabled");
  });

  it("disables thinking entirely when outer maxTokens is too small", () => {
    const r = buildExtendedThinkingConfig("high", { maxTokens: 100 });
    expect(r.type).toBe("disabled");
  });

  it("respects budgetOverride and clamps to MAX_THINKING_BUDGET", () => {
    const r = buildExtendedThinkingConfig("low", { budgetOverride: 999_999 });
    expect(r.budgetTokens).toBe(MAX_THINKING_BUDGET);
  });

  it("enforces MIN_THINKING_BUDGET on a too-small override", () => {
    const r = buildExtendedThinkingConfig("low", { budgetOverride: 100 });
    expect(r.budgetTokens).toBe(MIN_THINKING_BUDGET);
  });
});

describe("toMastraProviderOptions", () => {
  it("returns an empty object when thinking is disabled", () => {
    expect(toMastraProviderOptions({ type: "disabled", budgetTokens: 0 })).toEqual({});
  });

  it("nests under the anthropic provider key when enabled", () => {
    const r = toMastraProviderOptions({ type: "enabled", budgetTokens: 4096 });
    expect(r).toEqual({
      anthropic: { thinking: { type: "enabled", budgetTokens: 4096 } },
    });
  });
});

describe("providerOptionsForDepth", () => {
  it("returns {} for off so callers can splat unconditionally", () => {
    expect(providerOptionsForDepth("off")).toEqual({});
  });

  it("emits a complete anthropic thinking block for enabled depths", () => {
    const r = providerOptionsForDepth("medium", { maxTokens: 16_384 });
    expect("anthropic" in r).toBe(true);
    expect(
      (r as { anthropic: { thinking: { type: string; budgetTokens: number } } }).anthropic.thinking
        .type,
    ).toBe("enabled");
  });
});
