import { describe, expect, test } from "bun:test";
import {
  DARK_THEME,
  DARK_DALTONIZED_THEME,
  LIGHT_THEME,
} from "../themes/themes.ts";
import { orderedListMarker, orderedMarkerColor } from "./OrderedList.tsx";

describe("orderedListMarker", () => {
  test("single-digit lists need no padding", () => {
    const markers = Array.from({ length: 9 }, (_, i) => orderedListMarker(i, 9));
    expect(markers[0]).toBe("1.");
    expect(markers[8]).toBe("9.");
    // Every marker in a <10 list is exactly two chars: digit + dot.
    for (const m of markers) expect(m.length).toBe(2);
  });

  test("multi-digit lists right-align by padding the narrow markers", () => {
    const markers = Array.from({ length: 12 }, (_, i) => orderedListMarker(i, 12));
    expect(markers[0]).toBe(" 1.");
    expect(markers[8]).toBe(" 9.");
    expect(markers[9]).toBe("10.");
    expect(markers[11]).toBe("12.");
    // Uniform width keeps the trailing dots in one column.
    const widths = new Set(markers.map((m) => m.length));
    expect(widths.size).toBe(1);
    expect([...widths][0]).toBe(3);
  });

  test("padding width tracks the item count, not the current index", () => {
    // Same index, different list sizes -> different padding.
    expect(orderedListMarker(0, 9)).toBe("1.");
    expect(orderedListMarker(0, 10)).toBe(" 1.");
    expect(orderedListMarker(0, 100)).toBe("  1.");
  });

  test("nesting composes the parent marker into a dotted prefix", () => {
    const parent = orderedListMarker(0, 3); // "1."
    expect(orderedListMarker(0, 2, parent)).toBe("1.1.");
    expect(orderedListMarker(1, 2, parent)).toBe("1.2.");

    const second = orderedListMarker(1, 3); // "2."
    expect(orderedListMarker(0, 4, second)).toBe("2.1.");
    expect(orderedListMarker(9, 12, second)).toBe("2.10.");
  });

  test("deep nesting keeps composing prefixes", () => {
    const l1 = orderedListMarker(2, 5); // "3."
    const l2 = orderedListMarker(0, 2, l1); // "3.1."
    expect(orderedListMarker(0, 3, l2)).toBe("3.1.1.");
  });
});

describe("orderedMarkerColor", () => {
  test("uses the theme's muted UI token across themes", () => {
    for (const theme of [DARK_THEME, LIGHT_THEME, DARK_DALTONIZED_THEME]) {
      expect(orderedMarkerColor(theme)).toBe(theme.uiMuted);
    }
  });

  test("never resolves to a money or risk colour", () => {
    const c = orderedMarkerColor(DARK_THEME);
    expect(c).not.toBe(DARK_THEME.moneyProfit);
    expect(c).not.toBe(DARK_THEME.moneyLoss);
    expect(c).not.toBe(DARK_THEME.riskDanger);
  });
});
