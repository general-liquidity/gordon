import { describe, expect, test } from "bun:test";
import { formatConstraint, identifyConstraint } from "./constraint-identifier.ts";

describe("identifyConstraint", () => {
  test("all components meet target → no_constraint", () => {
    const r = identifyConstraint({
      winRate: { current: 0.6, target: 0.5 },
      avgWin: { current: 1.5, target: 1.0 },
      avgLoss: { current: 0.5, target: 1.0 },
      frequency: { current: 50, target: 30 },
    });
    expect(r.verdict).toBe("no_constraint");
    expect(r.dominantConstraint).toBeNull();
    expect(r.components.every((c) => c.meetsTarget)).toBe(true);
  });

  test("zero sample size → insufficient_data", () => {
    const r = identifyConstraint({
      winRate: { current: 0.0, target: 0.5 },
      avgWin: { current: 0.0, target: 1.0 },
      avgLoss: { current: 0.0, target: 1.0 },
      frequency: { current: 0.0, target: 30 },
      sampleSize: 0,
    });
    expect(r.verdict).toBe("insufficient_data");
  });

  test("low sample size flags low confidence", () => {
    const r = identifyConstraint({
      winRate: { current: 0.4, target: 0.55 },
      avgWin: { current: 1.5, target: 1.5 },
      avgLoss: { current: 0.8, target: 1.0 },
      frequency: { current: 30, target: 30 },
      sampleSize: 12,
      minSampleSize: 30,
    });
    expect(r.lowConfidence).toBe(true);
    expect(r.summary).toContain("Low confidence");
  });

  test("low win rate → win_rate is dominant constraint", () => {
    const r = identifyConstraint({
      winRate: { current: 0.30, target: 0.55 },
      avgWin: { current: 1.5, target: 1.5 },
      avgLoss: { current: 1.0, target: 1.0 },
      frequency: { current: 30, target: 30 },
    });
    expect(r.verdict).toBe("constraint_identified");
    expect(r.dominantConstraint?.component).toBe("win_rate");
    expect(r.dominantConstraint?.normalizedDeficit).toBeGreaterThan(0);
  });

  test("losses too large → avg_loss is dominant constraint", () => {
    const r = identifyConstraint({
      winRate: { current: 0.55, target: 0.55 },
      avgWin: { current: 1.5, target: 1.5 },
      avgLoss: { current: 2.5, target: 1.0 }, // 150% over target
      frequency: { current: 30, target: 30 },
    });
    expect(r.verdict).toBe("constraint_identified");
    expect(r.dominantConstraint?.component).toBe("avg_loss");
  });

  test("avg_win below target", () => {
    const r = identifyConstraint({
      winRate: { current: 0.55, target: 0.55 },
      avgWin: { current: 0.7, target: 2.0 },
      avgLoss: { current: 1.0, target: 1.0 },
      frequency: { current: 30, target: 30 },
    });
    expect(r.dominantConstraint?.component).toBe("avg_win");
  });

  test("low trade frequency → frequency dominant", () => {
    const r = identifyConstraint({
      winRate: { current: 0.55, target: 0.55 },
      avgWin: { current: 1.5, target: 1.5 },
      avgLoss: { current: 1.0, target: 1.0 },
      frequency: { current: 3, target: 30 },
    });
    expect(r.dominantConstraint?.component).toBe("frequency");
  });

  test("ranking is stable and largest-first", () => {
    const r = identifyConstraint({
      winRate: { current: 0.50, target: 0.55 }, // 9% deficit
      avgWin: { current: 1.2, target: 1.5 }, // 20% deficit
      avgLoss: { current: 1.5, target: 1.0 }, // 50% above
      frequency: { current: 30, target: 30 },
    });
    expect(r.rankedByDeficit[0]!.component).toBe("avg_loss");
    expect(r.rankedByDeficit[1]!.component).toBe("avg_win");
    expect(r.rankedByDeficit[2]!.component).toBe("win_rate");
  });

  test("recommended lever attached per component", () => {
    const r = identifyConstraint({
      winRate: { current: 0.30, target: 0.55 },
      avgWin: { current: 1.5, target: 1.5 },
      avgLoss: { current: 1.0, target: 1.0 },
      frequency: { current: 30, target: 30 },
    });
    expect(r.dominantConstraint?.recommendedLever).toContain("Reduce mistakes");
  });

  test("meetsTarget flag flipped correctly per component", () => {
    const r = identifyConstraint({
      winRate: { current: 0.60, target: 0.55 },
      avgWin: { current: 1.5, target: 1.5 },
      avgLoss: { current: 1.5, target: 1.0 },
      frequency: { current: 25, target: 30 },
    });
    const byComponent = Object.fromEntries(r.components.map((c) => [c.component, c]));
    expect(byComponent["win_rate"]!.meetsTarget).toBe(true);
    expect(byComponent["avg_win"]!.meetsTarget).toBe(true);
    expect(byComponent["avg_loss"]!.meetsTarget).toBe(false);
    expect(byComponent["frequency"]!.meetsTarget).toBe(false);
  });
});

describe("formatConstraint", () => {
  test("renders header + ranked table", () => {
    const r = identifyConstraint({
      winRate: { current: 0.40, target: 0.55 },
      avgWin: { current: 1.5, target: 1.5 },
      avgLoss: { current: 1.0, target: 1.0 },
      frequency: { current: 30, target: 30 },
    });
    const text = formatConstraint(r);
    expect(text).toContain("EV Constraint");
    expect(text).toContain("CONSTRAINT_IDENTIFIED");
    expect(text).toContain("win_rate");
  });
});
