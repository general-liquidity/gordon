import { describe, expect, it } from "bun:test";
import {
  PLAN_TIERS,
  DEFAULT_PLAN,
  planRank,
  comparePlans,
  planAtLeast,
} from "./entitlements.ts";

describe("planRank", () => {
  it("ranks known tiers in ascending order", () => {
    expect(planRank("free")).toBe(0);
    expect(planRank("starter")).toBe(1);
    expect(planRank("pro")).toBe(2);
    expect(planRank("enterprise")).toBe(3);
  });

  it("is case-insensitive and trims whitespace", () => {
    expect(planRank("  PRO  ")).toBe(2);
    expect(planRank("Enterprise")).toBe(3);
  });

  it("treats unknown / empty values as the base tier (rank 0)", () => {
    expect(planRank(undefined)).toBe(0);
    expect(planRank(null)).toBe(0);
    expect(planRank("")).toBe(0);
    expect(planRank("mystery-tier")).toBe(0);
  });

  it("keeps DEFAULT_PLAN at the base of the ordering", () => {
    expect(planRank(DEFAULT_PLAN)).toBe(0);
    expect(PLAN_TIERS[0] as string).toBe(DEFAULT_PLAN);
  });
});

describe("comparePlans", () => {
  it("orders lower tier before higher tier", () => {
    expect(comparePlans("free", "pro")).toBe(-1);
    expect(comparePlans("pro", "free")).toBe(1);
    expect(comparePlans("pro", "pro")).toBe(0);
  });
});

describe("planAtLeast", () => {
  it("passes when the plan meets or exceeds the tier", () => {
    expect(planAtLeast("pro", "pro")).toBe(true);
    expect(planAtLeast("enterprise", "pro")).toBe(true);
  });

  it("fails when the plan is below the tier", () => {
    expect(planAtLeast("free", "pro")).toBe(false);
    expect(planAtLeast(undefined, "starter")).toBe(false);
  });

  it("unknown plan never unlocks anything above base", () => {
    expect(planAtLeast("mystery", "starter")).toBe(false);
    expect(planAtLeast("mystery", "free")).toBe(true);
  });
});
