import { describe, expect, test } from "bun:test";
import { __setupWizardBrokerInternals } from "./SetupWizard.tsx";

describe("setup wizard broker helpers", () => {
  test("parses broker mode values", () => {
    expect(__setupWizardBrokerInternals.parseBrokerMode("paper")).toBe(true);
    expect(__setupWizardBrokerInternals.parseBrokerMode("true")).toBe(true);
    expect(__setupWizardBrokerInternals.parseBrokerMode("1")).toBe(true);
    expect(__setupWizardBrokerInternals.parseBrokerMode("live")).toBe(false);
    expect(__setupWizardBrokerInternals.parseBrokerMode("false")).toBe(false);
    expect(__setupWizardBrokerInternals.parseBrokerMode("0")).toBe(false);
    expect(__setupWizardBrokerInternals.parseBrokerMode("invalid")).toBeNull();
  });

  test("returns broker label and setup instructions", () => {
    expect(__setupWizardBrokerInternals.getBrokerLabel("alpaca")).toBe("Alpaca");
    expect(__setupWizardBrokerInternals.getBrokerInstructions("alpaca").length).toBeGreaterThan(0);
    expect(__setupWizardBrokerInternals.getBrokerLabel("webull")).toBe("Webull");
    expect(__setupWizardBrokerInternals.getBrokerInstructions("webull").length).toBeGreaterThan(0);
  });

  test("generates unique broker IDs", () => {
    const existing = [
      {
        id: "alpaca",
        type: "alpaca" as const,
        apiKey: "***",
        apiSecret: "***",
        isDefault: true,
        paper: true,
      },
      {
        id: "alpaca_1",
        type: "alpaca" as const,
        apiKey: "***",
        apiSecret: "***",
        isDefault: false,
        paper: true,
      },
    ];

    const generated = __setupWizardBrokerInternals.generateBrokerId("alpaca", existing);
    expect(generated).toBe("alpaca_2");
  });

  test("parses rail credentials bundle", () => {
    const parsed = __setupWizardBrokerInternals.parseRailsInput(
      "helius:helius-key; moonpay:moonpay-key,moonpay-secret; polygon:recipient,private-key"
    );
    expect(parsed.errors).toHaveLength(0);
    expect(parsed.keys.heliusApiKey).toBe("helius-key");
    expect(parsed.keys.moonpayApiKey).toBe("moonpay-key");
    expect(parsed.keys.polygonRecipient).toBe("recipient");
  });

  test("maps quickstart to llm-first flow", () => {
    expect(__setupWizardBrokerInternals.getFirstActionStep("quickstart", null)).toBe("llm");
    expect(__setupWizardBrokerInternals.getFirstActionStep("configure", "broker")).toBe("broker-select");
  });
});
