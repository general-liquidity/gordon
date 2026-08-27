import { describe, expect, it } from "bun:test";
import {
  applyPositionEvents,
  buildFooterLine,
  buildHeaderCells,
  buildRowCells,
  fitCell,
  MAX_VISIBLE_ROWS,
  POSITION_COLUMNS,
  prepareDisplayRows,
  selectVisibleColumns,
  tableLineWidth,
  type Position,
  type PositionRow,
} from "./LivePositions.tsx";

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

function makePosition(overrides: Partial<Position> & { id: string }): Position {
  return { ...base[0]!, ...overrides };
}

function makeRow(overrides: Partial<Position> & { id: string }): PositionRow {
  return { ...makePosition(overrides), riskPct: 0.05, acctPct: 0.01 };
}

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
    expect(
      applyPositionEvents(base, [{ kind: "update", positionId: "missing", updates: { pnl: 99 } }]),
    ).toBe(base);
  });
});

describe("fitCell", () => {
  it("truncates over-width text with an ellipsis at width-1, never flush", () => {
    expect(fitCell("GORDONTEST12", 10)).toBe("GORDONTES…");
    expect(fitCell("GORDONTEST12", 10)).toHaveLength(10);
  });

  it("pads short text to exact width per alignment", () => {
    expect(fitCell("LONG", 5, "left")).toBe("LONG ");
    expect(fitCell("+10", 6, "right")).toBe("   +10");
  });

  it("returns exact-width text untouched (no spurious ellipsis)", () => {
    expect(fitCell("GORDONTEST", 10)).toBe("GORDONTEST");
  });
});

describe("column layout", () => {
  it("every cell is exactly column width, so a 1-space gap always survives", () => {
    const row = makeRow({ id: "x", symbol: "GORDONTEST12", side: "long" });
    const cells = buildRowCells(row, POSITION_COLUMNS);
    expect(cells).toHaveLength(POSITION_COLUMNS.length);
    cells.forEach((cell, i) => {
      expect(cell).toHaveLength(POSITION_COLUMNS[i]!.width);
    });
    // The boot-screenshot bug: "GORDONTELONG" — symbol must end in an
    // ellipsis and keep a visible gap before SIDE.
    expect(cells.join(" ")).toContain("GORDONTES… LONG");
    expect(cells.join(" ")).not.toContain("GORDONTESTLONG");
  });

  it("headers never collide — each header fits its width and joins with a gap", () => {
    const headers = buildHeaderCells(POSITION_COLUMNS);
    headers.forEach((h, i) => {
      expect(h).toHaveLength(POSITION_COLUMNS[i]!.width);
      expect(h).not.toContain("…");
    });
    const line = headers.join(" ");
    expect(line).toContain("RISK  ACCT% DURATION");
    expect(line).not.toContain("ACCT%DURATION");
  });

  it("shows the full column set when the terminal is wide enough", () => {
    const wide = selectVisibleColumns(tableLineWidth(POSITION_COLUMNS) + 2);
    expect(wide.map((c) => c.key)).toEqual(POSITION_COLUMNS.map((c) => c.key));
  });

  it("degrades on narrow terminals by dropping DURATION first, then ACCT%/RISK — never core columns", () => {
    const at80 = selectVisibleColumns(80);
    expect(at80.map((c) => c.key)).not.toContain("openedAt");
    expect(at80.map((c) => c.key)).not.toContain("acctPct");
    expect(tableLineWidth(at80) + 2).toBeLessThanOrEqual(80);

    const at60 = selectVisibleColumns(60);
    expect(at60.map((c) => c.key)).not.toContain("openedAt");
    expect(at60.map((c) => c.key)).not.toContain("acctPct");
    expect(at60.map((c) => c.key)).not.toContain("riskPct");
    // Core columns survive even when the budget is blown.
    for (const key of [
      "symbol",
      "side",
      "quantity",
      "entryPrice",
      "lastPrice",
      "pnl",
      "stopPrice",
    ] as const) {
      expect(at60.map((c) => c.key)).toContain(key);
    }
  });
});

describe("prepareDisplayRows", () => {
  it("filters zero- and negative-quantity phantom rows", () => {
    const { rows, total, totalPnl } = prepareDisplayRows([
      makePosition({ id: "real", quantity: 1, pnl: 10 }),
      makePosition({ id: "phantom1", quantity: 0, entryPrice: 0, pnl: 0 }),
      makePosition({ id: "phantom2", quantity: -1, pnl: 5 }),
    ]);
    expect(rows.map((r) => r.id)).toEqual(["real"]);
    expect(total).toBe(1);
    expect(totalPnl).toBe(10);
  });

  it("reports total 0 when every row is phantom (component renders nothing)", () => {
    const { rows, total, hiddenCount } = prepareDisplayRows([
      makePosition({ id: "phantom", quantity: 0, entryPrice: 0 }),
    ]);
    expect(rows).toHaveLength(0);
    expect(total).toBe(0);
    expect(hiddenCount).toBe(0);
  });

  it("caps at MAX_VISIBLE_ROWS sorted by absolute P&L, reporting the overflow", () => {
    const many = Array.from({ length: 39 }, (_, i) =>
      makePosition({ id: `p${i}`, quantity: 1, pnl: i % 2 === 0 ? i : -i }),
    );
    const { rows, total, totalPnl, hiddenCount } = prepareDisplayRows(many);
    expect(rows).toHaveLength(MAX_VISIBLE_ROWS);
    expect(total).toBe(39);
    expect(hiddenCount).toBe(39 - MAX_VISIBLE_ROWS);
    // Largest exposure first.
    expect(Math.abs(rows[0]!.pnl)).toBe(38);
    for (let i = 1; i < rows.length; i++) {
      expect(Math.abs(rows[i]!.pnl)).toBeLessThanOrEqual(Math.abs(rows[i - 1]!.pnl));
    }
    // Total P&L sums ALL real positions, not just the visible 8.
    expect(totalPnl).toBe(many.reduce((s, p) => s + p.pnl, 0));
  });

  it("does not mutate the input ordering", () => {
    const input = [makePosition({ id: "a", pnl: 1 }), makePosition({ id: "b", pnl: 100 })];
    prepareDisplayRows(input);
    expect(input.map((p) => p.id)).toEqual(["a", "b"]);
  });
});

describe("buildFooterLine", () => {
  it("renders the full TOTAL label — never truncated mid-text inside the SYM cell", () => {
    const { label, pnl } = buildFooterLine(POSITION_COLUMNS, 3, 823);
    expect(label).toContain("TOTAL (3 positions)");
    expect(label).not.toContain("…");
    expect(pnl.trim()).toBe("+823");
  });

  it("aligns the summed P&L under the PNL column within the width budget", () => {
    const cols = selectVisibleColumns(80);
    const { label, pnl } = buildFooterLine(cols, 39, -1234.5);
    const pnlIdx = cols.findIndex((c) => c.key === "pnl");
    const expectedLabelWidth = cols.slice(0, pnlIdx).reduce((sum, c) => sum + c.width + 1, 0);
    expect(label).toHaveLength(expectedLabelWidth);
    expect(pnl).toHaveLength(cols[pnlIdx]!.width);
    expect(pnl.trim()).toBe("-1,234.5");
    expect((label + pnl).length).toBeLessThanOrEqual(tableLineWidth(cols));
  });

  it("uses singular noun for one position", () => {
    const { label } = buildFooterLine(POSITION_COLUMNS, 1, 0);
    expect(label).toContain("TOTAL (1 position)");
  });
});
