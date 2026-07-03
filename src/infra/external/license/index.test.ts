import { describe, expect, it } from "bun:test";
import {
  activationBanner,
  GORDON_SIGNUP_URL,
  getActivePlan,
  isPlanAtLeast,
} from "./index.ts";
import { recordHeartbeatPlan } from "./telemetry.ts";
import { DEFAULT_PLAN } from "./entitlements.ts";

describe("activationBanner", () => {
  it("prints the signup URL so a stranger knows how to get a code", () => {
    const banner = activationBanner();
    expect(banner).toContain(GORDON_SIGNUP_URL);
    expect(banner).toContain("Request access at");
  });

  it("defaults the signup URL to a real https landing page", () => {
    expect(GORDON_SIGNUP_URL.startsWith("https://")).toBe(true);
  });

  it("still tells the user to enter a code they already have", () => {
    expect(activationBanner()).toContain("Already have a code");
  });
});

describe("entitlement read seam", () => {
  it("reflects the plan captured from the latest heartbeat", () => {
    recordHeartbeatPlan("pro");
    expect(getActivePlan()).toBe("pro");
  });

  it("isPlanAtLeast gates on the active plan without hard-gating tools", () => {
    recordHeartbeatPlan("pro");
    expect(isPlanAtLeast("pro")).toBe(true);
    expect(isPlanAtLeast("starter")).toBe(true);
    expect(isPlanAtLeast("enterprise")).toBe(false);
  });

  it("a blank heartbeat plan never downgrades a known plan", () => {
    recordHeartbeatPlan("enterprise");
    recordHeartbeatPlan("");
    recordHeartbeatPlan(undefined);
    expect(getActivePlan()).toBe("enterprise");
  });

  it("DEFAULT_PLAN is the base tier", () => {
    expect(isPlanAtLeast(DEFAULT_PLAN)).toBe(true);
  });
});
