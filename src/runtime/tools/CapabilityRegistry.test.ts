import { describe, expect, it } from "bun:test";
import { CapabilityRegistry } from "./CapabilityRegistry.ts";

describe("CapabilityRegistry", () => {
  it("classifies execution tools as high-risk armed actions", () => {
    const registry = new CapabilityRegistry();
    const spec = registry.resolveToolSpec("place_market_order");
    expect(spec.category).toBe("execution");
    expect(spec.permissionScope).toBe("livetrade.execute");
    expect(spec.requiresTradePermission).toBe(true);
    expect(spec.workerRole).toBe("Executor");
  });

  it("classifies market scans as read-only scanner work", () => {
    const registry = new CapabilityRegistry();
    const spec = registry.resolveToolSpec("scan_market");
    expect(spec.category).toBe("market");
    expect(spec.permissionScope).toBe("market.read");
    expect(spec.workerRole).toBe("Scanner");
  });

  it("adds explicit runtime-safe specs for built-in command handlers", () => {
    const registry = new CapabilityRegistry();
    const mcp = registry.resolveToolSpec("handle_mcp_command");
    const positions = registry.resolveToolSpec("check_positions");

    expect(mcp.permissionScope).toBe("mcp.connect");
    expect(mcp.riskClass).toBe("high");
    expect(positions.permissionScope).toBe("portfolio.read");
    expect(positions.workerRole).toBe("Monitor");
  });
});
