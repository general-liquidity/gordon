import { describe, it, expect } from "bun:test";

import {
  auditRiskBundle,
  formatAudit,
  auditToPayload,
  type RiskItem,
} from "./riskBundleAuditor.ts";

const allCovered: RiskItem[] = [
  { category: "thesis", tag: "yes", reason: "supply tightness" },
  { category: "market", tag: "neutral" },
  { category: "sector", tag: "neutral" },
  { category: "liquidity", tag: "yes", reason: "crude is liquid" },
  { category: "execution", tag: "neutral" },
  { category: "correlation", tag: "neutral" },
  { category: "gap", tag: "no", hedge: "flat by Friday close" },
  { category: "operational", tag: "neutral" },
];

describe("auditRiskBundle — complete coverage", () => {
  it("go verdict when all categories covered and no unhedged 'no'", () => {
    const r = auditRiskBundle({ items: allCovered });
    expect(r.verdict).toBe("go");
    expect(r.blockers).toEqual([]);
    expect(r.paidRisks.length).toBe(2);
  });

  it("incomplete when a category is missing", () => {
    const r = auditRiskBundle({ items: allCovered.slice(0, 5) });
    expect(r.verdict).toBe("incomplete");
    expect(r.uncoveredCategories.length).toBeGreaterThan(0);
    expect(r.blockers[0]).toContain("Missing audit for");
  });

  it("no_go when 'no' tagged without hedge", () => {
    const items = allCovered.map((i) =>
      i.category === "gap" ? { ...i, hedge: undefined } : i,
    );
    const r = auditRiskBundle({ items });
    expect(r.verdict).toBe("no_go");
    expect(r.unhedgedNoItems[0]!.category).toBe("gap");
  });

  it("no_go when no category is tagged 'yes' (no edge)", () => {
    const items = allCovered.map((i) =>
      i.tag === "yes" ? { ...i, tag: "neutral" as const, reason: undefined } : i,
    );
    const r = auditRiskBundle({ items });
    expect(r.verdict).toBe("no_go");
    expect(r.blockers.some((b) => b.includes("no edge"))).toBe(true);
  });
});

describe("auditRiskBundle — Wright Ch 10 crude oil example", () => {
  it("replicates the long-crude audit end-to-end", () => {
    const r = auditRiskBundle({
      items: [
        { category: "thesis", tag: "yes", reason: "supply/demand imbalance — my edge" },
        { category: "market", tag: "neutral", reason: "managed via position size" },
        { category: "sector", tag: "neutral" },
        { category: "liquidity", tag: "yes", reason: "futures highly liquid" },
        { category: "execution", tag: "neutral" },
        { category: "correlation", tag: "yes", reason: "no other energy exposure" },
        { category: "gap", tag: "no", hedge: "no weekend hold; halve size overnight" },
        { category: "operational", tag: "neutral", reason: "stops in market not mental" },
      ],
    });
    expect(r.verdict).toBe("go");
  });
});

describe("formatAudit + auditToPayload", () => {
  it("formats human-readable summary", () => {
    const r = auditRiskBundle({ items: allCovered });
    const out = formatAudit(r);
    expect(out).toContain("Risk bundle audit");
    expect(out).toContain("thesis: YES");
    expect(out).toContain("gap: NO");
    expect(out).toContain("hedge:");
  });

  it("formats incomplete with missing list", () => {
    const r = auditRiskBundle({ items: allCovered.slice(0, 3) });
    const out = formatAudit(r);
    expect(out).toContain("INCOMPLETE");
    expect(out).toContain("<missing>");
  });

  it("payload stable shape", () => {
    const r = auditRiskBundle({ items: allCovered });
    const p = auditToPayload(r) as { kind: string; verdict: string };
    expect(p.kind).toBe("risk_bundle.audited");
    expect(p.verdict).toBe("go");
  });
});
