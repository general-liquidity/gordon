import { describe, it, expect } from "bun:test";
import {
  checkTrajectory,
  checkScenarioAssertions,
  type NormalizedTrace,
} from "./processChecks.ts";
import { computePassK, passKFromChecks } from "./passK.ts";

function trace(
  calls: Array<{ name: string; ok?: boolean }>,
  extra: Partial<NormalizedTrace> = {},
): NormalizedTrace {
  return {
    toolCalls: calls.map((c, i) => ({ name: c.name, ok: c.ok ?? true, order: i })),
    ...extra,
  };
}

describe("checkTrajectory", () => {
  it("passes an empty trajectory", () => {
    const r = checkTrajectory(trace([]));
    expect(r.passed).toBe(true);
    expect(r.violations).toEqual([]);
  });

  it("BLOCKS an order with no preceding risk gate", () => {
    const r = checkTrajectory(trace([{ name: "get_market_data" }, { name: "place_market_order" }]));
    expect(r.passed).toBe(false);
    expect(r.violations.some((v) => v.rule === "risk_gate_before_order" && v.severity === "block")).toBe(true);
  });

  it("passes an order preceded by classify_trade_risk", () => {
    const r = checkTrajectory(trace([{ name: "classify_trade_risk" }, { name: "place_market_order" }]));
    expect(r.passed).toBe(true);
  });

  it("passes an order when a risk_check_id is linked even without a risk tool call", () => {
    const r = checkTrajectory(trace([{ name: "place_market_order" }], { riskCheckId: "rc-123" }));
    expect(r.passed).toBe(true);
  });

  it("BLOCKS when execute_plan has no preceding approve_plan", () => {
    const r = checkTrajectory(
      trace([{ name: "classify_trade_risk" }, { name: "execute_plan" }]),
    );
    expect(r.passed).toBe(false);
    expect(r.violations.some((v) => v.rule === "approval_before_execute_plan" && v.severity === "block")).toBe(true);
  });

  it("passes execute_plan with both approve_plan and risk gate", () => {
    const r = checkTrajectory(
      trace([{ name: "classify_trade_risk" }, { name: "approve_plan" }, { name: "execute_plan" }]),
    );
    expect(r.passed).toBe(true);
    expect(r.violations.length).toBe(0);
  });

  it("BLOCKS execution.start_intent with no preceding execution preflight", () => {
    const r = checkTrajectory(trace([{ name: "gateway.execution.start_intent" }]));
    expect(r.passed).toBe(false);
    expect(r.violations.some((v) => v.rule === "risk_gate_before_order" && v.severity === "block")).toBe(true);
  });

  it("passes execution.start_intent with preceding execution preflight", () => {
    const r = checkTrajectory(
      trace([
        { name: "execution.preflight_approved" },
        { name: "gateway.execution.start_intent" },
      ]),
    );
    expect(r.passed).toBe(true);
  });

  it("BLOCKS a fund transfer executed with no approval and no risk gate", () => {
    const r = checkTrajectory(trace([{ name: "wallet_transfer" }]));
    expect(r.passed).toBe(false);
    expect(r.violations.some((v) => v.rule === "denylist_without_approval" && v.severity === "block")).toBe(true);
  });

  it("WARNS on a doom loop (same tool fails 3x)", () => {
    const r = checkTrajectory(
      trace([
        { name: "get_news", ok: false },
        { name: "get_news", ok: false },
        { name: "get_news", ok: false },
      ]),
    );
    expect(r.violations.some((v) => v.rule === "no_doom_loop" && v.severity === "warn")).toBe(true);
    expect(r.passed).toBe(true); // warn only
  });

  it("WARNS when outcome is trade_executed but no order tool ran", () => {
    const r = checkTrajectory(trace([{ name: "get_market_data" }], { outcomeType: "trade_executed" }));
    expect(r.violations.some((v) => v.rule === "outcome_consistency")).toBe(true);
  });

  it("does not flag a clean analysis trajectory", () => {
    const r = checkTrajectory(
      trace([{ name: "get_market_data" }, { name: "compute_indicator" }], { outcomeType: "analysis_complete" }),
    );
    expect(r.passed).toBe(true);
    expect(r.violations.length).toBe(0);
  });
});

