import { describe, expect, it } from "bun:test";

import { classify_trade_risk } from "./tradingInfra.ts";

describe("classify_trade_risk constitution wiring", () => {
  it("blocks a proposal with no protective stop instead of assuming one exists", async () => {
    const result = (await classify_trade_risk.execute!(
      {
        symbol: "BTCUSDT",
        side: "BUY",
        quantity: 0.01,
        price: 50_000,
        orderType: "LIMIT",
      },
      {} as never,
    )) as {
      recommendation: string;
      constitutionViolations: Array<{ rule: string }>;
    };

    expect(result.recommendation).toBe("block");
    expect(result.constitutionViolations.map((violation) => violation.rule)).toContain(
      "MANDATORY_STOP_LOSS",
    );
  });

  it("derives notional and stop risk rather than trusting a conflicting display estimate", async () => {
    const result = (await classify_trade_risk.execute!(
      {
        symbol: "BTCUSDT",
        side: "BUY",
        quantity: 0.01,
        price: 50_000,
        notionalUsd: 1,
        stopLossPrice: 49_000,
        orderType: "LIMIT",
      },
      {} as never,
    )) as {
      constitutionViolations: Array<{ rule: string }>;
    };

    expect(result.constitutionViolations.map((violation) => violation.rule)).not.toContain(
      "MANDATORY_STOP_LOSS",
    );
  });
});
