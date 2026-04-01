import { describe, expect, it } from "bun:test";
import { WorkerRegistry } from "./WorkerRegistry.ts";

describe("WorkerRegistry", () => {
  it("enforces allowed handoffs", () => {
    const registry = new WorkerRegistry();
    expect(registry.canHandoff("Planner", "Executor")).toBe(true);
    expect(registry.canHandoff("Teacher", "Executor")).toBe(false);
  });
});
