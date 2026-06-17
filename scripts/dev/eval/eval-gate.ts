/**
 * Eval CI gate (Phase 2).
 *
 * Runs the gateable-today layers of the eval harness and exits non-zero on
 * any blocking failure, so a GitHub Action can block the merge:
 *
 *   1. Structural — the generator produces a valid, unique, provenance-
 *      complete suite (catches a broken spec source).
 *   2. Committed fixtures — the baseline-trajectory and gold-trace fixtures
 *      under src/infra/domain/evals/fixtures/ parse and cover exactly the
 *      generated scenario ids (catches "spec changed, fixtures stale" —
 *      regenerate via `bun run src/infra/domain/evals/fixtures/generateFixtures.ts`).
 *   3. Gold-trace process checks — every committed known-good trace must
 *      still pass the deterministic safety process checks (catches a
 *      regression in the checker or a bad promoted trace). Runs against the
 *      committed gold-traces.json by default; override with
 *      GORDON_EVAL_GOLD_TRACES (committed fixture format or a bare JSON
 *      array of AuditTrace from paper-mode captures). An explicitly set but
 *      missing/malformed path FAILS the gate — never skips.
 *   4. LLM-judge regression (opt-in, key-gated) — activates when
 *      GORDON_EVAL_CANDIDATE points at a trajectory-fixture JSON. Baseline
 *      defaults to the committed dry-run fixture; override with
 *      GORDON_EVAL_BASELINE. Requires an LLM key (DEDALUS_API_KEY /
 *      OPENAI_API_KEY / INCEPTION_API_KEY) — activating without one fails
 *      the gate rather than silently passing on judge fallback.
 *
 * The eval UNIT suite (`bun test src/infra/domain/evals`) runs separately in
 * the Action and is another deterministic leg.
 *
 * Run: bun run scripts/dev/eval/eval-gate.ts
 */

import { existsSync, readFileSync } from "node:fs";
import {
  generateScenarios,
  scoreTrace,
  runEvalSuite,
  detectRegressions,
  type EvalTrajectory,
  type RunVariantInput,
} from "../../../src/infra/domain/evals/harness/index.ts";
import {
  BASELINE_TRAJECTORIES_FIXTURE_PATH,
  GOLD_TRACES_FIXTURE_PATH,
  parseGoldTraces,
  parseTrajectoryFixture,
  type TrajectoryFixtureFile,
} from "../../../src/infra/domain/evals/fixtures/fixtureAdapter.ts";

let failed = false;
const fail = (msg: string) => {
  console.error(`  ✗ ${msg}`);
  failed = true;
};
const ok = (msg: string) => console.log(`  ✓ ${msg}`);

/** Treat empty/whitespace env values as unset (GitHub `vars.X` expands to ""). */
function envPath(name: string): string | undefined {
  const v = process.env[name];
  return v && v.trim().length > 0 ? v.trim() : undefined;
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8"));
}

const REGEN_HINT =
  "regenerate: bun run src/infra/domain/evals/fixtures/generateFixtures.ts";

const scenarios = generateScenarios();
const generatedIds = scenarios.map((s) => s.id).sort();

// 1. Structural -------------------------------------------------------------
console.log("[1/4] Structural — generated scenario suite");
{
  if (scenarios.length === 0) fail("generator produced 0 scenarios");
  if (new Set(generatedIds).size !== generatedIds.length) fail("duplicate scenario ids");
  const missingProvenance = scenarios.filter((s) => !s.derivedFrom);
  if (missingProvenance.length > 0)
    fail(`${missingProvenance.length} scenarios missing derivedFrom provenance`);
  if (!failed) ok(`${scenarios.length} scenarios, unique ids, full provenance`);
}

