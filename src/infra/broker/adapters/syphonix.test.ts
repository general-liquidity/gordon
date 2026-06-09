import { describe, expect, it } from "bun:test";
import { SyphonixAdapter } from "./syphonix.ts";
import { BrokerFactory } from "../factory.ts";
import { assertBrokerPassesInclusionGate, getBrokerInclusionDecision } from "../quality/inclusion-gate.ts";
import type { BrokerCredentials } from "../types.ts";

const creds: BrokerCredentials = { apiKey: "syph-test-key", apiSecret: "secret", paper: true };

describe("SyphonixAdapter (scaffold)", () => {
  it("exposes the competition-appropriate identity + capabilities", () => {
    const a = new SyphonixAdapter(creds);
    expect(a.brokerId).toBe("syphonix");
    expect(a.displayName).toBe("Syphonix");
    expect(a.isPaper).toBe(true);
    expect(a.capabilities.supportsPaperTrading).toBe(true);
    expect(a.capabilities.supportsShortSelling).toBe(true); // leverage
    expect(a.capabilities.supportsOptions).toBe(false); // "coming soon" per brief
  });

  it("testConnection is false until the spec is wired", async () => {
    expect(await new SyphonixAdapter(creds).testConnection()).toBe(false);
  });

  it("live methods throw a clear spec-pending error (not a silent stub)", async () => {
    const a = new SyphonixAdapter(creds);
    await expect(a.placeOrder({} as never)).rejects.toThrow(/2026-06-15|spec|pending/i);
    await expect(a.getAccount()).rejects.toThrow(/Syphonix/);
    await expect(a.getLatestQuote("XAUUSD")).rejects.toThrow(/SYPHONIX_INTEGRATION/i);
  });
});

describe("Syphonix inclusion gate (honest 'not ready' state)", () => {
  it("is gated OFF until the API spec is documented", () => {
    const decision = getBrokerInclusionDecision("syphonix");
    expect(decision.approved).toBe(false);
    expect(decision.criteria.documentedExecutionEndpoints).toBe(false);
  });

  it("the inclusion gate rejects it (approved:false)", () => {
    expect(() => assertBrokerPassesInclusionGate("syphonix")).toThrow(/inclusion gate/i);
  });

  it("is NOT in SUPPORTED_BROKERS yet, so the factory won't create it (cannot trade pre-spec)", () => {
    // Kept out of the approved-and-creatable set until June 15; factory blocks it
    // at the supported-broker check, preserving 'all SUPPORTED pass the gate'.
    expect(BrokerFactory.getSupportedBrokers()).not.toContain("syphonix");
    expect(() => BrokerFactory.create("syphonix", creds)).toThrow(/unsupported broker/i);
  });
});
