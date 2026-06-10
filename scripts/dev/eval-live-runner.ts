/**
 * Live eval k-run runner (Phase 4).
 *
 * Runs a scenario k times inside an isolated sandbox and prints pass^k
 * summary from deterministic process checks.
 *
 * Usage:
 *   bun run scripts/dev/eval-live-runner.ts [--k N] [--dry-run] [--scenario id]
 *
 * CI without API keys:
 *   GORDON_EVAL_DRY_RUN=1 bun run scripts/dev/eval-live-runner.ts --k 5
 *
 * Live mode (requires LLM credentials):
 *   bun run scripts/dev/eval-live-runner.ts --k 3 --scenario gen-denylist-place_order
 */

import {
  ADVERSARIAL_SCENARIOS,
  getScenarioById,
  produceKRuns,
  withEvalSandbox,
} from "../../src/infra/domain/evals/harness/index.ts";

function parseArgs(argv: string[]): { k: number; dryRun: boolean; scenarioId?: string } {
  let k = 3;
  let dryRun = process.env.GORDON_EVAL_DRY_RUN === "1";
  let scenarioId: string | undefined;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--dry-run") dryRun = true;
    else if (arg === "--k" && argv[i + 1]) {
      k = Math.max(1, Number.parseInt(argv[++i]!, 10) || 3);
    } else if (arg === "--scenario" && argv[i + 1]) {
      scenarioId = argv[++i];
    }
  }

  return { k, dryRun, scenarioId };
}

const { k, dryRun, scenarioId } = parseArgs(process.argv.slice(2));

const scenario =
  (scenarioId ? getScenarioById(scenarioId) : undefined) ?? ADVERSARIAL_SCENARIOS[0];

if (!scenario) {
  console.error("No scenario found. Pass --scenario <id> or ensure adversarial scenarios exist.");
  process.exit(1);
}

console.log(`Eval live runner — scenario=${scenario.id} k=${k} dryRun=${dryRun}`);

const result = await withEvalSandbox(
  (sandbox) =>
    produceKRuns({
      scenario,
      k,
      sandbox,
      dryRun,
    }),
  { dryRun },
);

console.log("");
console.log(`pass^k: ${result.passKResult.passes}/${result.passKResult.k} (${result.passKResult.passRate})`);
console.log(`mode=${result.passKResult.mode} meets=${result.passKResult.meets} allPass=${result.passKResult.allPass}`);

if (!result.passKResult.meets) {
  const failed = result.processResults
    .map((r, i) => ({ i, r }))
    .filter(({ r }) => !r.passed);
  for (const { i, r } of failed) {
    console.error(`  run ${i}: ${r.violations.map((v) => v.rule).join(", ")}`);
  }
  process.exit(1);
}

console.log("EVAL LIVE RUNNER: PASS");
process.exit(0);