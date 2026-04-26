import { describe, it, expect } from "bun:test";
import {
  applyBubbleStampToRequest,
  bubbledRequestMetadata,
  buildBubbleStamper,
} from "./permissionBubble.ts";

describe("bubbledRequestMetadata", () => {
  it("emits bubbledFrom in metadata + a labelled prompt prefix", () => {
    const out = bubbledRequestMetadata({
      bubbledFrom: "fork:btc-analysis",
      forkTask: "scan BTC for breakouts",
    });
    expect(out.metadata?.bubbledFrom).toBe("fork:btc-analysis");
    expect(out.metadata?.forkTask).toBe("scan BTC for breakouts");
    expect(out.promptPrefix).toContain("fork:btc-analysis");
    expect(out.promptPrefix).toContain("scan BTC for breakouts");
  });

  it("omits forkTask metadata when not provided", () => {
    const out = bubbledRequestMetadata({ bubbledFrom: "fork:1" });
    expect(out.metadata?.forkTask).toBeUndefined();
    expect(out.promptPrefix).toBe("[fork fork:1]");
  });

  it("preserves inheritParentRules flag", () => {
    const a = bubbledRequestMetadata({ bubbledFrom: "f", inheritParentRules: false });
    expect(a.metadata?.inheritParentRules).toBe(false);
    const b = bubbledRequestMetadata({ bubbledFrom: "f", inheritParentRules: true });
    expect(b.metadata?.inheritParentRules).toBe(true);
  });
});

describe("buildBubbleStamper", () => {
  it("returns null when the request carries no agentId", () => {
    const stamper = buildBubbleStamper(() => ({ task: "x" }));
    expect(stamper({ toolName: "place_order" })).toBeNull();
  });

  it("returns null when lookup doesn't resolve the agent (= not a fork)", () => {
    const stamper = buildBubbleStamper(() => undefined);
    expect(stamper({ toolName: "place_order", agentId: "executor" })).toBeNull();
  });

  it("stamps when lookup resolves to a registered fork", () => {
    const stamper = buildBubbleStamper((id) =>
      id === "fork:1" ? { task: "analyze BTC" } : undefined,
    );
    const out = stamper({ toolName: "place_order", agentId: "fork:1" });
    expect(out).not.toBeNull();
    expect(out?.metadata?.bubbledFrom).toBe("fork:1");
    expect(out?.metadata?.forkTask).toBe("analyze BTC");
  });
});

describe("applyBubbleStampToRequest", () => {
  it("merges metadata and prefixes reason", () => {
    const request: { reason: string; metadata: Record<string, unknown> } = {
      reason: "approval needed for place_order",
      metadata: { existing: true },
    };
    const stamp = bubbledRequestMetadata({
      bubbledFrom: "fork:7",
      forkTask: "rebalance",
    });
    const merged = applyBubbleStampToRequest(request, stamp);
    expect(merged.metadata?.existing).toBe(true);
    expect(merged.metadata?.bubbledFrom).toBe("fork:7");
    expect(merged.reason).toContain("[fork fork:7");
    expect(merged.reason).toContain("approval needed for place_order");
  });

  it("returns a new object — does not mutate the input", () => {
    const request = { reason: "x", metadata: { a: 1 } };
    const stamp = bubbledRequestMetadata({ bubbledFrom: "f" });
    const merged = applyBubbleStampToRequest(request, stamp);
    expect(merged).not.toBe(request);
    expect(request.metadata).toEqual({ a: 1 });
  });

  it("handles requests with no existing reason / metadata", () => {
    const stamp = bubbledRequestMetadata({ bubbledFrom: "f" });
    const empty: { reason?: string; metadata?: Record<string, unknown> } = {};
    const merged = applyBubbleStampToRequest(empty, stamp);
    expect(merged.reason).toBe("[fork f]");
    expect(merged.metadata?.bubbledFrom).toBe("f");
  });
});
