/**
 * Tests for swing-mandate module
 *
 * Tests: createMandate, validateMandate, isMandateExpired, isMandateBreached, updateMandateTracking
 */

import { describe, test, expect } from "bun:test";
import {
  createMandate,
  validateMandate,
  isMandateExpired,
  isMandateBreached,
  updateMandateTracking,
} from "./swing-mandate.ts";

describe("createMandate", () => {
  test("creates a mandate with default values", () => {
    const mandate = createMandate({});
    expect(mandate.id).toMatch(/^mandate_/);
    expect(mandate.status).toBe("active");
    expect(mandate.symbols).toEqual([]);
    expect(mandate.timeframe).toBe("4h");
    expect(mandate.direction).toBe("long");
    expect(mandate.maxRiskPerTrade).toBe(2);
    expect(mandate.maxOpenPositions).toBe(3);
    expect(mandate.maxDrawdown).toBe(5);
    expect(mandate.maxDailyLoss).toBe(3);
    expect(mandate.scanIntervalMinutes).toBe(60);
    expect(mandate.minConfidence).toBe(0.6);
    expect(mandate.requireApproval).toBe(true);
  });

  test("creates a mandate with custom values", () => {
    const mandate = createMandate({
      symbols: ["BTCUSDT", "ETHUSDT"],
      timeframe: "1d",
      direction: "both",
      maxRiskPerTrade: 1.5,
      maxOpenPositions: 5,
      scanIntervalMinutes: 30,
      minConfidence: 0.8,
      requireApproval: false,
      expiresAt: "2030-01-01T00:00:00.000Z",
    });
    expect(mandate.symbols).toEqual(["BTCUSDT", "ETHUSDT"]);
    expect(mandate.timeframe).toBe("1d");
    expect(mandate.direction).toBe("both");
    expect(mandate.maxRiskPerTrade).toBe(1.5);
    expect(mandate.maxOpenPositions).toBe(5);
    expect(mandate.scanIntervalMinutes).toBe(30);
    expect(mandate.minConfidence).toBe(0.8);
    expect(mandate.requireApproval).toBe(false);
  });

  test("initializes tracking fields to zero", () => {
    const mandate = createMandate({});
    expect(mandate.currentPnl).toBe(0);
    expect(mandate.dailyPnl).toBe(0);
    expect(mandate.peakPnl).toBe(0);
    expect(mandate.tradesExecuted).toBe(0);
  });
});

describe("validateMandate", () => {
  test("valid mandate passes validation", () => {
    const mandate = createMandate({
      expiresAt: new Date(Date.now() + 3600000).toISOString(),
    });
    const result = validateMandate(mandate);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  test("rejects mandate with past expiresAt", () => {
    const mandate = createMandate({
      expiresAt: new Date(Date.now() - 86400000).toISOString(), // Yesterday
    });
    const result = validateMandate(mandate);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  test("rejects mandate with invalid risk params", () => {
    const mandate = createMandate({
      maxRiskPerTrade: 0,
      expiresAt: new Date(Date.now() + 3600000).toISOString(),
    });
    const result = validateMandate(mandate);
    expect(result.valid).toBe(false);
  });
});

describe("isMandateExpired", () => {
  test("returns false for future expiry", () => {
    const mandate = createMandate({
      expiresAt: new Date(Date.now() + 86400000).toISOString(),
    });
    expect(isMandateExpired(mandate)).toBe(false);
  });

  test("returns true for past expiry", () => {
    const mandate = createMandate({
      expiresAt: new Date(Date.now() - 1000).toISOString(),
    });
    expect(isMandateExpired(mandate)).toBe(true);
  });
});

describe("isMandateBreached", () => {
  test("returns not breached for fresh mandate", () => {
    const mandate = createMandate({
      expiresAt: new Date(Date.now() + 86400000).toISOString(),
    });
    const result = isMandateBreached(mandate);
    expect(result.breached).toBe(false);
  });

  test("detects daily loss breach", () => {
    const mandate = createMandate({
      maxDailyLoss: 3,
      expiresAt: new Date(Date.now() + 86400000).toISOString(),
    });
    mandate.dailyPnl = -4; // -4% exceeds 3% daily limit
    const result = isMandateBreached(mandate);
    expect(result.breached).toBe(true);
    expect(result.reason).toContain("Daily");
  });
});

describe("updateMandateTracking", () => {
  test("updates pnl and peak via delta", () => {
    const mandate = createMandate({
      expiresAt: new Date(Date.now() + 86400000).toISOString(),
    });
    const updated = updateMandateTracking(mandate, 5);
    expect(updated.currentPnl).toBe(5);
    expect(updated.peakPnl).toBe(5);
    expect(updated.tradesExecuted).toBe(1);
  });

  test("tracks peak correctly through up and down", () => {
    const mandate = createMandate({
      expiresAt: new Date(Date.now() + 86400000).toISOString(),
    });
    const up = updateMandateTracking(mandate, 10);
    expect(up.peakPnl).toBe(10);
    const down = updateMandateTracking(up, -3);
    expect(down.peakPnl).toBe(10); // Peak stays at 10
    expect(down.currentPnl).toBe(7);
  });

  test("accumulates daily pnl", () => {
    const mandate = createMandate({
      expiresAt: new Date(Date.now() + 86400000).toISOString(),
    });
    const first = updateMandateTracking(mandate, 2);
    const second = updateMandateTracking(first, 3);
    expect(second.dailyPnl).toBe(5);
    expect(second.currentPnl).toBe(5);
    expect(second.tradesExecuted).toBe(2);
  });
});
