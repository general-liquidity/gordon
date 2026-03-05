import { describe, expect, test } from "bun:test";
import { BrokerFactory } from "./factory.ts";

describe("BrokerFactory extended broker support", () => {
  test("lists all supported B2C stock brokers", () => {
    const supported = BrokerFactory.getSupportedBrokers();
    expect(supported).toContain("alpaca");
    expect(supported).toContain("webull");
    expect(supported).toContain("schwab");
    expect(supported).toContain("tradier");
    expect(supported).toContain("tradestation");
    expect(supported).toContain("tastytrade");
    expect(supported).toContain("etrade");
    expect(supported).toContain("ibkr");
  });

  test("creates adapters for each supported broker id", () => {
    const cases = BrokerFactory.getSupportedBrokers();
    for (const brokerId of cases) {
      const adapter = BrokerFactory.create(brokerId, {
        apiKey: `k-${brokerId}`,
        apiSecret: `s-${brokerId}`,
        paper: true,
      });
      expect(adapter.brokerId).toBe(brokerId);
      expect(adapter.displayName.length).toBeGreaterThan(0);
    }
  });

  test("rejects unsupported broker ids", () => {
    expect(() =>
      BrokerFactory.create("not-a-broker" as never, {
        apiKey: "k",
        apiSecret: "s",
        paper: true,
      })
    ).toThrow("Unsupported broker");
  });
});

