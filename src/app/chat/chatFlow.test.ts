import { describe, expect, it } from "bun:test";

import {
  appendPendingApprovalMessages,
  hasConversationMomentum,
  shouldShowInlineQuickActions,
} from "./chatFlow.ts";
import type { RuntimeApprovalRequest } from "../../runtime/contracts/types.ts";

function createApproval(overrides: Partial<RuntimeApprovalRequest> = {}): RuntimeApprovalRequest {
  return {
    id: "approval-12345678",
    toolName: "place_market_order",
    permissionScope: "livetrade.execute",
    approvalClass: "per_action",
    riskClass: "high",
    sideEffectLevel: "execution",
    runtimeId: "app",
    fingerprint: "fingerprint-1",
    status: "pending",
    requestedAt: "2026-04-02T12:34:00.000Z",
    ...overrides,
  };
}

describe("chat flow helpers", () => {
  it("projects pending approvals into approval-ticket transcript messages", () => {
    const messages = appendPendingApprovalMessages(
      [{ role: "user", content: "buy BTC", timestamp: "12:33 PM" }],
      [createApproval({ reason: "Live order requires approval" })],
    );

    expect(messages).toHaveLength(2);
    expect(messages[1]?.variant).toBe("approval");
    expect(messages[1]?.badge).toBe("12345678");
    expect(messages[1]?.content).toContain("Approve: `approve 12345678`");
    expect(messages[1]?.content).toContain("Live order requires approval");
  });

  it("treats an active back-and-forth as conversation momentum", () => {
    expect(hasConversationMomentum([])).toBe(false);
    expect(hasConversationMomentum([{ role: "user", content: "scan btc" }])).toBe(false);
    expect(hasConversationMomentum([
      { role: "user", content: "scan btc" },
      { role: "gordon", content: "Scanning now." },
    ])).toBe(true);
  });

  it("only shows inline quick actions before the thread has momentum", () => {
    expect(shouldShowInlineQuickActions({
      disabled: false,
      busy: false,
      value: "",
      hasConversationMomentum: false,
    })).toBe(true);

    expect(shouldShowInlineQuickActions({
      disabled: false,
      busy: false,
      value: "",
      hasConversationMomentum: true,
    })).toBe(false);
  });
});
