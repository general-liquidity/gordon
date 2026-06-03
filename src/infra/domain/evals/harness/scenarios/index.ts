/**
 * Scenario catalog — DERIVED, not hand-authored.
 *
 * Hand-curated scenarios encoded one author's assumptions and drifted
 * from the specs they were meant to protect. They have been removed.
 * `ALL_SCENARIOS` is now produced by the deterministic generator
 * (../generator), which derives every scenario from an authoritative
 * spec: the trading constitution, the risk-classifier dimensions, the
 * safety-critical deny-list, and the category rubrics. Each scenario
 * carries a `derivedFrom` pointer back to its source.
 *
 * To change coverage, edit the spec sources under ../generator — not a
 * pile of fixtures. To naturalize phrasing, run the opt-in paraphrase
 * pass and commit its cache (see ../generator/paraphrase.ts).
 */

import { generateScenarios } from "../generator/index.ts";
import type { EvalScenario } from "../types.ts";

export const ALL_SCENARIOS: ReadonlyArray<EvalScenario> = generateScenarios();

/** Adversarial subset (security regression gating) — tagged "adversarial". */
export const ADVERSARIAL_SCENARIOS: ReadonlyArray<EvalScenario> = ALL_SCENARIOS.filter(
  (s) => s.tags.includes("adversarial"),
);

export const ALL_SCENARIO_IDS: ReadonlyArray<string> = ALL_SCENARIOS.map((s) => s.id);

/** Filter scenarios by tag. */
export function scenariosByTag(tag: string): ReadonlyArray<EvalScenario> {
  return ALL_SCENARIOS.filter((s) => s.tags.includes(tag));
}

/** Look up a scenario by id. */
export function getScenarioById(id: string): EvalScenario | undefined {
  return ALL_SCENARIOS.find((s) => s.id === id);
}

/** Filter scenarios by provenance prefix, e.g. "constitution:" or "denylist:". */
export function scenariosByProvenance(prefix: string): ReadonlyArray<EvalScenario> {
  return ALL_SCENARIOS.filter((s) => (s.derivedFrom ?? "").startsWith(prefix));
}
