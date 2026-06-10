import { describe, expect, it } from "bun:test";
import { migrateExchangeConfigTypes, ExchangeTypeSchema } from "./config.ts";

describe("migrateExchangeConfigTypes", () => {
  it("rewrites bare first-class ids to ccxt:* before parse", () => {
    const migrated = migrateExchangeConfigTypes({
      exchanges: [
        { id: "binance", type: "binance", apiKey: "k", apiSecret: "s", isDefault: true },
        { id: "bybit", type: "ccxt:bybit", apiKey: "k2", apiSecret: "s2", isDefault: false },
      ],
    });

    const parsed = ExchangeTypeSchema.parse((migrated.exchanges as Array<{ type: string }>)[0]!.type);
    expect(parsed).toBe("ccxt:binance");
    expect(ExchangeTypeSchema.parse((migrated.exchanges as Array<{ type: string }>)[1]!.type)).toBe("ccxt:bybit");
  });

  it("maps binance_us to ccxt:binanceus", () => {
    const migrated = migrateExchangeConfigTypes({
      exchanges: [{ id: "bus", type: "binance_us", apiKey: "k", apiSecret: "s", isDefault: true }],
    });
    expect((migrated.exchanges as Array<{ type: string }>)[0]!.type).toBe("ccxt:binanceus");
  });
});