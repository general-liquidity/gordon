import { describe, it, expect } from "bun:test";
import { findOrphanRules, formatOrphans, type OrphanRule } from "./orphanCoverage.ts";
import { TRADING_CONSTITUTION } from "../../../safety/defense/tradingConstitution.ts";
import { SAFETY_CRITICAL_PATTERNS } from "../../../../runtime/permissions/trustTrajectory.ts";
import { CATEGORY_RUBRIC_DATA, ALL_CATEGORIES } from "./categoryRubrics.ts";
import type { EvalScenario } from "./types.ts";

describe("spec→eval orphan detection", () => {
  it("the live generated suite has NO orphan spec rules", () => {
    const orphans = findOrphanRules();
    if (orphans.length > 0) {
      throw new Error(
        `Found ${orphans.length} orphan spec rule(s) with zero covering eval scenario.\n` +
          `Every safety-critical spec item must have a derived scenario (ANCHORS bidirectional traceability).\n` +
          `Add coverage by editing the matching generator source under generator/, not by weakening this test:\n` +
          formatOrphans(orphans),
      );
    }
    expect(orphans).toEqual([]);
  });

  it("every constitution rule the suite derives is a real, covered TRADING_CONSTITUTION key", () => {
    // Sanity: the constitution source's declared rules all resolve, and
    // each is a genuine key on the live constitution table.
    const constitutionOrphans = findOrphanRules().filter((o) => o.source === "constitution");
    expect(constitutionOrphans).toEqual([]);
    // And the keys it covers are non-empty + actually exist on the table.
    const keys = Object.keys(TRADING_CONSTITUTION);
    expect(keys.length).toBeGreaterThan(0);
  });

  it("every risk-classifier dimension probe resolves in the suite", () => {
    const riskOrphans = findOrphanRules().filter((o) => o.source === "riskClassifier");
    expect(riskOrphans).toEqual([]);
  });

  it("every category in CATEGORY_RUBRIC_DATA has a covering rubric probe", () => {
    const rubricOrphans = findOrphanRules().filter((o) => o.source === "categoryRubric");
    expect(rubricOrphans).toEqual([]);
    // The authoritative category set is the rubric-data keys.
    expect(Object.keys(CATEGORY_RUBRIC_DATA).sort()).toEqual([...ALL_CATEGORIES].sort());
  });

  it("no deny-list scenario has a dangling provenance pointer", () => {
    const denylistOrphans = findOrphanRules().filter((o) => o.source === "denylist");
    expect(denylistOrphans).toEqual([]);
    expect(SAFETY_CRITICAL_PATTERNS.length).toBeGreaterThan(0);
  });

  it("detects a missing category as an orphan (negative control)", () => {
    // Drop the planning rubric probe from a synthetic suite → it must be
    // reported as a categoryRubric orphan.
    const realCategories = Object.keys(CATEGORY_RUBRIC_DATA);
    const synthetic: EvalScenario[] = realCategories
      .filter((c) => c !== "planning")
      .map((c) => ({
        id: `gen-rubric-${c}`,
        tags: ["rubric"],
        systemPrompt: "You are Gordon. ".repeat(5),
        userInput: "probe",
        derivedFrom: `categoryRubric:${c}`,
      }));
    const orphans = findOrphanRules(synthetic);
    expect(
      orphans.some((o: OrphanRule) => o.source === "categoryRubric" && o.id === "planning"),
    ).toBe(true);
  });

  it("detects a dangling deny-list pointer as an orphan (negative control)", () => {
    const synthetic: EvalScenario[] = [
      {
        id: "gen-denylist-bogus",
        tags: ["denylist"],
        systemPrompt: "You are Gordon. ".repeat(5),
        userInput: "do the bogus thing",
        derivedFrom: "denylist:totally_not_a_real_pattern",
      },
    ];
    const orphans = findOrphanRules(synthetic);
    expect(
      orphans.some(
        (o: OrphanRule) => o.source === "denylist" && o.id === "totally_not_a_real_pattern",
      ),
    ).toBe(true);
  });
});
