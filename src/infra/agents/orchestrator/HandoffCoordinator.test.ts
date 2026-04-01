import { describe, expect, it } from "bun:test";
import { HandoffCoordinator } from "./HandoffCoordinator.ts";

describe("HandoffCoordinator", () => {
  it("allows valid finance-native handoffs", () => {
    const coordinator = new HandoffCoordinator();
    const validation = coordinator.validate("Planner", "Executor", {
      mode: "ARMED",
      handoffBudget: {
        maxNotionalUsd: 10_000,
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      },
    });
    expect(validation.valid).toBe(true);
  });

  it("blocks invalid handoffs", () => {
    const coordinator = new HandoffCoordinator();
    const validation = coordinator.validate("Teacher", "Executor", { mode: "ARMED" });
    expect(validation.valid).toBe(false);
  });
});