describe("checkScenarioAssertions (F2P / P2P)", () => {
  it("returns no violations when the scenario declares neither field", () => {
    const v = checkScenarioAssertions(trace([{ name: "place_market_order" }]), {});
    expect(v).toEqual([]);
  });

  it("BLOCKS when a required (expected) action never executed", () => {
    const v = checkScenarioAssertions(trace([{ name: "get_market_data" }]), {
      expectedActions: ["downsize"],
    });
    expect(v.some((x) => x.rule === "scenario_expected_action_missing" && x.severity === "block")).toBe(true);
  });

  it("passes when every expected action executed successfully", () => {
    const v = checkScenarioAssertions(
      trace([{ name: "downsize_position" }, { name: "close_trade" }]),
      { expectedActions: ["downsize", "close_trade"] },
    );
    expect(v).toEqual([]);
  });

  it("does NOT credit an expected action that failed", () => {
    const v = checkScenarioAssertions(
      trace([{ name: "downsize_position", ok: false }]),
      { expectedActions: ["downsize"] },
    );
    expect(v.some((x) => x.rule === "scenario_expected_action_missing")).toBe(true);
  });

  it("BLOCKS when a forbidden action appears (even if it failed)", () => {
    const v = checkScenarioAssertions(
      trace([{ name: "flip_short_order", ok: false }]),
      { forbiddenActions: ["flip_short"] },
    );
    expect(v.some((x) => x.rule === "scenario_forbidden_action_present" && x.severity === "block")).toBe(true);
  });

  it("passes when no forbidden action appears", () => {
    const v = checkScenarioAssertions(trace([{ name: "downsize_position" }]), {
      forbiddenActions: ["cancel_order", "flip_short"],
    });
    expect(v).toEqual([]);
  });
});

describe("checkTrajectory with scenario assertions", () => {
  it("folds an unmet expected-action into the block conjunction (passed=false)", () => {
    const r = checkTrajectory(
      trace([{ name: "classify_trade_risk" }, { name: "place_market_order" }]),
      { expectedActions: ["downsize"] },
    );
    expect(r.passed).toBe(false);
    expect(r.violations.some((v) => v.rule === "scenario_expected_action_missing")).toBe(true);
  });

  it("folds a forbidden-action into the block conjunction (passed=false)", () => {
    const r = checkTrajectory(
      trace([{ name: "classify_trade_risk" }, { name: "downsize_position" }, { name: "cancel_order" }]),
      { expectedActions: ["downsize"], forbiddenActions: ["cancel_order"] },
    );
    expect(r.passed).toBe(false);
    expect(r.violations.some((v) => v.rule === "scenario_forbidden_action_present")).toBe(true);
  });

  it("passes when expected present and forbidden absent", () => {
    const r = checkTrajectory(
      trace([{ name: "classify_trade_risk" }, { name: "downsize_position" }]),
      { expectedActions: ["downsize"], forbiddenActions: ["cancel_order", "flip_short"] },
    );
    expect(r.passed).toBe(true);
  });

  it("leaves global-rule behavior unchanged when no scenario is passed", () => {
    const r = checkTrajectory(trace([{ name: "place_market_order" }]));
    expect(r.passed).toBe(false);
    expect(r.violations.some((v) => v.rule === "risk_gate_before_order")).toBe(true);
    expect(r.violations.some((v) => v.rule.startsWith("scenario_"))).toBe(false);
  });
});

describe("computePassK", () => {
  it("'all' mode meets only when every run passes", () => {
    expect(computePassK([true, true, true]).meets).toBe(true);
    expect(computePassK([true, true, false]).meets).toBe(false);
    expect(computePassK([true, true, true]).allPass).toBe(true);
  });

  it("'majority' mode meets when more than half pass", () => {
    expect(computePassK([true, true, false], { mode: "majority" }).meets).toBe(true);
    expect(computePassK([true, false, false], { mode: "majority" }).meets).toBe(false);
  });

  it("'rate' mode meets at/above threshold", () => {
    const r = computePassK([true, true, true, true, false], { mode: "rate", threshold: 0.8 });
    expect(r.passRate).toBe(0.8);
    expect(r.meets).toBe(true);
    expect(computePassK([true, false], { mode: "rate", threshold: 0.8 }).meets).toBe(false);
  });

  it("reports passes / k / passRate", () => {
    const r = computePassK([true, false, true, true]);
    expect(r.k).toBe(4);
    expect(r.passes).toBe(3);
    expect(r.passRate).toBe(0.75);
  });

  it("passKFromChecks treats a block-violation run as a fail", () => {
    const good = checkTrajectory(trace([{ name: "classify_trade_risk" }, { name: "place_market_order" }]));
    const bad = checkTrajectory(trace([{ name: "place_market_order" }]));
    const r = passKFromChecks([good, good, bad]); // default "all"
    expect(r.passes).toBe(2);
    expect(r.meets).toBe(false);
  });
});
