import { beforeEach, describe, expect, test } from "bun:test";
import {
  hasNotifiedRiskKernelFailure,
  noteRiskKernelFailure,
  resetRiskKernelHealth,
} from "./riskKernelHealth.ts";

describe("riskKernelHealth", () => {
  beforeEach(() => {
    resetRiskKernelHealth();
  });

  test("first failure returns a warning containing the error detail", () => {
    const warning = noteRiskKernelFailure(new Error("classifier import failed"));
    expect(warning).not.toBeNull();
    expect(warning).toContain("classifier import failed");
    expect(warning).toContain("manual review");
    expect(hasNotifiedRiskKernelFailure()).toBe(true);
  });

  test("subsequent failures in the same session return null", () => {
    expect(noteRiskKernelFailure(new Error("first"))).not.toBeNull();
    expect(noteRiskKernelFailure(new Error("second"))).toBeNull();
    expect(noteRiskKernelFailure("third")).toBeNull();
  });

  test("non-Error values are stringified", () => {
    const warning = noteRiskKernelFailure("plain string failure");
    expect(warning).toContain("plain string failure");
  });

  test("reset re-arms the notice for a new session", () => {
    noteRiskKernelFailure(new Error("boom"));
    resetRiskKernelHealth();
    expect(hasNotifiedRiskKernelFailure()).toBe(false);
    expect(noteRiskKernelFailure(new Error("boom again"))).not.toBeNull();
  });
});
