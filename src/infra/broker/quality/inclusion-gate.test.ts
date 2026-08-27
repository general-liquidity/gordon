import { describe, expect, test } from "bun:test";
import {
  BROKER_INCLUSION_GATE,
  getFailedCriteria,
  getUnverifiableCriteria,
  validateBrokerInclusionGate,
} from "./inclusion-gate.ts";
import { BrokerFactory } from "../factory.ts";
import { IbkrAdapter } from "../adapters/ibkr.ts";

describe("broker inclusion gate", () => {
  test("covers every supported broker", () => {
    const supported = BrokerFactory.getSupportedBrokers();
    for (const brokerId of supported) {
      expect(BROKER_INCLUSION_GATE[brokerId]).toBeDefined();
    }
  });

  test("approves only B2C brokers that pass all criteria", () => {
    const supported = BrokerFactory.getSupportedBrokers();
    const validation = validateBrokerInclusionGate(supported);
    expect(validation.approved).toBe(true);
    expect(validation.failures.length).toBe(0);

    for (const brokerId of supported) {
      const decision = BROKER_INCLUSION_GATE[brokerId];
      expect(decision.segment).toBe("b2c");
      expect(decision.approved).toBe(true);
      expect(getFailedCriteria(decision.criteria)).toHaveLength(0);
      expect(decision.rationale.length).toBeGreaterThan(10);
    }
  });

  test("ibkr claims no paper path — the gateway cannot tell paper from live", () => {
    const decision = BROKER_INCLUSION_GATE.ibkr;

    expect(decision.criteria.paperOrSafeDryRunPath).toBe("unverifiable");
    expect(getUnverifiableCriteria(decision.criteria)).toContain("paperOrSafeDryRunPath");
    // Unverifiable is not a failure: IBKR stays included, it just no longer
    // asserts a dry-run guarantee it cannot honor.
    expect(getFailedCriteria(decision.criteria)).toHaveLength(0);
  });

  test("validation reports unverifiable criteria separately from failures", () => {
    const validation = validateBrokerInclusionGate(BrokerFactory.getSupportedBrokers());

    expect(validation.failures).toHaveLength(0);
    expect(validation.unverified).toContainEqual({
      brokerId: "ibkr",
      unverifiableCriteria: ["paperOrSafeDryRunPath"],
    });
  });

  test("the ibkr adapter does not advertise paper trading", () => {
    const capabilities = new IbkrAdapter({ apiKey: "", apiSecret: "" } as never).capabilities;
    expect(capabilities.supportsPaperTrading).toBe(false);
  });
});
