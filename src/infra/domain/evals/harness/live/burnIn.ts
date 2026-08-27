/**
 * Deterministic unattended burn-in for the eval scheduler and process gates.
 *
 * This runner intentionally has no live/model switch. Every trajectory is
 * synthesized by the dry-run producer inside a disposable EvalSandbox, and a
 * strict tool allowlist aborts if that producer ever grows an execution call.
 * It validates long-running orchestration, heartbeat persistence, pass^k and
 * cleanup without loading model weights or contacting a venue.
 */

import { randomUUID } from "node:crypto";
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

import type { EvalScenario } from "../types.ts";
import { produceKRuns } from "./kRunProducer.ts";
import { withEvalSandbox } from "./sandbox.ts";

const DRY_RUN_TOOL_ALLOWLIST = new Set([
  "get_market_data",
  "compute_indicator",
  "classify_trade_risk",
  "approve_plan",
]);

export interface BurnInHeartbeat {
  schemaVersion: 1;
  runId: string;
  cycle: number;
  totalCycles: number;
  completedAt: string;
  scenarioCount: number;
  trajectoryCount: number;
  allProcessChecksPassed: boolean;
  dryRun: true;
  modelInference: false;
  orderDispatch: false;
}

export interface UnattendedBurnInOptions {
  scenarios: ReadonlyArray<EvalScenario>;
  cycles?: number;
  k?: number;
  intervalMs?: number;
  evidencePath?: string;
  signal?: AbortSignal;
}

export interface UnattendedBurnInResult {
  runId: string;
  cyclesCompleted: number;
  heartbeats: BurnInHeartbeat[];
  evidencePath: string;
}

export function defaultBurnInEvidencePath(): string {
  return join(process.cwd(), "artifacts", "unattended-burn-in.jsonl");
}

function positiveInteger(value: number | undefined, fallback: number, name: string): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved < 1) {
    throw new Error(`${name} must be a positive safe integer`);
  }
  return resolved;
}

function appendHeartbeat(path: string, heartbeat: BurnInHeartbeat): void {
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${JSON.stringify(heartbeat)}\n`, "utf8");
}

function assertDryRunTools(toolNames: ReadonlyArray<string>): void {
  const unexpected = toolNames.filter((name) => !DRY_RUN_TOOL_ALLOWLIST.has(name));
  if (unexpected.length > 0) {
    throw new Error(
      `Unattended burn-in refused unexpected tool calls: ${[...new Set(unexpected)].join(", ")}`,
    );
  }
}

async function waitForNextCycle(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return;
  if (signal?.aborted) throw new Error("Unattended burn-in aborted");
  await new Promise<void>((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(new Error("Unattended burn-in aborted"));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export async function runUnattendedBurnIn(
  options: UnattendedBurnInOptions,
): Promise<UnattendedBurnInResult> {
  if (options.scenarios.length === 0) throw new Error("At least one burn-in scenario is required");
  const cycles = positiveInteger(options.cycles, 1, "cycles");
  const k = positiveInteger(options.k, 3, "k");
  const intervalMs = options.intervalMs ?? 0;
  if (!Number.isFinite(intervalMs) || intervalMs < 0) {
    throw new Error("intervalMs must be a finite non-negative number");
  }

  const evidencePath = options.evidencePath ?? defaultBurnInEvidencePath();
  const runId = randomUUID();
  const heartbeats: BurnInHeartbeat[] = [];

  await withEvalSandbox(
    async (sandbox) => {
      for (let cycle = 1; cycle <= cycles; cycle++) {
        if (options.signal?.aborted) throw new Error("Unattended burn-in aborted");
        let trajectoryCount = 0;
        let allProcessChecksPassed = true;

        for (const scenario of options.scenarios) {
          const result = await produceKRuns({
            scenario,
            k,
            sandbox,
            dryRun: true,
            variantLabel: `burn-in-${runId}-c${cycle}`,
          });
          trajectoryCount += result.trajectories.length;
          allProcessChecksPassed &&= result.processResults.every((entry) => entry.passed);
          assertDryRunTools(
            result.normalizedTraces.flatMap((trace) => trace.toolCalls.map((call) => call.name)),
          );
        }

        const heartbeat: BurnInHeartbeat = {
          schemaVersion: 1,
          runId,
          cycle,
          totalCycles: cycles,
          completedAt: new Date().toISOString(),
          scenarioCount: options.scenarios.length,
          trajectoryCount,
          allProcessChecksPassed,
          dryRun: true,
          modelInference: false,
          orderDispatch: false,
        };
        appendHeartbeat(evidencePath, heartbeat);
        heartbeats.push(heartbeat);
        if (!allProcessChecksPassed) {
          throw new Error(`Unattended burn-in process checks failed in cycle ${cycle}`);
        }
        if (cycle < cycles) await waitForNextCycle(intervalMs, options.signal);
      }
    },
    { dryRun: true, prefix: "gordon-unattended-burn-in-" },
  );

  return { runId, cyclesCompleted: heartbeats.length, heartbeats, evidencePath };
}
