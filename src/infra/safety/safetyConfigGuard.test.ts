import { describe, it, expect } from "bun:test";

import {
  isSafetyConfigGuardEnabled,
  validateAgainstBaseline,
  validateDiff,
  formatGuardResult,
  guardResultToPayload,
  GORDON_DEFAULT_BASELINE,
  SAFETY_CONFIG_GUARD_FLAG_ENV,
  type SafetyConfig,
} from "./safetyConfigGuard.ts";

function clone(c: SafetyConfig): SafetyConfig {
  return JSON.parse(JSON.stringify(c)) as SafetyConfig;
}

describe("isSafetyConfigGuardEnabled", () => {
  it("respects the flag", () => {
    expect(isSafetyConfigGuardEnabled({})).toBe(false);
    expect(isSafetyConfigGuardEnabled({ [SAFETY_CONFIG_GUARD_FLAG_ENV]: "1" })).toBe(true);
    expect(isSafetyConfigGuardEnabled({ [SAFETY_CONFIG_GUARD_FLAG_ENV]: "true" })).toBe(true);
  });
});

describe("GORDON_DEFAULT_BASELINE", () => {
  it("includes the safety-critical tools from CLAUDE.md", () => {
    expect(GORDON_DEFAULT_BASELINE.denyList).toContain("place_order");
    expect(GORDON_DEFAULT_BASELINE.denyList).toContain("execute_trade");
    expect(GORDON_DEFAULT_BASELINE.denyList).toContain("cancel_order");
    expect(GORDON_DEFAULT_BASELINE.denyList).toContain("wallet_transfer");
  });

  it("has a non-zero loss limit and kill-switch enabled", () => {
    expect(GORDON_DEFAULT_BASELINE.dailyLossLimitPct).toBeGreaterThan(0);
    expect(GORDON_DEFAULT_BASELINE.killSwitchEnabled).toBe(true);
  });
});

describe("validateAgainstBaseline — clean equality passes", () => {
  it("passes when current equals baseline", () => {
    const r = validateAgainstBaseline(GORDON_DEFAULT_BASELINE, clone(GORDON_DEFAULT_BASELINE));
    expect(r.passes).toBe(true);
    expect(r.violations).toEqual([]);
  });

  it("passes when current strictly tightens baseline", () => {
    const tightened = clone(GORDON_DEFAULT_BASELINE);
    tightened.maxPositionUsd = 5_000;
    tightened.maxLeverage = 1;
    tightened.dailyLossLimitPct = 0.02;
    tightened.denyList = [...tightened.denyList, "extra_tool"];
    const r = validateAgainstBaseline(GORDON_DEFAULT_BASELINE, tightened);
    expect(r.passes).toBe(true);
  });
});

describe("validateAgainstBaseline — deny-list integrity", () => {
  it("blocks when a baseline-denied tool is removed", () => {
    const current = clone(GORDON_DEFAULT_BASELINE);
    current.denyList = current.denyList.filter((t) => t !== "place_order");
    const r = validateAgainstBaseline(GORDON_DEFAULT_BASELINE, current);
    expect(r.passes).toBe(false);
    expect(r.violations[0]!.rule).toBe("deny_list_integrity");
    expect(r.violations[0]!.message).toContain("place_order");
  });

  it("accumulates one violation per missing tool", () => {
    const current = clone(GORDON_DEFAULT_BASELINE);
    current.denyList = [];
    const r = validateAgainstBaseline(GORDON_DEFAULT_BASELINE, current);
    expect(r.violations.length).toBe(GORDON_DEFAULT_BASELINE.denyList.length);
  });
});

describe("validateAgainstBaseline — limits cannot be weakened", () => {
  it("blocks when maxPositionUsd is raised", () => {
    const current = clone(GORDON_DEFAULT_BASELINE);
    current.maxPositionUsd = 999_999;
    const r = validateAgainstBaseline(GORDON_DEFAULT_BASELINE, current);
    expect(r.passes).toBe(false);
    expect(r.violations.some((v) => v.rule === "max_position_raised")).toBe(true);
  });

  it("blocks when maxLeverage is raised", () => {
    const current = clone(GORDON_DEFAULT_BASELINE);
    current.maxLeverage = 10;
    const r = validateAgainstBaseline(GORDON_DEFAULT_BASELINE, current);
    expect(r.passes).toBe(false);
    expect(r.violations.some((v) => v.rule === "max_leverage_raised")).toBe(true);
  });

  it("blocks when dailyLossLimitPct is raised", () => {
    const current = clone(GORDON_DEFAULT_BASELINE);
    current.dailyLossLimitPct = 0.5;
    const r = validateAgainstBaseline(GORDON_DEFAULT_BASELINE, current);
    expect(r.passes).toBe(false);
    expect(r.violations.some((v) => v.rule === "daily_loss_limit_raised")).toBe(true);
  });
});

