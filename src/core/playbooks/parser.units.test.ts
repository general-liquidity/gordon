import { describe, expect, it } from "bun:test";

import { parseStopLossRule, parsePositionSizingRule } from "./parser.ts";

describe("parseStopLossRule keeps ATR multiples and percents apart", () => {
  it("does not harvest a percent into an ATR-typed stop", () => {
    // One untyped `value` field plus a percent fallback wrote 2 here, which a
    // consumer of an ATR stop reads as 2 ATR: a completely different distance.
    const r = parseStopLossRule("1.5 ATR below the swing low, max 2% of equity");
    expect(r.type).toBe("atr");
    expect(r.atrMultiple).toBe(1.5);
    expect(r.percentValue).toBeUndefined();
  });

  it("reads an ATR multiple written either way round", () => {
    expect(parseStopLossRule("2x ATR below entry").atrMultiple).toBe(2);
    expect(parseStopLossRule("ATR(14) x 1.5 below entry").atrMultiple).toBe(1.5);
  });

  it("still records a plain percent stop as a percent", () => {
    const r = parseStopLossRule("Stop 1.5% below entry");
    expect(r.type).toBe("fixed_percent");
    expect(r.percentValue).toBe(1.5);
    expect(r.atrMultiple).toBeUndefined();
  });

  it("classifies a structure stop with no percent at all", () => {
    const r = parseStopLossRule("Below the swing low");
    expect(r.type).toBe("structure");
    expect(r.percentValue).toBeUndefined();
    expect(r.atrMultiple).toBeUndefined();
  });
});

describe("parsePositionSizingRule keeps allocation and risk apart", () => {
  it("does not read a position allocation as a risk budget", () => {
    // "Position size: 5% of portfolio" behind a 2% stop risks 0.1% of the
    // account. Recording it as riskPercent = 5 oversizes by 50x.
    const r = parsePositionSizingRule("Position size: 5% of portfolio");
    expect(r.riskPercent).toBeUndefined();
    expect(r.positionPercent).toBe(5);
  });

  it("still reads an explicit risk budget", () => {
    expect(parsePositionSizingRule("Risk 1% of portfolio per trade").riskPercent).toBe(1);
    expect(parsePositionSizingRule("1% risk per trade").riskPercent).toBe(1);
    expect(parsePositionSizingRule("Risk per trade: 0.5%").riskPercent).toBe(0.5);
  });

  it("records both when a bullet states allocation and risk separately", () => {
    const r = parsePositionSizingRule("Size 10% of equity, risk 1% per trade");
    expect(r.riskPercent).toBe(1);
    expect(r.positionPercent).toBe(10);
  });
});
