import { describe, expect, test } from "bun:test";
import { clampToDepth, type DepthLevel } from "./depthSizing.ts";

const book: DepthLevel[] = [
  { price: 100, volume: 30 },
  { price: 101, volume: 20 },
  { price: 102, volume: 50 },
];

describe("clampToDepth", () => {
  test("target below available → full fill, not capped", () => {
    const r = clampToDepth(40, "buy", book);
    expect(r.availableLots).toBe(100);
    expect(r.fillableLots).toBe(40);
    expect(r.capped).toBe(false);
  });

  test("target above available → capped to availableLots", () => {
    const r = clampToDepth(250, "buy", book);
    expect(r.availableLots).toBe(100);
    expect(r.fillableLots).toBe(100);
    expect(r.capped).toBe(true);
  });

  test("fillFraction 0.5 halves capacity", () => {
    const r = clampToDepth(80, "buy", book, { fillFraction: 0.5 });
    expect(r.availableLots).toBe(50);
    expect(r.fillableLots).toBe(50);
    expect(r.capped).toBe(true);
  });

  test("maxLevels limits the summed depth", () => {
    const r = clampToDepth(100, "buy", book, { maxLevels: 2 });
    expect(r.availableLots).toBe(50);
    expect(r.fillableLots).toBe(50);
    expect(r.capped).toBe(true);
  });

  test("empty levels → 0, capped when target positive", () => {
    const r = clampToDepth(10, "buy", []);
    expect(r.availableLots).toBe(0);
    expect(r.fillableLots).toBe(0);
    expect(r.capped).toBe(true);
  });

  test("empty levels with target 0 → not capped", () => {
    const r = clampToDepth(0, "buy", []);
    expect(r.availableLots).toBe(0);
    expect(r.fillableLots).toBe(0);
    expect(r.capped).toBe(false);
  });

  test("sign preserved for sell side (negative target)", () => {
    const r = clampToDepth(-40, "sell", book);
    expect(r.fillableLots).toBe(-40);
    expect(r.capped).toBe(false);
  });

  test("sign preserved when capped (negative target)", () => {
    const r = clampToDepth(-250, "sell", book);
    expect(r.fillableLots).toBe(-100);
    expect(r.capped).toBe(true);
  });

  test("target 0 → 0", () => {
    const r = clampToDepth(0, "buy", book);
    expect(r.fillableLots).toBe(0);
    expect(r.availableLots).toBe(100);
    expect(r.capped).toBe(false);
  });

  test("non-finite target → treated as 0", () => {
    const r = clampToDepth(Number.NaN, "buy", book);
    expect(r.fillableLots).toBe(0);
    expect(r.capped).toBe(false);
  });

  test("non-finite / non-positive level volumes are skipped", () => {
    const messy: DepthLevel[] = [
      { price: 100, volume: 30 },
      { price: 101, volume: Number.NaN },
      { price: 102, volume: -5 },
      { price: 103, volume: 20 },
    ];
    const r = clampToDepth(100, "buy", messy);
    expect(r.availableLots).toBe(50);
    expect(r.capped).toBe(true);
  });
});
