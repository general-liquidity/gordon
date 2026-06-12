import { describe, expect, it } from "bun:test";
import { applyPositionEvents, type Position } from "./LivePositions.tsx";

const base: Position[] = [
  {
    id: "p1",
    symbol: "BTC",
    side: "long",
    quantity: 1,
    entryPrice: 100,
    lastPrice: 110,
    pnl: 10,
    stopPrice: 95,
    openedAt: "2026-01-01T00:00:00Z",
  },
  {
    id: "p2",
    symbol: "ETH",
    side: "short",
    quantity: 2,
    entryPrice: 200,
    lastPrice: 190,
    pnl: 20,
    stopPrice: 205,
    openedAt: "2026-01-01T00:00:00Z",
  },
];

describe("applyPositionEvents", () => {
  it("applies batched updates and closes", () => {
    const next = applyPositionEvents(base, [
      { kind: "update", positionId: "p1", updates: { lastPrice: 111, pnl: 11 } },
      { kind: "close", positionId: "p2" },
    ]);
    expect(next).toHaveLength(1);
    expect(next[0]?.lastPrice).toBe(111);
    expect(next[0]?.pnl).toBe(11);
  });

  it("preserves untouched row identity", () => {
    const next = applyPositionEvents(base, [
      { kind: "update", positionId: "p1", updates: { pnl: 12 } },
    ]);
    expect(next[1]).toBe(base[1]);
    expect(next[0]).not.toBe(base[0]);
  });

  it("ignores unknown ids", () => {
    expect(applyPositionEvents(base, [
      { kind: "update", positionId: "missing", updates: { pnl: 99 } },
    ])).toBe(base);
  });
});
