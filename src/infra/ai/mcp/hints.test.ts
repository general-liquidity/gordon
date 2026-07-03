import { describe, it, expect } from "bun:test";
import {
  deriveToolHints,
  isReadOnlyTool,
  isDestructiveTool,
  isIdempotentTool,
  hitsOpenWorld,
} from "./hints.ts";
import { EXECUTION_DENY_LIST } from "./exposeServer.ts";

describe("deriveToolHints — read-only tools", () => {
  it("marks get_market_data readOnly + non-destructive", () => {
    const h = deriveToolHints("get_market_data");
    expect(h.readOnlyHint).toBe(true);
    expect(h.destructiveHint).toBe(false);
  });

  it("marks read tools (news / portfolio / account) read-only", () => {
    for (const id of [
      "get_news",
      "get_portfolio",
      "get_account_state",
      "get_fundamentals",
      "scan_market",
      "memory_search",
      "backtest",
    ]) {
      expect(isReadOnlyTool(id)).toBe(true);
      expect(isDestructiveTool(id)).toBe(false);
    }
  });

  it("read-only tools are trivially idempotent", () => {
    expect(deriveToolHints("get_market_data").idempotentHint).toBe(true);
  });
});

describe("deriveToolHints — destructive tools", () => {
  it("marks a deny-list tool destructive + not read-only", () => {
    const h = deriveToolHints("place_order");
    expect(h.destructiveHint).toBe(true);
    expect(h.readOnlyHint).toBe(false);
  });

  it("every EXECUTION_DENY_LIST tool derives destructiveHint:true", () => {
    for (const id of EXECUTION_DENY_LIST) {
      const h = deriveToolHints(id);
      expect(h.destructiveHint).toBe(true);
      expect(h.readOnlyHint).toBe(false);
    }
  });

  it("catches destructive shape even when not on the deny-list", () => {
    // Structural classification, not a hand-maintained parallel list.
    expect(isDestructiveTool("place_bracket_order")).toBe(true);
    expect(isDestructiveTool("withdraw_funds")).toBe(true);
  });

  it("place/execute orders are NOT idempotent; cancels ARE", () => {
    expect(isIdempotentTool("place_order")).toBe(false);
    expect(isIdempotentTool("execute_plan")).toBe(false);
    expect(isIdempotentTool("cancel_order")).toBe(true);
  });
});

describe("deriveToolHints — open-world classification", () => {
  it("marks a venue-hitting tool openWorld:true", () => {
    expect(deriveToolHints("get_market_data").openWorldHint).toBe(true);
    expect(deriveToolHints("get_news").openWorldHint).toBe(true);
    expect(deriveToolHints("place_order").openWorldHint).toBe(true);
  });

  it("marks pure local computation openWorld:false", () => {
    for (const id of [
      "compute_indicator",
      "compute_regime",
      "compute_risk",
      "compute_microstructure",
      "verify_plan",
      "create_plan",
      "memory_search",
      "audit_event",
    ]) {
      expect(hitsOpenWorld(id)).toBe(false);
    }
  });
});

describe("deriveToolHints — write-but-not-destructive tools", () => {
  it("marks plan/memory writes non-read-only and non-destructive", () => {
    for (const id of ["memory_write", "audit_event", "create_plan"]) {
      const h = deriveToolHints(id);
      expect(h.readOnlyHint).toBe(false);
      expect(h.destructiveHint).toBe(false);
    }
  });
});
