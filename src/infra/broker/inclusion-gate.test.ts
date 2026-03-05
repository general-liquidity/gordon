import { describe, expect, test } from "bun:test";
import {
  BROKER_INCLUSION_GATE,
  getFailedCriteria,
  validateBrokerInclusionGate,
} from "./inclusion-gate.ts";
import { BrokerFactory } from "./factory.ts";

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
});

