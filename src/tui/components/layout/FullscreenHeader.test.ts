import { describe, expect, it } from "bun:test";

import { resolveHeaderVariant, estimateHeaderRows } from "./FullscreenHeader.tsx";

// The fullscreen header is the SCROLL ORIGIN (you scroll up to reach it),
// not a pinned region — so terminal HEIGHT must never shrink it or drop the
// session + preflight boxes. Only terminal WIDTH flexes the banner art.
describe("FullscreenHeader variant resolution", () => {
  it("is width-driven only — terminal height never changes the variant", () => {
    for (const rows of [10, 20, 24, 30, 50, 120]) {
      expect(resolveHeaderVariant(rows, 100)).toBe("full");
      expect(resolveHeaderVariant(rows, 40)).toBe("compact");
    }
  });

  it("uses the full block logo only when the terminal is wide enough", () => {
    expect(resolveHeaderVariant(40, 100)).toBe("full");
    expect(resolveHeaderVariant(40, 59)).toBe("compact");
  });

  it("always reserves rows for both boxes — even the compact variant", () => {
    // 9 (session) + 9 (preflight) + banner + margin → never the old 3-row
    // boxless header. Both variants keep the boxes.
    expect(estimateHeaderRows("compact")).toBeGreaterThanOrEqual(18);
    expect(estimateHeaderRows("full")).toBeGreaterThan(estimateHeaderRows("compact"));
  });
});
