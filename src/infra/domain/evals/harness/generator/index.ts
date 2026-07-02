/**
 * Scenario generator — derives the eval suite from Gordon's authoritative
 * specs instead of hand-authored fixtures.
 *
 * Motivation: hand-curated scenarios encode a single author's assumptions
 * and drift from the specs they were meant to protect. Here every scenario
 * is a DERIVED FACT — traceable (via `derivedFrom`) to a constitution rule,
 * a risk-classifier dimension, a deny-list pattern, or a category rubric —
 * and it regenerates automatically when the underlying spec changes.
 *
 * This mirrors ASSERT's spec→eval pipeline, except Gordon's "systematize"
 * and "taxonomize" stages already live in code as typed tables, so the
 * generator is deterministic (no LLM at generation time). An optional
 * LLM-paraphrase pass (./paraphrase.ts) naturalizes the inputs and caches
 * the result, leaving the deterministic core as the stable regression gate.
 */

import type { EvalScenario } from "../types.ts";
import { constitutionScenarios } from "./constitution-source.ts";
import { riskDimensionScenarios } from "./risk-dimension-source.ts";
import { denylistScenarios } from "./denylist-source.ts";
import { rubricRedFlagScenarios } from "./rubric-source.ts";
import { memoryScenarios } from "./memory-source.ts";

export type GeneratorSource =
  | "constitution"
  | "risk-dimension"
  | "denylist"
  | "rubric"
  | "memory";

export const ALL_GENERATOR_SOURCES: ReadonlyArray<GeneratorSource> = [
  "constitution",
  "risk-dimension",
  "denylist",
  "rubric",
  "memory",
];

const SOURCE_FNS: Record<GeneratorSource, () => EvalScenario[]> = {
  constitution: constitutionScenarios,
  "risk-dimension": riskDimensionScenarios,
  denylist: denylistScenarios,
  rubric: rubricRedFlagScenarios,
  memory: memoryScenarios,
};

export interface GenerateOptions {
  /** Restrict to a subset of sources. Defaults to all sources. */
  sources?: ReadonlyArray<GeneratorSource>;
}

/**
 * Generate the full deterministic scenario suite. Stable across calls:
 * same specs → same scenarios → meaningful regression diffs. Deduped by
 * id and sorted by id for reproducible ordering.
 */
export function generateScenarios(opts: GenerateOptions = {}): EvalScenario[] {
  const sources = opts.sources ?? ALL_GENERATOR_SOURCES;
  const seen = new Set<string>();
  const out: EvalScenario[] = [];
  for (const source of sources) {
    for (const scenario of SOURCE_FNS[source]()) {
      if (seen.has(scenario.id)) continue;
      seen.add(scenario.id);
      out.push(scenario);
    }
  }
  out.sort((a, b) => a.id.localeCompare(b.id));
  return out;
}

export {
  constitutionScenarios,
  riskDimensionScenarios,
  denylistScenarios,
  rubricRedFlagScenarios,
  memoryScenarios,
};

export {
  paraphraseScenarios,
  mergeParaphrased,
  writeParaphraseCache,
  readParaphraseCache,
  defaultParaphraseCachePath,
  buildMockParaphraseClient,
  loadScenariosWithParaphrase,
} from "./paraphrase.ts";
export type { ParaphraseOptions, MockParaphraseOptions } from "./paraphrase.ts";
