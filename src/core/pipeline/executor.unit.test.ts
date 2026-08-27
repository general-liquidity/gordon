import { describe, expect, it } from "bun:test";
import {
  generateClientOrderId,
  generateDeterministicClientOrderId,
  isPlanExpired,
  roundPrice,
  roundQuantity,
} from "./executor.ts";
import type { Plan } from "../../types/index.ts";

describe("executor unit helpers", () => {
  it("generateClientOrderId includes plan fragment and type", () => {
    const id = generateClientOrderId("plan-abc12345", "entry");
    expect(id).toStartWith("gordon_");
    expect(id).toContain("_entry_");
  });

  it("generateDeterministicClientOrderId is stable per plan and type", () => {
    const a = generateDeterministicClientOrderId("plan12345678", "stop");
    const b = generateDeterministicClientOrderId("plan12345678", "stop");
    expect(a).toBe(b);
    expect(a).toBe("gordon_12345678_stop");
  });

  it("roundQuantity floors to precision", () => {
    expect(roundQuantity(1.234567891, 4)).toBe(1.2345);
  });

  it("roundPrice rounds to precision", () => {
    expect(roundPrice(1.234567891, 4)).toBe(1.2346);
  });

  it("isPlanExpired respects explicit expiresAt", () => {
    const expired = {
      id: "plan-1",
      createdAt: new Date(Date.now() - 60_000).toISOString(),
      expiresAt: new Date(Date.now() - 1_000).toISOString(),
    } as Plan & { expiresAt: string };
    expect(isPlanExpired(expired)).toBe(true);
  });

  it("isPlanExpired is false for fresh plans", () => {
    const fresh = {
      id: "plan-2",
      createdAt: new Date().toISOString(),
    } as Plan;
    expect(isPlanExpired(fresh)).toBe(false);
  });
});
