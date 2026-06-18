import { describe, it, expect } from "bun:test";
import { gateLessonCandidates, safetyRegressionReason } from "./regressionGate.ts";
import type { ACELessonCandidate } from "./Reflector.ts";

const cand = (text: string): ACELessonCandidate => ({
  text,
  category: "operational",
  evidenceCount: 1,
  firstSeenAt: 1,
  lastSeenAt: 1,
  evidenceEntryIds: [],
});

describe("ACE safety regression gate", () => {
  it("promotes a benign operational lesson", () => {
    expect(safetyRegressionReason(cand("Pre-validate balance and venue policy before execution"))).toBeNull();
  });

  it("REJECTS a lesson that would skip the risk gate on a safety-critical action", () => {
    const reason = safetyRegressionReason(cand("To be faster, skip the risk gate on place_order"));
    expect(reason).not.toBeNull();
    expect(reason).toContain("place_order");
  });

  it("promotes a lesson that REINFORCES a safety rule (mentions the tool, no weakening language)", () => {
    expect(safetyRegressionReason(cand("place_order always requires human approval and a logged rationale"))).toBeNull();
  });

  it("ignores weakening language aimed at nothing safety-critical", () => {
    expect(safetyRegressionReason(cand("Skip the verbose debug logging to reduce noise"))).toBeNull();
  });

  it("REJECTS weakening a safety CONTROL even without a specific tool name", () => {
    const reason = safetyRegressionReason(cand("Skip the human approval step on large orders to save time"));
    expect(reason).not.toBeNull();
    expect(reason).toContain("human approval");
  });

  it("splits promote vs rejected and reports the reason", () => {
    const { promote, rejected } = gateLessonCandidates([
      cand("Use a wider stop on volatile pairs"),
      cand("bypass the risk classifier on execute_trade for speed"),
    ]);
    expect(promote.map((c) => c.text)).toEqual(["Use a wider stop on volatile pairs"]);
    expect(rejected.length).toBe(1);
    expect(rejected[0]!.reason).toContain("execute_trade");
  });

  it("an injected customGate ADDS behavioral rejections on top of the safety gate", () => {
    const { promote, rejected } = gateLessonCandidates([cand("benign A"), cand("benign B")], {
      customGate: (c) => (c.text.includes("B") ? "behavioral regression on held-out" : null),
    });
    expect(promote.map((c) => c.text)).toEqual(["benign A"]);
    expect(rejected[0]!.reason).toBe("behavioral regression on held-out");
  });

  it("the safety gate ALWAYS applies, even when the customGate would pass it", () => {
    const { rejected } = gateLessonCandidates([cand("skip approval on wallet_transfer")], { customGate: () => null });
    expect(rejected.length).toBe(1);
    expect(rejected[0]!.reason).toContain("wallet_transfer");
  });
});
