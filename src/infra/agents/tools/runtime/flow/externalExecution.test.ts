import { describe, expect, it } from "bun:test";

import {
  ExternalExecutionManager,
  getExternalExecutionManager,
  setExternalExecutionResult,
} from "./externalExecution.ts";

describe("ExternalExecutionManager", () => {
  it("pauses on request and resumes with the client-supplied result spliced in", async () => {
    const mgr = new ExternalExecutionManager();
    const { id, requirement, result } = mgr.request(
      "sign_transaction",
      { to: "0xabc", value: "1" },
      "hardware-key signing",
    );

    expect(requirement.status).toBe("paused");
    expect(mgr.isPaused()).toBe(true);
    expect(mgr.getPaused()).toHaveLength(1);

    const settled = mgr.setExternalExecutionResult(id, { signature: "0xdeadbeef" });
    expect(settled?.status).toBe("fulfilled");

    const resolution = await result;
    expect(resolution.ok).toBe(true);
    expect(resolution.cancelled).toBe(false);
    expect(resolution.result).toEqual({ signature: "0xdeadbeef" });
    expect(mgr.isPaused()).toBe(false);
  });

  it("never auto-executes — the requirement only records intent", async () => {
    const mgr = new ExternalExecutionManager();
    const { requirement } = mgr.request("wallet_transfer", { amount: 5 }, "2fa");
    // Still paused, no side effect, no result until a client posts one.
    expect(requirement.result).toBeUndefined();
    expect(mgr.isPaused()).toBe(true);
  });

  it("resolves rejected with the error and ok=false", async () => {
    const mgr = new ExternalExecutionManager();
    const { id, result } = mgr.request("sign_transaction", {}, "signing");

    mgr.reject(id, "user declined on device");

    const resolution = await result;
    expect(resolution.ok).toBe(false);
    expect(resolution.cancelled).toBe(false);
    expect(resolution.error).toBe("user declined on device");
    expect(mgr.get(id)?.status).toBe("rejected");
  });

  it("resolves cancelled with cancelled=true and ok=false", async () => {
    const mgr = new ExternalExecutionManager();
    const { id, result } = mgr.request("broker_2fa", {}, "2fa");

    mgr.cancel(id);

    const resolution = await result;
    expect(resolution.ok).toBe(false);
    expect(resolution.cancelled).toBe(true);
    expect(resolution.result).toBeUndefined();
  });

  it("is idempotent on settle — a second settle is a no-op", () => {
    const mgr = new ExternalExecutionManager();
    const { id } = mgr.request("sign_transaction", {}, "signing");

    expect(mgr.setExternalExecutionResult(id, "first")).not.toBeNull();
    expect(mgr.setExternalExecutionResult(id, "second")).toBeNull();
    expect(mgr.reject(id, "late")).toBeNull();
    expect(mgr.get(id)?.result).toBe("first");
  });

  it("returns null when settling an unknown id", () => {
    const mgr = new ExternalExecutionManager();
    expect(mgr.setExternalExecutionResult("nope", 1)).toBeNull();
    expect(mgr.get("nope")).toBeUndefined();
  });

  it("tracks paused vs settled requirements independently", () => {
    const mgr = new ExternalExecutionManager();
    const a = mgr.request("t1", {}, "r1");
    mgr.request("t2", {}, "r2");
    mgr.setExternalExecutionResult(a.id, "done");

    expect(mgr.getPaused()).toHaveLength(1);
    expect(mgr.getSettled()).toHaveLength(1);
    expect(mgr.isPaused()).toBe(true);
  });

  it("module-level setExternalExecutionResult drives the singleton", async () => {
    const mgr = getExternalExecutionManager();
    const { id, result } = mgr.request("sign_transaction", {}, "signing");

    setExternalExecutionResult(id, { ok: 1 });

    const resolution = await result;
    expect(resolution.ok).toBe(true);
    expect(resolution.result).toEqual({ ok: 1 });
  });
});
