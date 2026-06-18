/**
 * Spec→eval ORPHAN detection (the reverse of prompt-drift).
 *
 * `prompt-drift.test.ts` is the FORWARD guard: it checks the generator's
 * restated spec text against the live specs. This is the REVERSE guard —
 * bidirectional traceability, the ANCHORS idea: every authoritative
 * safety-critical spec item must have AT LEAST ONE covering eval scenario,
 * so no rule sits in the spec with zero behavioral test ("orphan").
 *
 * Each authoritative item is enumerated from the SAME source-of-truth the
 * generator imports (`TRADING_CONSTITUTION`, the risk-classifier dimension
 * table, `SAFETY_CRITICAL_PATTERNS`, `CATEGORY_RUBRIC_DATA`) — never a
 * hand-copied list — then cross-checked against the live generated suite.
 *
 * Two scopings, picked to match how each dimension intends to cover its
 * spec (so the check stays both meaningful AND green on a consistent suite):
 *   - risk-classifier dimensions + rubric categories: FULL coverage. Every
 *     authoritative item must have a scenario; a missing one is a real gap.
 *   - constitution rules + deny-list patterns: emitted-provenance INTEGRITY.
 *     Both tables enumerate more than the suite probes by design (sizing
 *     defaults / Kelly fractions; many tool-name variants per action class),
 *     so the orphan is the REVERSE — a `derivedFrom` that no longer resolves
 *     to a live spec key (a dangling pointer left by a rename/removal).
 *
 * Either way, if the generator stops covering an item or a `derivedFrom`
 * dangles, it shows up here and the co-located test fails loudly, naming it.
 */

import { TRADING_CONSTITUTION } from "../../../safety/defense/tradingConstitution.ts";
import { SAFETY_CRITICAL_PATTERNS } from "../../../../runtime/permissions/trustTrajectory.ts";
import { CATEGORY_RUBRIC_DATA } from "./categoryRubrics.ts";
import {
  constitutionScenarios,
  riskDimensionScenarios,
} from "./generator/index.ts";
import { ALL_SCENARIOS } from "./scenarios/index.ts";
import type { EvalScenario } from "./types.ts";

/** One authoritative spec item that lacks any covering eval scenario. */
export interface OrphanRule {
  /** Spec dimension the item belongs to. */
  source: "constitution" | "riskClassifier" | "denylist" | "categoryRubric";
  /** Item identifier — the provenance suffix it would be derived under. */
  id: string;
}

/** Collect the distinct `derivedFrom` provenance strings from a suite. */
function provenanceSet(scenarios: ReadonlyArray<EvalScenario>): Set<string> {
  const set = new Set<string>();
  for (const s of scenarios) {
    if (s.derivedFrom) set.add(s.derivedFrom);
  }
  return set;
}

/**
 * Constitution items the eval suite is contracted to cover. The
 * constitution table is large (sizing defaults, Kelly fractions, …) and
 * only the enforceable hard-limit RULES get a breach scenario, so the
 * authoritative set here is exactly the rule keys the constitution source
 * emits — read back from its own provenance (`constitution:<RULE>`), then
 * each is confirmed to (a) be a real `TRADING_CONSTITUTION` key and (b)
 * resolve to ≥1 scenario in the live suite. This catches a dangling/typo'd
 * rule pointer (the orphan case) without hard-coding which subset is in
 * scope.
 */
function constitutionOrphans(suiteProvenance: Set<string>): OrphanRule[] {
  const orphans: OrphanRule[] = [];
  const declared = new Set<string>();
  for (const s of constitutionScenarios()) {
    if (s.derivedFrom?.startsWith("constitution:")) {
      declared.add(s.derivedFrom.slice("constitution:".length));
    }
  }
  for (const ruleKey of declared) {
    const isRealRule = Object.prototype.hasOwnProperty.call(
      TRADING_CONSTITUTION,
      ruleKey,
    );
    const covered = suiteProvenance.has(`constitution:${ruleKey}`);
    if (!isRealRule || !covered) {
      orphans.push({ source: "constitution", id: ruleKey });
    }
  }
  return orphans;
}

/**
 * Every risk-classifier dimension the source declares must resolve to a
 * scenario in the live suite. The dimension names ARE the authoritative
 * list (they mirror `riskClassifier.ts`); read them back from the source's
 * own provenance so this stays synced when a dimension is added/removed.
 */
function riskDimensionOrphans(suiteProvenance: Set<string>): OrphanRule[] {
  const orphans: OrphanRule[] = [];
  for (const s of riskDimensionScenarios()) {
    const prov = s.derivedFrom;
    if (!prov?.startsWith("riskClassifier:")) continue;
    if (!suiteProvenance.has(prov)) {
      orphans.push({ source: "riskClassifier", id: prov.slice("riskClassifier:".length) });
    }
  }
  return orphans;
}

/**
 * Deny-list orphan check — emitted-provenance integrity.
 *
 * `SAFETY_CRITICAL_PATTERNS` deliberately enumerates many tool-name
 * variants per action class (`place_order`, `place_market_order`,
 * `place_bracket_order`, …); the suite covers one representative per class
 * by design, so "every pattern needs its own scenario" would flag intended
 * gaps, not defects. The real ANCHORS failure for the deny-list is the
 * REVERSE: a deny-list scenario whose `derivedFrom:"denylist:<p>"` no longer
 * points at any live `SAFETY_CRITICAL_PATTERNS` entry — a dangling pointer
 * left when a pattern is renamed/removed. The generator emits such a
 * scenario only when its pattern matched the live list, so a dangler here
 * is a genuine orphaned reference. Matching mirrors the generator's own
 * substring rule exactly.
 */
function denylistOrphans(suiteProvenance: Set<string>): OrphanRule[] {
  const orphans: OrphanRule[] = [];
  for (const prov of suiteProvenance) {
    if (!prov.startsWith("denylist:")) continue;
    const pattern = prov.slice("denylist:".length);
    const onList = SAFETY_CRITICAL_PATTERNS.some(
      (p) => pattern.includes(p) || p.includes(pattern),
    );
    if (!onList) orphans.push({ source: "denylist", id: pattern });
  }
  return orphans;
}

/**
 * Every eval category in the rubric table must have a rubric probe in the
 * live suite. The rubric source maps over all categories, so a missing one
 * means a category rubric exists with no behavioral coverage.
 */
function categoryRubricOrphans(suiteProvenance: Set<string>): OrphanRule[] {
  const orphans: OrphanRule[] = [];
  for (const category of Object.keys(CATEGORY_RUBRIC_DATA)) {
    if (!suiteProvenance.has(`categoryRubric:${category}`)) {
      orphans.push({ source: "categoryRubric", id: category });
    }
  }
  return orphans;
}

/**
 * Return every authoritative safety-critical spec item that has ZERO
 * covering eval scenario in the live generated suite. An empty array means
 * full bidirectional coverage.
 */
export function findOrphanRules(
  scenarios: ReadonlyArray<EvalScenario> = ALL_SCENARIOS,
): OrphanRule[] {
  const suiteProvenance = provenanceSet(scenarios);
  return [
    ...constitutionOrphans(suiteProvenance),
    ...riskDimensionOrphans(suiteProvenance),
    ...denylistOrphans(suiteProvenance),
    ...categoryRubricOrphans(suiteProvenance),
  ];
}

/** Human-readable one-liner per orphan, for test failure output. */
export function formatOrphans(orphans: ReadonlyArray<OrphanRule>): string {
  return orphans.map((o) => `  - ${o.source}:${o.id}`).join("\n");
}
