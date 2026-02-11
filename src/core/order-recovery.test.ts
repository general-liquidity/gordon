import { describe, test, expect } from "bun:test";
import type { BinanceClient } from "../infra/binance/client.ts";
import {
  extractOrderOwnerKey,
  scanForOrphanedOrders,
} from "./order-recovery.ts";

describe("extractOrderOwnerKey", () => {
  test("extracts plan fragment for standard Gordon order IDs", () => {
    const ownerKey = extractOrderOwnerKey("gordon_abcd1234_entry_lmno12_xyz9");
    expect(ownerKey).toBe("abcd1234");
  });

  test("extracts trade fragment for trailing stop Gordon order IDs", () => {
    const ownerKey = extractOrderOwnerKey("gordon_tsl_qwerty99_lmno12");
    expect(ownerKey).toBe("qwerty99");
  });

  test("returns null for non-Gordon order IDs", () => {
    const ownerKey = extractOrderOwnerKey("manual_order_123");
    expect(ownerKey).toBeNull();
  });
});

describe("scanForOrphanedOrders", () => {
  test("treats prefixed plan IDs as known owners", async () => {
    const mockClient = {
      getOpenOrders: async () => [
        {
          orderId: 101,
          clientOrderId: "gordon_abcd1234_entry_lmno12_xyz9",
          symbol: "BTCUSDT",
          side: "BUY",
          type: "LIMIT",
          status: "NEW",
          price: "100.0",
          origQty: "1.0",
          executedQty: "0",
          cummulativeQuoteQty: "0",
          time: Date.now(),
          updateTime: Date.now(),
        },
      ],
    } as unknown as BinanceClient;

    const orphaned = await scanForOrphanedOrders(
      mockClient,
      new Set(["pln_abcd1234"])
    );
    expect(orphaned).toHaveLength(0);
  });
});
