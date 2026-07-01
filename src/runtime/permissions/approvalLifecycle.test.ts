import { describe, expect, it } from "bun:test";
import { ApprovalLifecycleLedger } from "./approvalLifecycle.ts";

describe("ApprovalLifecycleLedger", () => {
  it("records an approval as pending until implemented", () => {
    const ledger = new ApprovalLifecycleLedger();
    ledger.recordApproval({ id: "tighten-max-pos", subject: "max position 5%", approvedAt: 100 });

    const pending = ledger.pendingImplementation();
    expect(pending).toHaveLength(1);
    expect(pending[0]!.id).toBe("tighten-max-pos");
    expect(pending[0]!.state).toBe("approved");
    expect(pending[0]!.implementedAt).toBeUndefined();
  });

  it("re-surfaces the same approval across repeated queries until markImplemented", () => {
    const ledger = new ApprovalLifecycleLedger();
    ledger.recordApproval({ id: "a", subject: "change A", approvedAt: 1 });

    expect(ledger.pendingImplementation().map((r) => r.id)).toEqual(["a"]);
    // Querying again does not consume it.
    expect(ledger.pendingImplementation().map((r) => r.id)).toEqual(["a"]);

    const impl = ledger.markImplemented("a", 50);
    expect(impl?.state).toBe("implemented");
    expect(impl?.implementedAt).toBe(50);
    expect(ledger.pendingImplementation()).toHaveLength(0);
  });

  it("transitions Approved -> Implemented and records implementedAt", () => {
    const ledger = new ApprovalLifecycleLedger();
    ledger.recordApproval({ id: "x", subject: "x", approvedAt: 10, approvedBy: "operator" });
    const before = ledger.get("x");
    expect(before?.state).toBe("approved");

    ledger.markImplemented("x", 20);
    const after = ledger.get("x");
    expect(after?.state).toBe("implemented");
    expect(after?.implementedAt).toBe(20);
    expect(after?.approvedBy).toBe("operator");
  });

  it("sorts pending items oldest-approval-first", () => {
    const ledger = new ApprovalLifecycleLedger();
    ledger.recordApproval({ id: "new", subject: "n", approvedAt: 300 });
    ledger.recordApproval({ id: "old", subject: "o", approvedAt: 100 });
    ledger.recordApproval({ id: "mid", subject: "m", approvedAt: 200 });

    expect(ledger.pendingImplementation().map((r) => r.id)).toEqual(["old", "mid", "new"]);
  });

  it("markImplemented on an unknown id returns undefined and adds nothing", () => {
    const ledger = new ApprovalLifecycleLedger();
    expect(ledger.markImplemented("nope", 5)).toBeUndefined();
    expect(ledger.list()).toHaveLength(0);
  });

  it("markImplemented is idempotent and preserves the original implementedAt", () => {
    const ledger = new ApprovalLifecycleLedger();
    ledger.recordApproval({ id: "a", subject: "a", approvedAt: 1 });
    ledger.markImplemented("a", 50);
    const second = ledger.markImplemented("a", 999);
    expect(second?.implementedAt).toBe(50);
  });

  it("does not reopen an implemented item when re-recorded", () => {
    const ledger = new ApprovalLifecycleLedger();
    ledger.recordApproval({ id: "a", subject: "a", approvedAt: 1 });
    ledger.markImplemented("a", 50);

    ledger.recordApproval({ id: "a", subject: "a restated", approvedAt: 100 });
    const rec = ledger.get("a");
    expect(rec?.state).toBe("implemented");
    expect(rec?.subject).toBe("a");
    expect(ledger.pendingImplementation()).toHaveLength(0);
  });

  it("restates a still-pending approval without losing its queue position", () => {
    const ledger = new ApprovalLifecycleLedger();
    ledger.recordApproval({ id: "a", subject: "first", approvedAt: 10, metadata: { v: 1 } });
    ledger.recordApproval({ id: "a", subject: "second", approvedAt: 15, metadata: { v: 2 } });

    const pending = ledger.pendingImplementation();
    expect(pending).toHaveLength(1);
    expect(pending[0]!.subject).toBe("second");
    expect(pending[0]!.approvedAt).toBe(15);
    expect(pending[0]!.metadata).toEqual({ v: 2 });
  });

  it("reset clears all records", () => {
    const ledger = new ApprovalLifecycleLedger();
    ledger.recordApproval({ id: "a", subject: "a", approvedAt: 1 });
    ledger.reset();
    expect(ledger.list()).toHaveLength(0);
  });
});
