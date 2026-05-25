/**
 * Tests for the rule-override audit helpers + adherence aggregator
 * (Gaps 1 + 2).
 *
 * Uses Bun's bun:test + an in-memory SQLite via the existing storage
 * abstraction. Each test creates a fresh DB path so the audit table
 * starts empty, avoiding cross-test bleed.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  getAdherenceReport,
  recordRuleOverride,
  summarizeAdherenceReport,
} from "./ruleOverride.ts";
import { auditLog } from "./audit-log.ts";
import { setDatabasePathForTesting } from "../../storage/database.ts";

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "gordon-adherence-test-"));
  // Point storage to a fresh DB file per test; setDatabasePathForTesting
  // closes any prior dbInstance so the next getDatabase() re-opens the
  // new path. Each test gets an empty audit_log.
  setDatabasePathForTesting(join(tmpDir, "gordon.sqlite"));
});

afterEach(() => {
  setDatabasePathForTesting(null);
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

describe("Gap 1 — recordRuleOverride", () => {
  test("inserts an audit entry with RULE_OVERRIDE action", () => {
    const entry = recordRuleOverride("test-user", {
      action: "place_market_order",
      originalRecommendation: "require_confirmation",
      originalTier: "high",
      rationale: "operator confirmed despite high volatility — sized down to 0.5x",
      symbol: "BTC",
    });
    expect(entry.action).toBe("RULE_OVERRIDE");
    expect(entry.result).toBe("SUCCESS");
    expect(entry.parameters).toMatchObject({
      action: "place_market_order",
      originalRecommendation: "require_confirmation",
      symbol: "BTC",
    });
  });

  test("rejects rationale shorter than 10 chars", () => {
    expect(() =>
      recordRuleOverride("test-user", {
        action: "place_market_order",
        originalRecommendation: "block",
        rationale: "yolo",
      }),
    ).toThrow(/at least 10 chars/);
  });

  test("captures originalTier in metadata", () => {
    const entry = recordRuleOverride("test-user", {
      action: "execute_plan",
      originalRecommendation: "block",
      originalTier: "critical",
      rationale: "constitution rule overridden after operator review of facts",
    });
    expect(entry.metadata?.tier).toBe("critical");
    expect(entry.metadata?.severity).toBe("block");
  });

  test("accepts constitutionRules + tradeId/planId", () => {
    const entry = recordRuleOverride(
      "test-user",
      {
        action: "execute_plan",
        originalRecommendation: "block",
        originalTier: "critical",
        rationale: "ten-character-minimum rationale passes",
        constitutionRules: ["max_position_pct", "daily_loss_limit"],
      },
      { tradeId: "trade-123", planId: "plan-456" },
    );
    expect(entry.tradeId).toBe("trade-123");
    expect(entry.planId).toBe("plan-456");
    const params = entry.parameters as Record<string, unknown>;
    expect(params.constitutionRules).toEqual(["max_position_pct", "daily_loss_limit"]);
  });
});

describe("Gap 2 — getAdherenceReport", () => {
  test("empty audit log returns zero-state report", () => {
    const report = getAdherenceReport();
    expect(report.tradesExecuted).toBe(0);
    expect(report.overrides).toBe(0);
    expect(report.deviationRate).toBeNull();
    expect(report.overrideList).toEqual([]);
  });

  test("counts trade executions vs overrides", () => {
    // Three successful trades, one override
    auditLog.record("test-user", "EXECUTE_PLAN", { planId: "p1" }, "SUCCESS");
    auditLog.record("test-user", "EXECUTE_PLAN", { planId: "p2" }, "SUCCESS");
    auditLog.record("test-user", "CLOSE_TRADE", { tradeId: "t1" }, "SUCCESS");
    recordRuleOverride("test-user", {
      action: "place_market_order",
      originalRecommendation: "require_confirmation",
      rationale: "operator confirmed despite warning",
      symbol: "ETH",
    });
    const report = getAdherenceReport();
    expect(report.tradesExecuted).toBe(3);
    expect(report.overrides).toBe(1);
    expect(report.deviationRate).toBeCloseTo(1 / 3, 3);
  });

  test("severity breakdown is correct", () => {
    recordRuleOverride("u", {
      action: "place_market_order",
      originalRecommendation: "prompt_user",
      rationale: "first ten characters min",
    });
    recordRuleOverride("u", {
      action: "place_market_order",
      originalRecommendation: "block",
      rationale: "operator overrode despite block",
    });
    recordRuleOverride("u", {
      action: "place_market_order",
      originalRecommendation: "block",
      rationale: "second block override on a different setup",
    });
    const report = getAdherenceReport();
    expect(report.bySeverity.block).toBe(2);
    expect(report.bySeverity.prompt_user).toBe(1);
    expect(report.bySeverity.require_confirmation).toBe(0);
  });

  test("overrideList contains rationales", () => {
    recordRuleOverride("u", {
      action: "execute_plan",
      originalRecommendation: "require_confirmation",
      rationale: "mandate breach but operator approved with size reduction",
      symbol: "SOL",
    });
    const report = getAdherenceReport();
    expect(report.overrideList).toHaveLength(1);
    expect(report.overrideList[0]?.rationale).toContain("operator approved");
    expect(report.overrideList[0]?.symbol).toBe("SOL");
  });

  test("startTime/endTime window filtering", () => {
    // Insert one override now
    recordRuleOverride("u", {
      action: "place_market_order",
      originalRecommendation: "block",
      rationale: "happened today, should appear in today window",
    });
    // Query a window in the FUTURE — should see zero overrides
    const future = new Date(Date.now() + 86_400_000).toISOString();
    const farFuture = new Date(Date.now() + 2 * 86_400_000).toISOString();
    const report = getAdherenceReport({ startTime: future, endTime: farFuture });
    expect(report.overrides).toBe(0);
  });

  test("filters by userId when supplied", () => {
    recordRuleOverride("alice", {
      action: "place_market_order",
      originalRecommendation: "block",
      rationale: "alice overrode after careful review",
    });
    recordRuleOverride("bob", {
      action: "place_market_order",
      originalRecommendation: "block",
      rationale: "bob also overrode but in another flow",
    });
    const aliceReport = getAdherenceReport({ userId: "alice" });
    expect(aliceReport.overrides).toBe(1);
    expect(aliceReport.overrideList[0]?.auditId).toBeDefined();
  });
});

describe("Gap 2 — summarizeAdherenceReport", () => {
  test("zero-state message", () => {
    const report = getAdherenceReport();
    const summary = summarizeAdherenceReport(report);
    expect(summary).toContain("no trades executed");
  });

  test("trades + overrides with deviation rate", () => {
    auditLog.record("u", "EXECUTE_PLAN", {}, "SUCCESS");
    auditLog.record("u", "EXECUTE_PLAN", {}, "SUCCESS");
    recordRuleOverride("u", {
      action: "place_market_order",
      originalRecommendation: "block",
      rationale: "operator override with concrete rationale",
    });
    const report = getAdherenceReport();
    const summary = summarizeAdherenceReport(report);
    expect(summary).toMatch(/2 trades executed/);
    expect(summary).toMatch(/1 rule-override/);
    expect(summary).toMatch(/50\.0% deviation rate/);
    expect(summary).toContain("block");
  });

  test("singular vs plural grammar", () => {
    auditLog.record("u", "EXECUTE_PLAN", {}, "SUCCESS");
    recordRuleOverride("u", {
      action: "place_market_order",
      originalRecommendation: "block",
      rationale: "singular grammar check rationale",
    });
    const report = getAdherenceReport();
    const summary = summarizeAdherenceReport(report);
    expect(summary).toMatch(/1 trade executed/);
    expect(summary).not.toMatch(/1 trades/);
    expect(summary).toMatch(/1 rule-override(?:[,. ]|$)/);
  });
});
