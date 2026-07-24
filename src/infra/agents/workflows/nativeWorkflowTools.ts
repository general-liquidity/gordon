/**
 * Native Mastra 1.51 workflow helpers — snapshots, time-travel, and state reading.
 *
 * These are thin, additive wrappers over the workflow capabilities Gordon
 * underuses today: durable snapshots (`getWorkflowRunById`), deterministic
 * re-execution from an arbitrary step (`Run.timeTravel`), suspend/resume
 * (`Run.resume`), and the public state reader (`createWorkflowStateReader`).
 *
 * Nothing here spawns a workflow or changes an existing flow. The helpers
 * exist so callers that DO own a Mastra `Workflow`/`Run` (durable multi-step
 * flows, and — once the eval harness gains a live Mastra spawn — deterministic
 * trajectory replay) can reach these 1.51 primitives through one typed seam
 * instead of re-deriving the raw snapshot shape at each call site.
 *
 * ## Where this is meant to plug in (eval-harness replay)
 *
 * The eval harness (`src/infra/domain/evals/harness/`) is deliberately
 * trajectory-agnostic: it consumes pre-recorded `EvalTrajectory` /
 * `NormalizedTrace` and does NOT run a Mastra workflow (see the harness
 * doc-comment: "No live Mastra spawn yet"). There is therefore no live `Run`
 * for it to snapshot or time-travel today, so this module ships standalone.
 *
 * When the harness graduates to driving the orchestrator as a committed Mastra
 * workflow, deterministic replay becomes:
 *
 * ```ts
 * // 1. capture: after a paper-mode run, persist the snapshot
 * const snapshot = await snapshotWorkflow(workflow, run.runId);
 *
 * // 2. replay: re-run from any recorded step against the frozen snapshot,
 * //    feeding the exact prior step outputs — no re-execution of earlier steps
 * const replayed = await timeTravelWorkflow(run, {
 *   step: "propose-trade",
 *   inputData: recordedInput,
 * });
 *
 * // 3. inspect without parsing raw snapshot internals
 * const reader = readWorkflowState(snapshot);
 * reader.getStepOutput("risk-gate");
 * ```
 *
 * That is the intended integration seam; it is intentionally not wired into the
 * current injected-trajectory replay because doing so would change existing
 * eval behavior (the task is additive-only).
 */

import type { Run, Workflow, WorkflowState } from "@mastra/core/workflows";
import { createWorkflowStateReader } from "@mastra/core/workflows";
import type { WorkflowStateReader } from "@mastra/core/workflows";

type AnyWorkflow = Workflow<any, any, any, any, any, any>;
type AnyRun = Run<any, any, any, any, any, any>;

/**
 * Fetch the durable snapshot (public `WorkflowState`) for a run.
 *
 * Wraps `Workflow.getWorkflowRunById`. Returns `null` when no run is found.
 * The returned state is the serializable representation described in the
 * Mastra snapshot docs — safe to persist, diff, or feed to `readWorkflowState`.
 *
 * Snapshots require storage to be configured on the workflow's Mastra instance;
 * an in-memory run yields a state with `isFromInMemory: true` and an empty
 * `steps` map.
 */
export async function snapshotWorkflow(
  workflow: AnyWorkflow,
  runId: string,
  options?: { withNestedWorkflows?: boolean },
): Promise<WorkflowState | null> {
  return workflow.getWorkflowRunById(runId, {
    withNestedWorkflows: options?.withNestedWorkflows ?? true,
  });
}

/**
 * Convenience over {@link snapshotWorkflow} that resolves the owning workflow
 * from the run's Mastra instance. Returns `null` when the run is not bound to a
 * Mastra instance or the workflow/run cannot be found.
 */
export async function snapshotRun(run: AnyRun): Promise<WorkflowState | null> {
  const mastra = run.mastra;
  if (!mastra) return null;
  let workflow: AnyWorkflow | undefined;
  try {
    workflow = mastra.getWorkflow(run.workflowId) as AnyWorkflow | undefined;
  } catch {
    return null;
  }
  if (!workflow) return null;
  return snapshotWorkflow(workflow, run.runId);
}

export interface TimeTravelArgs {
  /**
   * Target step to (re)start execution from: a step id, an array of ids for a
   * nested-workflow path, or a `Step` instance / array.
   */
  step: string | string[] | AnyRunTimeTravelStep;
  /** Input for the target step. If omitted, uses the snapshot's stored input. */
  inputData?: unknown;
  /** Resume payload when the target step was previously suspended. */
  resumeData?: unknown;
  /** Workflow-level state to seed before execution. */
  initialState?: unknown;
  /** Reconstructed step results for steps before the target step. */
  context?: Record<string, unknown>;
  /** Reconstructed results for nested-workflow steps, keyed by nested id. */
  nestedStepsContext?: Record<string, Record<string, unknown>>;
}

type AnyRunTimeTravelStep = Parameters<AnyRun["timeTravel"]>[0]["step"];

/**
 * Re-execute a workflow starting from an arbitrary step against its persisted
 * snapshot (or explicitly provided `context`). Wraps `Run.timeTravel`.
 *
 * This is the deterministic-replay primitive: earlier steps are NOT re-run —
 * their outputs are reconstructed from the snapshot or the supplied `context`,
 * and execution resumes from `step` forward. Requires storage for the snapshot
 * path (or a full `context` when replaying a run that was never persisted).
 */
export async function timeTravelWorkflow(run: AnyRun, args: TimeTravelArgs) {
  return run.timeTravel({
    step: args.step as AnyRunTimeTravelStep,
    inputData: args.inputData,
    resumeData: args.resumeData,
    initialState: args.initialState,
    context: args.context as never,
    nestedStepsContext: args.nestedStepsContext as never,
  });
}

export interface ResumeFromSnapshotArgs {
  /** Payload delivered to the suspended step's `resume`. */
  resumeData?: unknown;
  /**
   * Explicit step id(s) to resume. Omit to resume the workflow's currently
   * suspended step (Mastra resolves it from the snapshot).
   */
  step?: string | string[];
  /** Named resume label (from `getResumeLabels`) to target. */
  label?: string;
}

/**
 * Resume a suspended workflow run from its persisted snapshot. Wraps
 * `Run.resume`. Use {@link readWorkflowState} on the snapshot first to discover
 * the suspended step / resume labels when they are not known ahead of time.
 */
export async function resumeFromSnapshot(run: AnyRun, args: ResumeFromSnapshotArgs = {}) {
  return run.resume({
    resumeData: args.resumeData,
    step: args.step as never,
    label: args.label,
  });
}

/**
 * Wrap a `WorkflowState` snapshot in the public state reader so callers can
 * pull step outputs / payloads, the suspended step, and resume labels without
 * parsing raw snapshot internals. Wraps `createWorkflowStateReader`.
 */
export function readWorkflowState(state: WorkflowState): WorkflowStateReader {
  return createWorkflowStateReader(state);
}
