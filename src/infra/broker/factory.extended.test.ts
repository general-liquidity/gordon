import { describe, expect, test } from "bun:test";
import { BrokerFactory } from "./factory.ts";
import {
  BROKER_PAPER_SUPPORT,
  BrokerPaperNotSupportedError,
  type BrokerPaperSupportEntry,
} from "./brokerPaperSupport.ts";

describe("BrokerFactory extended broker support", () => {
  test("lists all supported B2C stock brokers", () => {
    const supported = BrokerFactory.getSupportedBrokers();
    expect(supported).toContain("alpaca");
    expect(supported).toContain("webull");
    expect(supported).toContain("schwab");
    expect(supported).toContain("tradier");
    expect(supported).toContain("tradestation");
    expect(supported).toContain("tastytrade");
    expect(supported).toContain("trading212");
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

describe("BrokerFactory paper-mode fail-fast", () => {
  // No broker in BROKER_PAPER_SUPPORT is currently "unsupported", so the
  // fail-fast path is proven by temporarily flipping one entry.
  function withUnsupportedPaper(brokerId: "alpaca", fn: () => void): void {
    const original: BrokerPaperSupportEntry = BROKER_PAPER_SUPPORT[brokerId];
    BROKER_PAPER_SUPPORT[brokerId] = {
      kind: "unsupported",
      notSupportedHint: "Use live credentials.",
    };
    try {
      fn();
    } finally {
      BROKER_PAPER_SUPPORT[brokerId] = original;
    }
  }

  test("create() throws BrokerPaperNotSupportedError when paper requested on an unsupported broker", () => {
    withUnsupportedPaper("alpaca", () => {
      expect(() =>
        BrokerFactory.create("alpaca", {
          apiKey: "k-paper-check",
          apiSecret: "s",
          paper: true,
        })
      ).toThrow(BrokerPaperNotSupportedError);
    });
  });

  test("create() fails fast even for a previously cached instance", () => {
    const credentials = { apiKey: "k-cached-paper", apiSecret: "s", paper: true };
    const adapter = BrokerFactory.create("alpaca", credentials);
    expect(adapter.brokerId).toBe("alpaca");
    withUnsupportedPaper("alpaca", () => {
      expect(() => BrokerFactory.create("alpaca", credentials)).toThrow(
        BrokerPaperNotSupportedError
      );
    });
    BrokerFactory.removeFromCache("alpaca", credentials);
  });

  test("create() allows live mode regardless of paper support", () => {
    withUnsupportedPaper("alpaca", () => {
      const adapter = BrokerFactory.create("alpaca", {
        apiKey: "k-live-check",
        apiSecret: "s",
        paper: false,
      });
      expect(adapter.brokerId).toBe("alpaca");
      BrokerFactory.removeFromCache("alpaca", {
        apiKey: "k-live-check",
        apiSecret: "s",
        paper: false,
      });
    });
  });
});