describe("validateAgainstBaseline — kill-switch", () => {
  it("blocks when kill-switch flips true→false", () => {
    const current = clone(GORDON_DEFAULT_BASELINE);
    current.killSwitchEnabled = false;
    const r = validateAgainstBaseline(GORDON_DEFAULT_BASELINE, current);
    expect(r.passes).toBe(false);
    expect(r.violations.some((v) => v.rule === "kill_switch_disabled")).toBe(true);
  });

  it("allows kill-switch to remain true even if baseline is true", () => {
    const r = validateAgainstBaseline(GORDON_DEFAULT_BASELINE, {
      ...GORDON_DEFAULT_BASELINE,
      killSwitchEnabled: true,
    });
    expect(r.passes).toBe(true);
  });
});

describe("validateAgainstBaseline — symbol universe", () => {
  it("blocks when current symbol set expands beyond baseline", () => {
    const baseline: SafetyConfig = {
      ...GORDON_DEFAULT_BASELINE,
      allowedSymbols: ["BTC/USD", "ETH/USD"],
    };
    const current: SafetyConfig = {
      ...baseline,
      allowedSymbols: ["BTC/USD", "ETH/USD", "DOGE/USD"],
    };
    const r = validateAgainstBaseline(baseline, current);
    expect(r.passes).toBe(false);
    expect(r.violations.some((v) => v.rule === "symbol_universe_expanded")).toBe(true);
    expect(r.violations[0]!.message).toContain("DOGE/USD");
  });

  it("allows subset (tightening)", () => {
    const baseline: SafetyConfig = {
      ...GORDON_DEFAULT_BASELINE,
      allowedSymbols: ["BTC/USD", "ETH/USD"],
    };
    const current: SafetyConfig = { ...baseline, allowedSymbols: ["BTC/USD"] };
    const r = validateAgainstBaseline(baseline, current);
    expect(r.passes).toBe(true);
  });

  it("ignores the check when baseline is empty (no universe restriction)", () => {
    const current: SafetyConfig = {
      ...GORDON_DEFAULT_BASELINE,
      allowedSymbols: ["ANYTHING"],
    };
    const r = validateAgainstBaseline(GORDON_DEFAULT_BASELINE, current);
    expect(r.violations.some((v) => v.rule === "symbol_universe_expanded")).toBe(false);
  });
});

describe("validateAgainstBaseline — aggregates blocking fix instructions", () => {
  it("joins fix instructions with rule tags", () => {
    const current = clone(GORDON_DEFAULT_BASELINE);
    current.maxLeverage = 100;
    current.killSwitchEnabled = false;
    const r = validateAgainstBaseline(GORDON_DEFAULT_BASELINE, current);
    expect(r.passes).toBe(false);
    expect(r.blockingFixInstruction).toContain("[max_leverage_raised]");
    expect(r.blockingFixInstruction).toContain("[kill_switch_disabled]");
  });

  it("blockingFixInstruction is null when nothing blocks", () => {
    const r = validateAgainstBaseline(GORDON_DEFAULT_BASELINE, clone(GORDON_DEFAULT_BASELINE));
    expect(r.blockingFixInstruction).toBeNull();
  });
});

describe("validateDiff", () => {
  it("treats validateDiff as baseline-check against prev", () => {
    const prev = clone(GORDON_DEFAULT_BASELINE);
    const next = clone(prev);
    next.maxLeverage = 5;
    const r = validateDiff(prev, next);
    expect(r.passes).toBe(false);
  });

  it("allows tightening", () => {
    const prev = clone(GORDON_DEFAULT_BASELINE);
    const next = clone(prev);
    next.maxLeverage = 1;
    const r = validateDiff(prev, next);
    expect(r.passes).toBe(true);
  });
});

describe("formatGuardResult", () => {
  it("includes PASS/BLOCK and per-violation lines", () => {
    const current = clone(GORDON_DEFAULT_BASELINE);
    current.maxLeverage = 100;
    const r = validateAgainstBaseline(GORDON_DEFAULT_BASELINE, current);
    const out = formatGuardResult(r);
    expect(out).toContain("BLOCK");
    expect(out).toContain("max_leverage_raised");
  });

  it("prints PASS on clean diff", () => {
    const r = validateAgainstBaseline(GORDON_DEFAULT_BASELINE, clone(GORDON_DEFAULT_BASELINE));
    expect(formatGuardResult(r)).toContain("PASS");
  });
});

describe("guardResultToPayload", () => {
  it("emits stable shape", () => {
    const current = clone(GORDON_DEFAULT_BASELINE);
    current.maxLeverage = 100;
    const r = validateAgainstBaseline(GORDON_DEFAULT_BASELINE, current);
    const p = guardResultToPayload(r);
    expect(p.kind).toBe("safety_config_guard.result_recorded");
    expect(p.passes).toBe(false);
    expect(p.blockingCount).toBe(1);
  });
});
