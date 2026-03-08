import { describe, expect, it } from "bun:test";

import { fitColumnWidths, truncateWithEllipsis } from "./layout.ts";

describe("layout helpers", () => {
  it("truncates long values with ellipsis", () => {
    expect(truncateWithEllipsis("Preview order", 8)).toBe("Previ...");
    expect(truncateWithEllipsis("Scan", 8)).toBe("Scan");
  });

  it("fits column widths into an available total width", () => {
    const widths = fitColumnWidths({
      widths: [20, 20, 20],
      maxTotalWidth: 48,
      minWidth: 10,
    });

    expect(widths.reduce((sum, width) => sum + width, 0)).toBeLessThanOrEqual(48);
    expect(widths.every((width) => width >= 10)).toBe(true);
  });
});