// 2. Committed fixtures — integrity + coverage -------------------------------
console.log("[2/4] Committed fixtures — integrity + coverage");
{
  if (!existsSync(BASELINE_TRAJECTORIES_FIXTURE_PATH)) {
    fail(`committed baseline fixture missing (${BASELINE_TRAJECTORIES_FIXTURE_PATH}); ${REGEN_HINT}`);
  } else {
    try {
      const fixture = parseTrajectoryFixture(readJson(BASELINE_TRAJECTORIES_FIXTURE_PATH));
      const fixtureIds = fixture.trajectories.map((t) => t.scenarioId).sort();
      if (JSON.stringify(fixtureIds) !== JSON.stringify(generatedIds)) {
        fail(`baseline fixture scenario ids drifted from generator output; ${REGEN_HINT}`);
      } else {
        ok(`baseline fixture: ${fixture.trajectories.length} trajectories cover the suite`);
      }
    } catch (err) {
      fail(`baseline fixture malformed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (!existsSync(GOLD_TRACES_FIXTURE_PATH)) {
    fail(`committed gold-trace fixture missing (${GOLD_TRACES_FIXTURE_PATH}); ${REGEN_HINT}`);
  } else {
    try {
      const parsed = parseGoldTraces(readJson(GOLD_TRACES_FIXTURE_PATH));
      const goldIds = [...(parsed.scenarioIds ?? [])].sort();
      if (JSON.stringify(goldIds) !== JSON.stringify(generatedIds)) {
        fail(`gold-trace fixture scenario ids drifted from generator output; ${REGEN_HINT}`);
      } else {
        ok(`gold-trace fixture: ${parsed.traces.length} traces cover the suite`);
      }
    } catch (err) {
      fail(`gold-trace fixture malformed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

// 3. Gold-trace process checks ------------------------------------------------
console.log("[3/4] Gold-trace process checks");
{
  const override = envPath("GORDON_EVAL_GOLD_TRACES");
  const goldPath = override ?? GOLD_TRACES_FIXTURE_PATH;
  if (!existsSync(goldPath)) {
    // Fail closed: a configured-but-missing path (or a deleted committed
    // fixture) must block the merge, not silently skip the leg.
    fail(`gold-trace path missing: ${goldPath}${override ? " (GORDON_EVAL_GOLD_TRACES)" : ""}`);
  } else {
    try {
      const { traces } = parseGoldTraces(readJson(goldPath));
      let bad = 0;
      for (const t of traces) {
        const score = scoreTrace(t);
        if (!score.processResult.passed) {
          bad++;
          fail(`gold trace ${t.trace_id} now FAILS process checks: ${score.reasons.join("; ")}`);
        }
      }
      if (bad === 0) ok(`${traces.length} gold traces still pass process checks`);
    } catch (err) {
      fail(`gold-trace file unreadable/malformed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

// 4. LLM-judge regression (opt-in, key-gated) ---------------------------------
console.log("[4/4] LLM-judge regression (opt-in)");
{
  const candPath = envPath("GORDON_EVAL_CANDIDATE");
  if (!candPath) {
    console.log(
      "  – GORDON_EVAL_CANDIDATE not set; skipping (set it + an LLM key to activate; baseline defaults to the committed dry-run fixture)",
    );
  } else {
    const basePath = envPath("GORDON_EVAL_BASELINE") ?? BASELINE_TRAJECTORIES_FIXTURE_PATH;
    const hasKey =
      envPath("DEDALUS_API_KEY") !== undefined ||
      envPath("OPENAI_API_KEY") !== undefined ||
      envPath("INCEPTION_API_KEY") !== undefined;

    if (!existsSync(candPath)) {
      fail(`GORDON_EVAL_CANDIDATE points at a missing file: ${candPath}`);
    } else if (!existsSync(basePath)) {
      fail(`baseline trajectory fixture missing: ${basePath}`);
    } else if (!hasKey) {
      // The judge degrades to passthrough scoring on client-init failure,
      // which would make this leg vacuously pass — refuse instead.
      fail(
        "judge leg activated but no LLM key present (DEDALUS_API_KEY / OPENAI_API_KEY / INCEPTION_API_KEY)",
      );
    } else {
      try {
        const toVariant = (f: TrajectoryFixtureFile): RunVariantInput => {
          const map = new Map<string, EvalTrajectory>();
          for (const t of f.trajectories) map.set(t.scenarioId, t);
          return { variantLabel: f.variantLabel, trajectoriesByScenario: map };
        };
        const base = parseTrajectoryFixture(readJson(basePath));
        const cand = parseTrajectoryFixture(readJson(candPath));
        const result = await runEvalSuite({
          scenarios,
          variants: [toVariant(base), toVariant(cand)],
        });
        const report = detectRegressions(result.results[0]!, result.results[1]!);
        if (report.hasBlockingRegression) {
          fail(`blocking regression: ${report.regressions.map((r) => r.scenarioId).join(", ")}`);
        } else {
          ok(`no blocking regression (Δagg ${report.aggregateDelta})`);
        }
      } catch (err) {
        fail(`judge leg failed: ${err instanceof Error ? err.message : String(err)}`);
      }
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
