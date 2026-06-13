import { describe, expect, test } from "bun:test";
import { triageExecution } from "./executionTriage.ts";

describe("triageExecution", () => {
  test("empty / missing order list", () => {
    expect(triageExecution([]).summary).toBe("No orders placed.");
    expect(triageExecution(undefined).mustFix).toHaveLength(0);
  });

  test("a clean full fill lands in clean", () => {
    const t = triageExecution([{ status: "filled", filledQty: 1.0, requestedQty: 1.0 }]);
    expect(t.clean).toHaveLength(1);
    expect(t.needsReview).toHaveLength(0);
    expect(t.mustFix).toHaveLength(0);
  });

  test("a rejected order is MUST-FIX with its reason", () => {
    const t = triageExecution([{ status: "risk_rejected", reason: "Risk kernel rejected this trade" }]);
    expect(t.mustFix).toHaveLength(1);
    expect(t.mustFix[0]!.reason).toContain("Risk kernel");
  });

  test("success:false is MUST-FIX even without a status", () => {
    const t = triageExecution([{ success: false, error: "insufficient balance" }]);
    expect(t.mustFix).toHaveLength(1);
  });

  test("a partial fill is needs-review", () => {
    const t = triageExecution([{ status: "filled", filledQty: 0.6, requestedQty: 1.0 }]);
    expect(t.needsReview).toHaveLength(1);
    expect(t.needsReview[0]!.reason).toContain("partial fill 0.6/1");
  });

  test("zero fill on a non-rejected order is MUST-FIX", () => {
    const t = triageExecution([{ status: "open", filledQty: 0, requestedQty: 1 }]);
    expect(t.mustFix).toHaveLength(1);
    expect(t.mustFix[0]!.reason).toBe("no fill");
  });

  test("slippage beyond tolerance is needs-review", () => {
    const t = triageExecution([{ status: "filled", filledQty: 1, requestedQty: 1, averageEntry: 101, expectedPrice: 100 }]);
    expect(t.needsReview).toHaveLength(1);
    expect(t.needsReview[0]!.reason).toContain("slippage 100bps");
  });

  test("slippage within tolerance stays clean", () => {
    const t = triageExecution([{ status: "filled", filledQty: 1, requestedQty: 1, averageEntry: 100.2, expectedPrice: 100 }]);
    expect(t.clean).toHaveLength(1);
  });

  test("an unconfirmed/unknown status surfaces as needs-review, never silently clean", () => {
    expect(triageExecution([{ status: "pending" }]).needsReview).toHaveLength(1);
    expect(triageExecution([null]).needsReview).toHaveLength(1); // defensive: non-object
  });

  test("a mixed batch produces correct counts and a MUST-FIX-flagged summary", () => {
    const t = triageExecution([
      { status: "filled", filledQty: 1, requestedQty: 1 }, // clean (entry)
      { status: "filled", filledQty: 1, requestedQty: 1 }, // clean (stop)
      { status: "filled", filledQty: 0.5, requestedQty: 1 }, // review (partial target)
      { status: "rejected", reason: "min notional" }, // fix
    ]);
    expect(t.clean).toHaveLength(2);
    expect(t.needsReview).toHaveLength(1);
    expect(t.mustFix).toHaveLength(1);
    expect(t.summary).toContain("4 orders: 2 clean, 1 needs-review, 1 must-fix");
    expect(t.summary).toContain("MUST FIX");
  });

  test("respects a custom slippage tolerance", () => {
    const order = [{ status: "filled", filledQty: 1, requestedQty: 1, averageEntry: 100.3, expectedPrice: 100 }]; // 30bps
    expect(triageExecution(order).clean).toHaveLength(1); // default 50bps → clean
    expect(triageExecution(order, { slippageReviewBps: 20 }).needsReview).toHaveLength(1); // 30 > 20 → review
  });
});
