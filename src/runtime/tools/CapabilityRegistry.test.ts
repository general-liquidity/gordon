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

  it("declares manage_flags as a system-mode write that cannot be auto-approved", () => {
    const registry = new CapabilityRegistry();
    const spec = registry.resolveToolSpec("manage_flags");

    // Name-regex inference put this at category "unknown" / scope "analysis.run",
    // which the permission classifier auto-allows — from a chat turn to
    // GORDON_ALLOW_LIVE with no approval.
    expect(spec.category).toBe("system");
    expect(spec.permissionScope).toBe("system.mode.write");
    expect(spec.riskClass).toBe("critical");
    expect(spec.sideEffectLevel).toBe("write");
  });

  it("fails closed on a tool that is neither declared nor matched by any pattern", () => {
    const registry = new CapabilityRegistry();
    const spec = registry.resolveToolSpec("zzz_unrecognized_widget");

    expect(spec.category).toBe("unknown");
    expect(spec.permissionScope).not.toBe("analysis.run");
    expect(spec.permissionScope).toBe("system.mode.write");
    expect(spec.sideEffectLevel).toBe("write");
  });

  it("keeps the regex fallback for tools the patterns already classify", () => {
    const registry = new CapabilityRegistry();

    expect(registry.resolveToolSpec("explain_rsi").permissionScope).toBe("analysis.run");
    expect(registry.resolveToolSpec("run_backtest").permissionScope).toBe("analysis.run");
    expect(registry.resolveToolSpec("get_price").permissionScope).toBe("market.read");
    expect(registry.resolveToolSpec("get_account_balance").permissionScope).toBe("portfolio.read");
  });
});
