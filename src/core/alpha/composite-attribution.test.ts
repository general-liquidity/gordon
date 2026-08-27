import { describe, it, expect } from "bun:test";
import { explainCompositeAttribution, formatAttributionTable } from "./composite-attribution.ts";
import type { RiskAssessment } from "../../infra/trading/risk/riskClassifier.ts";

function makeAssessment(
  dims: Array<{ name: string; score: number; weight: number; reason?: string }>,
  override: Partial<RiskAssessment> = {},
): RiskAssessment {
  const totalWeight = dims.reduce((sum, d) => sum + d.weight, 0);
  const composite =
    totalWeight > 0 ? dims.reduce((sum, d) => sum + d.score * d.weight, 0) / totalWeight : 0;
  return {
    compositeScore: composite,
    tier: composite < 25 ? "low" : composite < 50 ? "medium" : composite < 75 ? "high" : "critical",
    dimensions: dims.map((d) => ({
      name: d.name,
      score: d.score,
      weight: d.weight,
      reason: d.reason ?? `score ${d.score}`,
    })),
    topFactors: [],
    recommendation:
      composite < 25
        ? "auto_approve"
        : composite < 50
          ? "prompt_user"
          : composite < 75
            ? "require_confirmation"
            : "block",
    summary: "test",
    ...override,
  };
}

describe("explainCompositeAttribution — basic structure", () => {
  it("returns empty arrays + null drivers when no dimensions", () => {
    const attr = explainCompositeAttribution(makeAssessment([]));
    expect(attr.dimensionsByContribution.length).toBe(0);
    expect(attr.topDriver).toBeNull();
    expect(attr.bottomDriver).toBeNull();
    expect(attr.summary).toContain("no dimensions");
  });

  it("computes contribution percentages summing to 100", () => {
    const attr = explainCompositeAttribution(
      makeAssessment([
        { name: "A", score: 50, weight: 1 },
        { name: "B", score: 30, weight: 2 },
      ]),
    );
    const totalPct = attr.dimensionsByContribution.reduce((s, d) => s + d.contributionPct, 0);
    expect(totalPct).toBeCloseTo(100, 4);
  });

  it("preserves total weight + weighted score", () => {
    const attr = explainCompositeAttribution(
      makeAssessment([
        { name: "A", score: 50, weight: 1 },
        { name: "B", score: 30, weight: 2 },
      ]),
    );
    expect(attr.totalWeight).toBe(3);
    expect(attr.totalWeightedScore).toBe(50 * 1 + 30 * 2);
  });
});

describe("explainCompositeAttribution — top + bottom drivers", () => {
  it("topDriver is the highest weighted-score dimension", () => {
    const attr = explainCompositeAttribution(
      makeAssessment([
        { name: "Low", score: 10, weight: 1 },
        { name: "Medium", score: 50, weight: 1 },
        { name: "High", score: 80, weight: 2 },
      ]),
    );
    expect(attr.topDriver!.name).toBe("High");
    expect(attr.topDriver!.weightedScore).toBe(160);
  });

  it("bottomDriver is the lowest-non-zero weighted-score dimension", () => {
    const attr = explainCompositeAttribution(
      makeAssessment([
        { name: "Zero", score: 0, weight: 1 },
        { name: "Low", score: 10, weight: 1 },
        { name: "High", score: 90, weight: 2 },
      ]),
    );
    expect(attr.bottomDriver!.name).toBe("Low");
  });

  it("bottomDriver falls back to lowest weighted when all dims are zero", () => {
    const attr = explainCompositeAttribution(
      makeAssessment([
        { name: "A", score: 0, weight: 1.5 },
        { name: "B", score: 0, weight: 0.5 },
      ]),
    );
    expect(attr.topDriver!.name).toBe("A"); // higher weight
    expect(attr.bottomDriver!.name).toBe("B");
  });

  it("dimensions sorted descending by weighted score", () => {
    const attr = explainCompositeAttribution(
      makeAssessment([
        { name: "A", score: 10, weight: 5 }, // weighted = 50
        { name: "B", score: 90, weight: 1 }, // weighted = 90
        { name: "C", score: 20, weight: 3 }, // weighted = 60
      ]),
    );
    expect(attr.dimensionsByContribution.map((d) => d.name)).toEqual(["B", "C", "A"]);
  });
});

describe("explainCompositeAttribution — summary text", () => {
  it("summary mentions composite, tier, and top driver share", () => {
    const attr = explainCompositeAttribution(
      makeAssessment([
        { name: "Position Size", score: 80, weight: 1.5 },
        { name: "Concentration", score: 20, weight: 1 },
      ]),
    );
    expect(attr.summary).toContain("Position Size");
    expect(attr.summary).toContain("%");
  });

  it("summary handles all-clean state", () => {
    const attr = explainCompositeAttribution(
      makeAssessment([
        { name: "A", score: 0, weight: 1 },
        { name: "B", score: 0, weight: 1 },
      ]),
    );
    expect(attr.summary).toContain("all dimensions clean");
  });
});

describe("formatAttributionTable", () => {
  it("returns a multi-line table with headers + per-dimension rows", () => {
    const attr = explainCompositeAttribution(
      makeAssessment([
        { name: "Position Size", score: 50, weight: 1.5, reason: "5% of portfolio" },
        { name: "Concentration", score: 20, weight: 1.0, reason: "isolated" },
      ]),
    );
    const table = formatAttributionTable(attr);
    expect(table).toContain("Composite");
    expect(table).toContain("Position Size");
    expect(table).toContain("Concentration");
    expect(table).toContain("5% of portfolio");
    // Should have at least: header + separator + 2 data rows
    expect(table.split("\n").length).toBeGreaterThanOrEqual(4);
  });

  it("returns (no dimensions) for empty attribution", () => {
    const attr = explainCompositeAttribution(makeAssessment([]));
    expect(formatAttributionTable(attr)).toBe("(no dimensions)");
  });
});
