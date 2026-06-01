import { describe, expect, test } from "bun:test";
import { extractSection, diffFilingSections, SECTION_MARKERS } from "./filing-section-diff.ts";

describe("extractSection", () => {
  test("pulls a named Item section out of a full filing", () => {
    const filing =
      "PART I\nItem 1. Business\nWe make widgets.\n" +
      "Item 1A. Risk Factors\nWe face intense competition. A key supplier could fail.\n" +
      "Item 1B. Unresolved Staff Comments\nNone.\n";
    const rf = extractSection(filing, SECTION_MARKERS.risk_factors.start, SECTION_MARKERS.risk_factors.end);
    expect(rf).toContain("intense competition");
    expect(rf).toContain("key supplier");
    expect(rf).not.toContain("Unresolved");
    expect(rf).not.toContain("widgets");
  });

  test("returns empty when the section marker is absent", () => {
    expect(extractSection("no items here", SECTION_MARKERS.risk_factors.start)).toBe("");
  });
});

describe("diffFilingSections", () => {
  const prior =
    "We face intense competition in our markets. " +
    "Our business depends on key suppliers including Acme Corporation. " +
    "Macroeconomic conditions may adversely affect demand for our products.";
  const current =
    "We face intense competition in our markets. " +
    "Macroeconomic conditions may adversely affect demand for our products. " +
    "A single customer accounted for over thirty percent of revenue this year.";

  test("surfaces new and removed segments, ignores carried-over boilerplate", () => {
    const r = diffFilingSections({ prior, current });
    expect(r.changed).toBe(true);
    expect(r.added.some((s) => /single customer/i.test(s))).toBe(true); // new risk
    expect(r.removed.some((s) => /key suppliers/i.test(s))).toBe(true); // dropped risk
    expect(r.unchangedCount).toBe(2); // competition + macro carried over
    expect(r.addedCount).toBe(1);
    expect(r.removedCount).toBe(1);
  });

  test("identical sections report no material change", () => {
    const r = diffFilingSections({ prior, current: prior });
    expect(r.changed).toBe(false);
    expect(r.added).toEqual([]);
    expect(r.removed).toEqual([]);
  });
});
