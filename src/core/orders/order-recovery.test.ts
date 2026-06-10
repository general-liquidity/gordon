import { describe, test, expect } from "bun:test";
import { extractOrderOwnerKey } from "./order-recovery.ts";

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