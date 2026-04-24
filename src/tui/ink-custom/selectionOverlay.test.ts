import { describe, expect, it } from "bun:test";

import type { Patch } from "./internal/contracts.ts";
import { createSelectionOverlay } from "./selectionOverlay.ts";

function patch(x: number, y: number, content = "X", styleId = -1): Patch {
  return { x, y, content, visualWidth: 1, styleId };
}

const INVERSE_ON = "\x1b[7m";
const INVERSE_OFF = "\x1b[27m";

describe("selectionOverlay", () => {
  it("returns patches unchanged when no selection is set", () => {
    const overlay = createSelectionOverlay();
    const patches: Patch[] = [patch(0, 0, "a"), patch(1, 0, "b"), patch(2, 0, "c")];
    const out = overlay.applyTo(patches);
    expect(out).toHaveLength(3);
    for (let i = 0; i < 3; i++) {
      expect(out[i]!.content).toBe(patches[i]!.content);
      expect(out[i]!.x).toBe(patches[i]!.x);
      expect(out[i]!.y).toBe(patches[i]!.y);
    }
  });

  it("does not mutate input patches when selection is set", () => {
    const overlay = createSelectionOverlay();
    overlay.set({ startRow: 0, startCol: 0, endRow: 0, endCol: 10 });
    const original = patch(5, 0, "hello");
    const patches: Patch[] = [original];

    const out = overlay.applyTo(patches);

    expect(original.content).toBe("hello");
    expect(out).not.toBe(patches);
    expect(out[0]).not.toBe(original);
  });

  it("wraps patches inside a single-row selection with SGR 7 / 27", () => {
    const overlay = createSelectionOverlay();
    overlay.set({ startRow: 2, startCol: 5, endRow: 2, endCol: 10 });

    const patches: Patch[] = [
      patch(4, 2, "L"), // outside — col < startCol
      patch(5, 2, "A"), // inside (left edge)
      patch(7, 2, "B"), // inside (middle)
      patch(10, 2, "C"), // inside (right edge)
      patch(11, 2, "R"), // outside — col > endCol
      patch(7, 1, "U"), // outside — row above
      patch(7, 3, "D"), // outside — row below
    ];

    const out = overlay.applyTo(patches);

    expect(out[0]!.content).toBe("L");
    expect(out[1]!.content).toBe(`${INVERSE_ON}A${INVERSE_OFF}`);
    expect(out[2]!.content).toBe(`${INVERSE_ON}B${INVERSE_OFF}`);
    expect(out[3]!.content).toBe(`${INVERSE_ON}C${INVERSE_OFF}`);
    expect(out[4]!.content).toBe("R");
    expect(out[5]!.content).toBe("U");
    expect(out[6]!.content).toBe("D");
  });

  it("handles multi-row selection — start row, interior, end row", () => {
    const overlay = createSelectionOverlay();
    // Rows 1..3. On row 1 select from col 5 onward; on row 3 select up to col 4.
    overlay.set({ startRow: 1, startCol: 5, endRow: 3, endCol: 4 });

    const patches: Patch[] = [
      // row 1 — start row
      patch(4, 1, "a"), // out: col < startCol on startRow
      patch(5, 1, "b"), // in
      patch(20, 1, "c"), // in (no right bound on startRow when multi-row)
      // row 2 — interior, everything selected
      patch(0, 2, "d"), // in
      patch(100, 2, "e"), // in
      // row 3 — end row
      patch(0, 3, "f"), // in: col <= endCol
      patch(4, 3, "g"), // in
      patch(5, 3, "h"), // out: col > endCol
      // row 0 and row 4 — outside selection entirely
      patch(10, 0, "i"),
      patch(10, 4, "j"),
    ];

    const out = overlay.applyTo(patches);
    const wrapped = (s: string) => `${INVERSE_ON}${s}${INVERSE_OFF}`;

    expect(out[0]!.content).toBe("a");
    expect(out[1]!.content).toBe(wrapped("b"));
    expect(out[2]!.content).toBe(wrapped("c"));
    expect(out[3]!.content).toBe(wrapped("d"));
    expect(out[4]!.content).toBe(wrapped("e"));
    expect(out[5]!.content).toBe(wrapped("f"));
    expect(out[6]!.content).toBe(wrapped("g"));
    expect(out[7]!.content).toBe("h");
    expect(out[8]!.content).toBe("i");
    expect(out[9]!.content).toBe("j");
  });

  it("clear() drops the highlighting so subsequent patches pass through", () => {
    const overlay = createSelectionOverlay();
    overlay.set({ startRow: 0, startCol: 0, endRow: 0, endCol: 100 });
    const patches: Patch[] = [patch(3, 0, "x")];
    const highlighted = overlay.applyTo(patches);
    expect(highlighted[0]!.content).toBe(`${INVERSE_ON}x${INVERSE_OFF}`);

    overlay.clear();
    expect(overlay.current).toBeNull();

    const plain = overlay.applyTo(patches);
    expect(plain[0]!.content).toBe("x");
  });

  it("set(null) is equivalent to clear()", () => {
    const overlay = createSelectionOverlay();
    overlay.set({ startRow: 0, startCol: 0, endRow: 0, endCol: 100 });
    overlay.set(null);
    expect(overlay.current).toBeNull();
    const out = overlay.applyTo([patch(0, 0, "z")]);
    expect(out[0]!.content).toBe("z");
  });

  it("preserves patch geometry (x, y, visualWidth, styleId) when highlighting", () => {
    const overlay = createSelectionOverlay();
    overlay.set({ startRow: 0, startCol: 0, endRow: 0, endCol: 10 });
    const original: Patch = { x: 3, y: 0, content: "Z", visualWidth: 2, styleId: 42 };
    const out = overlay.applyTo([original]);
    expect(out[0]!.x).toBe(3);
    expect(out[0]!.y).toBe(0);
    expect(out[0]!.visualWidth).toBe(2);
    expect(out[0]!.styleId).toBe(42);
    expect(out[0]!.content).toBe(`${INVERSE_ON}Z${INVERSE_OFF}`);
  });

  it("applyTo on an empty patch list returns an empty list", () => {
    const overlay = createSelectionOverlay();
    // Both with and without an active selection.
    expect(overlay.applyTo([])).toHaveLength(0);
    overlay.set({ startRow: 0, startCol: 0, endRow: 10, endCol: 10 });
    expect(overlay.applyTo([])).toHaveLength(0);
  });
});
