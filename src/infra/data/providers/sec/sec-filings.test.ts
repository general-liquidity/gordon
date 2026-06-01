import { describe, expect, test } from "bun:test";
import { stripFilingHtml, pickFiling, type RecentFilings } from "./sec-filings.ts";

describe("stripFilingHtml", () => {
  test("decodes numeric entities and normalizes smart apostrophes", () => {
    // The live Apple 10-K carried "Management&#8217;s" (curly apostrophe) which
    // broke a naive matcher; after strip it must be a straight ASCII apostrophe.
    const html = "<p>Item 7. Management&#8217;s Discussion&nbsp;and Analysis</p>";
    expect(stripFilingHtml(html)).toBe("Item 7. Management's Discussion and Analysis");
  });

  test("strips script/style/tags and collapses whitespace", () => {
    const html = "<style>.x{color:red}</style><div>Risk   Factors</div><script>x()</script>";
    expect(stripFilingHtml(html)).toBe("Risk Factors");
  });

  test("normalizes en/em dashes and curly quotes to ASCII", () => {
    expect(stripFilingHtml("A — “quote” – end")).toBe('A - "quote" - end');
  });

  test("decodes hex entities", () => {
    expect(stripFilingHtml("fish &#x26; chips")).toBe("fish & chips");
  });
});

describe("pickFiling", () => {
  // EDGAR returns filings.recent newest-first.
  const recent: RecentFilings = {
    form: ["8-K", "10-Q", "10-K", "10-K", "10-K"],
    accessionNumber: ["a-0", "a-1", "a-2", "a-3", "a-4"],
    primaryDocument: ["d0.htm", "d1.htm", "d2.htm", "d3.htm", "d4.htm"],
    filingDate: ["2025-05-01", "2025-04-01", "2025-01-15", "2024-01-15", "2023-01-15"],
  };

  test("skip=0 returns the most recent filing of the requested form", () => {
    const r = pickFiling(recent, "10-K", 0);
    expect(r?.accessionNumber).toBe("a-2");
    expect(r?.primaryDocument).toBe("d2.htm");
    expect(r?.filingDate).toBe("2025-01-15");
  });

  test("skip=1 returns the prior filing of the same form (year-over-year)", () => {
    const r = pickFiling(recent, "10-K", 1);
    expect(r?.accessionNumber).toBe("a-3");
    expect(r?.filingDate).toBe("2024-01-15");
  });

  test("returns null when the form is absent", () => {
    expect(pickFiling(recent, "S-1", 0)).toBeNull();
  });

  test("returns null when skip exceeds the number of matching filings", () => {
    expect(pickFiling(recent, "10-Q", 1)).toBeNull();
  });

  test("skips entries missing a primary document", () => {
    const partial: RecentFilings = {
      form: ["10-K", "10-K"],
      accessionNumber: ["a", "b"],
      primaryDocument: ["", "b.htm"],
      filingDate: ["2025-01-01", "2024-01-01"],
    };
    const r = pickFiling(partial, "10-K", 0);
    expect(r?.accessionNumber).toBe("b");
  });
});
