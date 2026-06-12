import { describe, expect, it } from "bun:test";
import {
  MODE_PERMISSIVENESS,
  evaluatePermissionModeTransition,
  isLiveCapable,
  isPermissionEscalation,
} from "./permissionModeFsm.ts";

describe("permissionModeFsm", () => {
  it("orders permission modes by permissiveness", () => {
    expect(MODE_PERMISSIVENESS.observe).toBeLessThan(MODE_PERMISSIVENESS.strict);
    expect(MODE_PERMISSIVENESS.strict).toBeLessThan(MODE_PERMISSIVENESS.plan);
    expect(MODE_PERMISSIVENESS.plan).toBeLessThan(MODE_PERMISSIVENESS.paper);
    expect(MODE_PERMISSIVENESS.paper).toBeLessThan(MODE_PERMISSIVENESS.ask);
    expect(MODE_PERMISSIVENESS.ask).toBeLessThan(MODE_PERMISSIVENESS.auto);
  });

  it("blocks escalations while approvals are pending", () => {
    const result = evaluatePermissionModeTransition({
      from: "strict",
      to: "auto",
      pendingApprovals: 1,
      isStreaming: false,
    });
    expect(result.allowed).toBe(false);
    expect(result.escalation).toBe(true);
    expect(result.reason).toContain("approval");
  });

  it("blocks escalations while streaming", () => {
    const result = evaluatePermissionModeTransition({
      from: "paper",
      to: "ask",
      pendingApprovals: 0,
      isStreaming: true,
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("streaming");
  });

  it("allows de-escalations even while busy", () => {
    const result = evaluatePermissionModeTransition({
      from: "auto",
      to: "strict",
      pendingApprovals: 3,
      isStreaming: true,
    });
    expect(result.allowed).toBe(true);
    expect(result.escalation).toBe(false);
  });

  it("classifies live-capable modes", () => {
    expect(isLiveCapable("ask")).toBe(true);
    expect(isLiveCapable("auto")).toBe(true);
    expect(isLiveCapable("paper")).toBe(false);
    expect(isPermissionEscalation("ask", "auto")).toBe(true);
  });
});
