import { describe, it, expect } from "bun:test";
import {
  parseBaseAsset,
  fetchCcxtPublicPrice,
  fetchDefiLlamaPrice,
  fetchShadowMarketPrice,
} from "./shadowPriceFetcher.ts";

describe("shadowPriceFetcher", () => {
  it("parseBaseAsset handles slash and suffix symbols", () => {
    expect(parseBaseAsset("BTC/USDT")).toBe("BTC");
    expect(parseBaseAsset("ETHUSDT")).toBe("ETH");
    expect(parseBaseAsset("SOL")).toBe("SOL");
  });

  it("fetchCcxtPublicPrice returns null without network (best-effort)", async () => {
    const price = await fetchCcxtPublicPrice("BTC/USDT");
    expect(price === null || price > 0).toBe(true);
  });

  it("fetchDefiLlamaPrice resolves known assets or null", async () => {
    const price = await fetchDefiLlamaPrice("BTCUSDT");
    expect(price === null || price > 0).toBe(true);
  });

  it("fetchShadowMarketPrice chains sources", async () => {
    const price = await fetchShadowMarketPrice("BTC/USDT");
    expect(price === null || price > 0).toBe(true);
  });
});
