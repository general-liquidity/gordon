import { describe, expect, it } from "bun:test";

import type { GordonContext } from "../../agents/types.ts";
import type { Exchange } from "../../exchange/types.ts";
import { buildClassifierPortfolioContext } from "./classifierPortfolio.ts";

describe("buildClassifierPortfolioContext", () => {
  it("does not replace a failed live snapshot with empty positions and synthetic capital", async () => {
    const ctx = {
      exchange: {
        exchangeId: "ccxt:test",
        getFullAccountDetails: async () => Promise.reject(new Error("venue unavailable")),
      } as unknown as Exchange,
      portfolioValue: 100_000,
      availableCash: 50_000,
    } as GordonContext;

    await expect(buildClassifierPortfolioContext(ctx)).rejects.toThrow(
      "refusing degraded risk scoring",
    );
  });
});
