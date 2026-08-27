/**
 * No-model, no-order unattended eval burn-in.
 *
 * Usage:
 *   bun run scripts/dev/eval/eval-unattended-burn-in.ts --cycles 24 --k 3
 */

import {
  ADVERSARIAL_SCENARIOS,
  getScenarioById,
  runUnattendedBurnIn,
} from "../../../src/infra/domain/evals/harness/index.ts";

let cycles = 1;
let k = 3;
let intervalMs = 0;
let evidencePath: string | undefined;
let scenarioId: string | undefined;

for (let i = 2; i < process.argv.length; i++) {
  const arg = process.argv[i];
  if (arg === "--cycles") cycles = Number(process.argv[++i]);
  else if (arg === "--k") k = Number(process.argv[++i]);
  else if (arg === "--interval-ms") intervalMs = Number(process.argv[++i]);
  else if (arg === "--output") evidencePath = process.argv[++i];
  else if (arg === "--scenario") scenarioId = process.argv[++i];
  else if (arg === "--live")
    throw new Error("This burn-in is permanently dry-run; --live is not supported");
}

const selected = scenarioId ? getScenarioById(scenarioId) : undefined;
if (scenarioId && !selected) throw new Error(`Unknown scenario: ${scenarioId}`);
const scenarios = selected ? [selected] : ADVERSARIAL_SCENARIOS.slice(0, 3);
const result = await runUnattendedBurnIn({
  scenarios,
  cycles,
  k,
  intervalMs,
  ...(evidencePath ? { evidencePath } : {}),
});

console.log(
  JSON.stringify({
    status: "pass",
    runId: result.runId,
    cyclesCompleted: result.cyclesCompleted,
    evidencePath: result.evidencePath,
    modelInference: false,
    orderDispatch: false,
  }),
);
