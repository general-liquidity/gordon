import { describe, expect, it } from "bun:test";
import { ClaimLeaseManager, type ClaimToken } from "./ClaimLease.ts";

describe("ClaimLeaseManager", () => {
  it("grants a first claim with fencing token 1", () => {
    const mgr = new ClaimLeaseManager();
    const res = mgr.claim("unit-a", 1000, 500, "worker-1");
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.token.token).toBe(1);
      expect(res.token.workUnit).toBe("unit-a");
      expect(res.token.expiresAt).toBe(1500);
      expect(res.token.holder).toBe("worker-1");
    }
  });

  it("rejects a second claim while the lease is still valid", () => {
    const mgr = new ClaimLeaseManager();
    mgr.claim("unit-a", 1000, 500, "worker-1");
    const res = mgr.claim("unit-a", 1200, 500, "worker-2");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.current?.token).toBe(1);
  });

  it("allows re-claim after expiry and mints a higher fencing token", () => {
    const mgr = new ClaimLeaseManager();
    const first = mgr.claim("unit-a", 1000, 500, "worker-1");
    const res = mgr.claim("unit-a", 1600, 500, "worker-2");
    expect(res.ok).toBe(true);
    if (res.ok && first.ok) {
      expect(res.token.token).toBe(first.token.token + 1);
      expect(res.token.holder).toBe("worker-2");
    }
  });

  it("rejects a superseded fencing token on renew", () => {
    const mgr = new ClaimLeaseManager();
    const first = mgr.claim("unit-a", 1000, 500, "worker-1")!;
    const stale = first.ok ? first.token : ({} as ClaimToken);
    // worker-2 takes over after expiry -> token 2 supersedes token 1.
    mgr.claim("unit-a", 1600, 500, "worker-2");

    const res = mgr.renew(stale, 1700, 500);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.reason).toContain("superseded");
      expect(res.current?.token).toBe(2);
    }
  });

  it("renews a valid lease and extends expiry keeping the same token", () => {
    const mgr = new ClaimLeaseManager();
    const first = mgr.claim("unit-a", 1000, 500, "worker-1");
    if (!first.ok) throw new Error("claim failed");
    const res = mgr.renew(first.token, 1200, 500);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.token.token).toBe(1);
      expect(res.token.expiresAt).toBe(1700);
    }
  });

  it("rejects renewing an already-expired lease", () => {
    const mgr = new ClaimLeaseManager();
    const first = mgr.claim("unit-a", 1000, 500, "worker-1");
    if (!first.ok) throw new Error("claim failed");
    const res = mgr.renew(first.token, 1600, 500);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toContain("expired");
  });

  it("isValid is true only for the current, unexpired token", () => {
    const mgr = new ClaimLeaseManager();
    const first = mgr.claim("unit-a", 1000, 500, "worker-1");
    if (!first.ok) throw new Error("claim failed");
    expect(mgr.isValid(first.token, 1200)).toBe(true);
    expect(mgr.isValid(first.token, 1600)).toBe(false); // expired

    mgr.claim("unit-a", 1600, 500, "worker-2");
    expect(mgr.isValid(first.token, 1700)).toBe(false); // superseded
  });

  it("reconcileExpired reports lapsed leases without resetting the counter", () => {
    const mgr = new ClaimLeaseManager();
    mgr.claim("unit-a", 1000, 500, "worker-1");
    mgr.claim("unit-b", 1000, 5000, "worker-2");

    const expired = mgr.reconcileExpired(1600);
    expect(expired.map((t) => t.workUnit)).toEqual(["unit-a"]);

    // Counter preserved: next claim on unit-a is token 2, not a reset to 1.
    const res = mgr.claim("unit-a", 1700, 500, "worker-3");
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.token.token).toBe(2);
  });

  it("currentToken returns the latest token regardless of validity", () => {
    const mgr = new ClaimLeaseManager();
    mgr.claim("unit-a", 1000, 500, "worker-1");
    expect(mgr.currentToken("unit-a")?.token).toBe(1);
    expect(mgr.currentToken("missing")).toBeUndefined();
  });
});
