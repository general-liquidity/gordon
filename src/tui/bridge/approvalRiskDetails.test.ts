import { describe, expect, test } from "bun:test";

import type { RiskAuditEntry, RiskCheck, RiskDecision } from "../../core/risk-kernel/audit.ts";
import {
  MAX_REASON_CHARS,
  MAX_RISK_REASONS,
  RISK_DETAIL_FRESHNESS_MS,
  buildApprovalRiskDetails,
  buildCounterOfferDenialReason,
  isOrderExecutionTool,
} from "./approvalRiskDetails.ts";

const REQUESTED_AT = "2026-06-11T12:00:00.000Z";

function check(overrides: Partial<RiskCheck>): RiskCheck {
  return {
    name: "position_size",
    passed: false,
    details: "Position size $5000.00 exceeds max $1000.00.",
    severity: "critical",
    ...overrides,
  };
}

function entry(overrides: {
  timestamp?: string;
  action?: RiskDecision["action"];
  checks?: RiskCheck[];
  modifiedQuantity?: number;
}): RiskAuditEntry {
  const action = overrides.action ?? "reject";
  const decision: RiskDecision = {
    approved: action !== "reject",
    action,
    originalOrder: {
      symbol: "BTCUSDT",
      side: "buy",
      type: "limit",
      quantity: 2,
      price: 50_000,
      exchangeId: "binance",
      agentId: "executor",
    },
    ...(overrides.modifiedQuantity !== undefined
      ? {
          modifiedOrder: {
            symbol: "BTCUSDT",
            side: "buy" as const,
            type: "limit" as const,
            quantity: overrides.modifiedQuantity,
            price: 50_000,
            exchangeId: "binance",
            agentId: "executor",
          },
        }
      : {}),
    checks: overrides.checks ?? [check({})],
    reason: "test",
    timestamp: overrides.timestamp ?? REQUESTED_AT,
  };
  return {
    id: "ra_test",
    timestamp: overrides.timestamp ?? REQUESTED_AT,
    order: decision.originalOrder,
    decision,
    portfolioSnapshot: {} as RiskAuditEntry["portfolioSnapshot"],
  };
}

describe("isOrderExecutionTool", () => {
  test("matches order-placing tools", () => {
    expect(isOrderExecutionTool("place_order")).toBe(true);
    expect(isOrderExecutionTool("execute_trade")).toBe(true);
    expect(isOrderExecutionTool("execute_plan")).toBe(true);
    expect(isOrderExecutionTool("create_order")).toBe(true);
  });

  test("excludes cancels and read tools", () => {
    expect(isOrderExecutionTool("cancel_order")).toBe(false);
    expect(isOrderExecutionTool("cancel_all_orders")).toBe(false);
    expect(isOrderExecutionTool("get_market_data")).toBe(false);
    expect(isOrderExecutionTool("compute_indicator")).toBe(false);
  });
});

describe("buildApprovalRiskDetails", () => {
  test("returns undefined for non-order tools", () => {
    const details = buildApprovalRiskDetails([entry({})], {
      toolName: "get_market_data",
      requestedAt: REQUESTED_AT,
    });
    expect(details).toBeUndefined();
  });

  test("returns undefined when no entry is fresh", () => {
    const stale = new Date(
      new Date(REQUESTED_AT).getTime() - RISK_DETAIL_FRESHNESS_MS - 60_000,
    ).toISOString();
    const details = buildApprovalRiskDetails([entry({ timestamp: stale })], {
      toolName: "place_order",
      requestedAt: REQUESTED_AT,
    });
    expect(details).toBeUndefined();
  });

  test("returns undefined when the decision had nothing to flag", () => {
    const details = buildApprovalRiskDetails(
      [entry({ action: "approve", checks: [check({ passed: true, severity: "info" })] })],
      { toolName: "place_order", requestedAt: REQUESTED_AT },
    );
    expect(details).toBeUndefined();
  });

  test("surfaces top 3 failed-check reasons, critical first", () => {
    const checks: RiskCheck[] = [
      check({ name: "daily_loss_limit", severity: "warning", details: "warning A" }),
      check({
        name: "leverage_limit",
        severity: "critical",
        details: "Effective leverage 4.20x would exceed max 2x.",
      }),
      check({ name: "liquidity", severity: "warning", details: "warning B" }),
      check({
        name: "position_size",
        severity: "critical",
        details: "Position size $5000.00 exceeds max $1000.00.",
      }),
      check({
        name: "correlation",
        passed: true,
        severity: "info",
        details: "passed — must not appear",
      }),
    ];
    const details = buildApprovalRiskDetails([entry({ checks })], {
      toolName: "place_order",
      requestedAt: REQUESTED_AT,
    });
    expect(details).toBeDefined();
    expect(details!.riskReasons).toHaveLength(MAX_RISK_REASONS);
    expect(details!.riskReasons[0]).toContain("leverage 4.20x");
    expect(details!.riskReasons[1]).toContain("Position size");
    expect(details!.riskReasons[2]).toBe("warning A");
    expect(details!.riskReasons.join(" ")).not.toContain("must not appear");
  });

  test("truncates long reasons gracefully", () => {
    const long = "x".repeat(MAX_REASON_CHARS * 2);
    const details = buildApprovalRiskDetails([entry({ checks: [check({ details: long })] })], {
      toolName: "place_order",
      requestedAt: REQUESTED_AT,
    });
    expect(details!.riskReasons[0]!.length).toBeLessThanOrEqual(MAX_REASON_CHARS);
    expect(details!.riskReasons[0]!.endsWith("…")).toBe(true);
  });

  test("extracts the kernel's counter-offer from a modify decision", () => {
    const details = buildApprovalRiskDetails([entry({ action: "modify", modifiedQuantity: 0.5 })], {
      toolName: "place_order",
      requestedAt: REQUESTED_AT,
    });
    expect(details!.counterOffer).toEqual({
      symbol: "BTCUSDT",
      side: "buy",
      originalQuantity: 2,
      adjustedQuantity: 0.5,
    });
  });

  test("no counter-offer for reject decisions without a modified order", () => {
    const details = buildApprovalRiskDetails([entry({ action: "reject" })], {
      toolName: "place_order",
      requestedAt: REQUESTED_AT,
    });
    expect(details!.counterOffer).toBeUndefined();
    expect(details!.riskReasons.length).toBeGreaterThan(0);
  });

  test("uses the most recent fresh entry (entries are DESC)", () => {
    const older = new Date(new Date(REQUESTED_AT).getTime() - 60_000).toISOString();
    const entries = [
      entry({ action: "modify", modifiedQuantity: 0.5 }),
      entry({ timestamp: older, action: "reject" }),
    ];
    const details = buildApprovalRiskDetails(entries, {
      toolName: "place_order",
      requestedAt: REQUESTED_AT,
    });
    expect(details!.counterOffer?.adjustedQuantity).toBe(0.5);
  });
});

describe("buildCounterOfferDenialReason", () => {
  test("includes the adjusted size and a no-retry instruction", () => {
    const reason = buildCounterOfferDenialReason({
      symbol: "BTCUSDT",
      side: "buy",
      originalQuantity: 2,
      adjustedQuantity: 0.5,
    });
    expect(reason).toContain("BTCUSDT");
    expect(reason).toContain("0.5");
    expect(reason).toContain("reduced from 2");
    expect(reason).toContain("Do not retry the original size");
  });

  test("fails closed with a generic instruction when no counter-offer attached", () => {
    const reason = buildCounterOfferDenialReason(undefined);
    expect(reason).toContain("Do not retry the original size");
  });
});
