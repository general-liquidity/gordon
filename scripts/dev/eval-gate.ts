/**
 * Eval CI gate (Phase 2).
 *
 * Runs the gateable-today layers of the eval harness and exits non-zero on
 * any blocking failure, so a GitHub Action can block the merge:
 *
 *   1. Structural — the generator produces a valid, unique, provenance-
 *      complete suite (catches a broken spec source).
 *   2. Gold-trace process checks — every committed known-good trace must
 *      still pass the deterministic safety process checks (catches a
 *      regression in the checker or a bad promoted trace). Provide the path
 *      via GORDON_EVAL_GOLD_TRACES (JSON array of AuditTrace).
 *   3. LLM-judge regression (opt-in) — when GORDON_EVAL_BASELINE and
 *      GORDON_EVAL_CANDIDATE point at trajectory-fixture JSON, run the suite
 *      through the judge and fail on a blocking regression. (Skipped when
 *      fixtures absent — becomes the full quality gate once paper-mode
 *      captures exist and API keys are present in CI.)
 *
 * The eval UNIT suite (`bun test src/infra/domain/evals`) runs separately in
 * the Action and is the third deterministic leg.
 *
 * Run: bun run scripts/dev/eval-gate.ts
 */

import { existsSync, readFileSync } from "node:fs";
import {
  generateScenarios,
  scoreTrace,
  runEvalSuite,
  detectRegressions,
  type EvalTrajectory,
  type RunVariantInput,
} from "../../src/infra/domain/evals/harness/index.ts";
import type { AuditTrace } from "../../src/core/audit/types.ts";

let failed = false;
const fail = (msg: string) => {
  console.error(`  ✗ ${msg}`);
  failed = true;
};
const ok = (msg: string) => console.log(`  ✓ ${msg}`);

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

// 1. Structural -------------------------------------------------------------
console.log("[1/3] Structural — generated scenario suite");
{
  const scenarios = generateScenarios();
  if (scenarios.length === 0) fail("generator produced 0 scenarios");
  const ids = scenarios.map((s) => s.id);
  if (new Set(ids).size !== ids.length) fail("duplicate scenario ids");
  const missingProvenance = scenarios.filter((s) => !s.derivedFrom);
  if (missingProvenance.length > 0)
    fail(`${missingProvenance.length} scenarios missing derivedFrom provenance`);
  if (!failed) ok(`${scenarios.length} scenarios, unique ids, full provenance`);
}

// 2. Gold-trace process checks ---------------------------------------------
console.log("[2/3] Gold-trace process checks");
{
  const goldPath = process.env.GORDON_EVAL_GOLD_TRACES;
  if (!goldPath || !existsSync(goldPath)) {
    console.log("  – no GORDON_EVAL_GOLD_TRACES file; skipping (none committed yet)");
  } else {
    const traces = readJson<AuditTrace[]>(goldPath);
    let bad = 0;
    for (const t of traces) {
      const score = scoreTrace(t);
      if (!score.processResult.passed) {
        bad++;
        fail(`gold trace ${t.trace_id} now FAILS process checks: ${score.reasons.join("; ")}`);
      }
    }
    if (bad === 0) ok(`${traces.length} gold traces still pass process checks`);
  }
}

// 3. LLM-judge regression (opt-in) -----------------------------------------
console.log("[3/3] LLM-judge regression (opt-in)");
{
  const basePath = process.env.GORDON_EVAL_BASELINE;
  const candPath = process.env.GORDON_EVAL_CANDIDATE;
  if (!basePath || !candPath || !existsSync(basePath) || !existsSync(candPath)) {
    console.log("  – no baseline/candidate trajectory fixtures; skipping (needs paper-mode captures)");
  } else {
    type Fixture = {
      variantLabel: string;
      trajectories: Array<{ scenarioId: string } & EvalTrajectory>;
    };
    const toVariant = (f: Fixture): RunVariantInput => {
      const map = new Map<string, EvalTrajectory>();
      for (const t of f.trajectories) map.set(t.scenarioId, t);
      return { variantLabel: f.variantLabel, trajectoriesByScenario: map };
    };
    const base = readJson<Fixture>(basePath);
    const cand = readJson<Fixture>(candPath);
    const result = await runEvalSuite({
      scenarios: generateScenarios(),
      variants: [toVariant(base), toVariant(cand)],
    });
    const report = detectRegressions(result.results[0]!, result.results[1]!);
    if (report.hasBlockingRegression) {
      fail(`blocking regression: ${report.regressions.map((r) => r.scenarioId).join(", ")}`);
    } else {
      ok(`no blocking regression (Δagg ${report.aggregateDelta})`);
    }
  }
}

console.log("");
if (failed) {
  console.error("EVAL GATE: FAIL");
  process.exit(1);
} else {
  console.log("EVAL GATE: PASS");
  process.exit(0);
}
