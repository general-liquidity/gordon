/**
 * Fixture generator — regenerates the committed eval-gate fixtures from the
 * deterministic dry-run producer (the same synthesis path as
 * GORDON_EVAL_DRY_RUN=1). No LLM calls, no sandbox, no side effects.
 *
 * Run after any change to the scenario generator or the dry-run synthesis,
 * then commit the updated JSON:
 *
 *   bun run src/infra/domain/evals/fixtures/generateFixtures.ts
 *
 * Refuses (exit 1) to write a gold fixture containing a trace that fails the
 * deterministic process checks — a gold trace is by definition known-good.
 */

import { writeFileSync } from "node:fs";
import { relative } from "node:path";

import { generateScenarios } from "../harness/generator/index.ts";
import { runScenarioLive } from "../harness/live/runner.ts";
import { scoreTrace } from "../harness/traces/traceScorer.ts";
import {
  BASELINE_TRAJECTORIES_FIXTURE_PATH,
  FIXTURE_FORMAT_VERSION,
  FIXTURE_VARIANT_LABEL,
  GOLD_TRACES_FIXTURE_PATH,
  dryRunResultToAuditTrace,
  fixtureThreadId,
  type FixtureProvenance,
  type GoldTraceFixtureFile,
  type TrajectoryFixtureFile,
} from "./fixtureAdapter.ts";

const scenarios = generateScenarios();
if (scenarios.length === 0) {
  console.error("Scenario generator produced 0 scenarios — refusing to write fixtures.");
  process.exit(1);
}

const trajectories: TrajectoryFixtureFile["trajectories"] = [];
const goldEntries: GoldTraceFixtureFile["traces"] = [];

for (const scenario of scenarios) {
  const result = await runScenarioLive(scenario, {
    dryRun: true,
    variantLabel: FIXTURE_VARIANT_LABEL,
    threadId: fixtureThreadId(scenario.id),
  });
  trajectories.push({ scenarioId: scenario.id, ...result.trajectory });

  const trace = dryRunResultToAuditTrace(scenario, result);
  const score = scoreTrace(trace);
  if (!score.processResult.passed) {
    console.error(
      `Refusing to write gold fixture: ${scenario.id} fails process checks: ${score.reasons.join("; ")}`,
    );
    process.exit(1);
  }
  goldEntries.push({ scenarioId: scenario.id, trace });
}

const provenance: FixtureProvenance = {
  generatedAt: new Date().toISOString(),
  generatedBy: "src/infra/domain/evals/fixtures/generateFixtures.ts",
  producer: "harness/live dry-run synthesis (GORDON_EVAL_DRY_RUN=1 path; deterministic, no LLM)",
  scenarioCount: scenarios.length,
};

const baselineFile: TrajectoryFixtureFile = {
  formatVersion: FIXTURE_FORMAT_VERSION,
  provenance,
  variantLabel: FIXTURE_VARIANT_LABEL,
  trajectories,
};

const goldFile: GoldTraceFixtureFile = {
  formatVersion: FIXTURE_FORMAT_VERSION,
  provenance,
  traces: goldEntries,
};

writeFileSync(BASELINE_TRAJECTORIES_FIXTURE_PATH, `${JSON.stringify(baselineFile, null, 2)}\n`);
writeFileSync(GOLD_TRACES_FIXTURE_PATH, `${JSON.stringify(goldFile, null, 2)}\n`);

const rel = (p: string) => relative(process.cwd(), p);
console.log(`Wrote ${trajectories.length} trajectories → ${rel(BASELINE_TRAJECTORIES_FIXTURE_PATH)}`);
console.log(`Wrote ${goldEntries.length} gold traces  → ${rel(GOLD_TRACES_FIXTURE_PATH)}`);
