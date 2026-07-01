import { describe, expect, it } from "bun:test";
import { SettledCashLedger } from "./settledCashLedger.ts";

const T0 = new Date("2026-01-05T15:00:00Z"); // trade date
const T1 = new Date("2026-01-06T15:00:00Z"); // settlement date (T+1)

describe("SettledCashLedger", () => {
  it("funds a buy from settled cash", () => {
    const ledger = new SettledCashLedger(1000);
    const check = ledger.canBuy(800, T0);
    expect(check.allowed).toBe(true);
    expect(check.settledAvailable).toBe(1000);
    const buy = ledger.recordBuy(800, T0);
    expect(buy.accepted).toBe(true);
    expect(ledger.settledCash).toBe(200);
  });

  it("rejects a buy funded by unsettled proceeds (GFV)", () => {
    const ledger = new SettledCashLedger(0);
    // Sold something at T0, proceeds settle T+1.
    ledger.addProceeds(1000, T1, "pos-1");
    // Same-day buy against unsettled proceeds is a GFV.
    const check = ledger.canBuy(1000, T0);
    expect(check.allowed).toBe(false);
    expect(check.shortfall).toBe(1000);
    expect(check.reason).toContain("GFV");

    const buy = ledger.recordBuy(1000, T0);
    expect(buy.accepted).toBe(false);
    // Balances untouched on rejection.
    expect(ledger.settledCash).toBe(0);
    expect(ledger.pendingTotal).toBe(1000);
  });

  it("allows the buy once proceeds have settled", () => {
    const ledger = new SettledCashLedger(0);
    ledger.addProceeds(1000, T1);
    // As of the settlement date the proceeds count.
    expect(ledger.canBuy(1000, T1).allowed).toBe(true);
    const buy = ledger.recordBuy(1000, T1);
    expect(buy.accepted).toBe(true);
    expect(buy.matured).toBe(1000);
    expect(ledger.settledCash).toBe(0);
    expect(ledger.pendingTotal).toBe(0);
  });

  it("applyMatured is idempotent for a fixed clock and only promotes matured credits", () => {
    const ledger = new SettledCashLedger(0);
    const T2 = new Date("2026-01-07T15:00:00Z");
    ledger.addProceeds(500, T1);
    ledger.addProceeds(300, T2);
    // At T1 only the first credit matures.
    expect(ledger.applyMatured(T1)).toBe(500);
    expect(ledger.applyMatured(T1)).toBe(0);
    expect(ledger.settledCash).toBe(500);
    expect(ledger.pendingTotal).toBe(300);
    // At T2 the second matures.
    expect(ledger.applyMatured(T2)).toBe(300);
    expect(ledger.settledCash).toBe(800);
  });

  it("settledAvailable is pure and does not mutate", () => {
    const ledger = new SettledCashLedger(100);
    ledger.addProceeds(400, T1);
    expect(ledger.settledAvailable(T0)).toBe(100);
    expect(ledger.settledAvailable(T1)).toBe(500);
    // No mutation happened.
    expect(ledger.settledCash).toBe(100);
    expect(ledger.pendingTotal).toBe(400);
  });

  it("deposits settle immediately", () => {
    const ledger = new SettledCashLedger(0);
    ledger.deposit(250);
    expect(ledger.settledCash).toBe(250);
    expect(ledger.canBuy(250, T0).allowed).toBe(true);
  });

  it("rejects non-positive and non-finite amounts at the boundary", () => {
    const ledger = new SettledCashLedger(100);
    expect(() => ledger.deposit(0)).toThrow(RangeError);
    expect(() => ledger.addProceeds(-5, T1)).toThrow(RangeError);
    expect(() => ledger.canBuy(Number.NaN, T0)).toThrow(RangeError);
    expect(() => new SettledCashLedger(-1)).toThrow(RangeError);
  });
});
