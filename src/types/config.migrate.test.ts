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

  it("strips removed legacy agentRails field on migrate", () => {
    const migrated = migrateExchangeConfigTypes({
      agentRails: { legacyProvider: { enabled: true } },
      exchanges: [],
    });
    expect(migrated.agentRails).toBeUndefined();
  });

  it("migrates legacy singleton exchange into exchanges[]", () => {
    const migrated = migrateExchangeConfigTypes({
      exchange: {
        name: "binance",
        apiKey: "legacy-key",
        apiSecret: "legacy-secret",
        permissions: { read: true, spotTrade: true, withdraw: false },
      },
    });

    expect(migrated.exchange).toBeUndefined();
    const exchanges = migrated.exchanges as Array<{ id: string; type: string; apiKey: string }>;
    expect(exchanges).toHaveLength(1);
    expect(exchanges[0]!.id).toBe("binance");
    expect(exchanges[0]!.type).toBe("ccxt:binance");
    expect(exchanges[0]!.apiKey).toBe("legacy-key");
    expect(migrated.activeExchangeId).toBe("binance");
  });
});