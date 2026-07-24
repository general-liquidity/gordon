import { describe, it, expect } from "bun:test";
import type { Run, Workflow, WorkflowState } from "@mastra/core/workflows";

import {
  snapshotWorkflow,
  snapshotRun,
  timeTravelWorkflow,
  resumeFromSnapshot,
  readWorkflowState,
} from "./nativeWorkflowTools.ts";

function makeState(overrides: Partial<WorkflowState> = {}): WorkflowState {
  return {
    runId: "run-123",
    workflowName: "wf-under-test",
    createdAt: new Date(0),
    updatedAt: new Date(0),
    status: "suspended",
    steps: {
      "extract-data": {
        status: "success",
        payload: { symbol: "BTC" },
        output: { rows: 3 },
        startedAt: 1,
        endedAt: 2,
      },
      "await-approval": {
        status: "suspended",
        payload: { rows: 3 },
        suspendPayload: { message: "needs approval" },
        startedAt: 3,
      },
    } as WorkflowState["steps"],
    suspendedPaths: { "await-approval": [1] },
    resumeLabels: { approve: { stepId: "await-approval" } },
    ...overrides,
  };
}

describe("readWorkflowState", () => {
  it("reads status, step outputs/payloads, suspended step, and resume labels", () => {
    const reader = readWorkflowState(makeState());

    expect(reader.getStatus()).toBe("suspended");
    expect(reader.getStepOutput("extract-data") as unknown).toEqual({ rows: 3 });
    expect(reader.getStepPayload("extract-data") as unknown).toEqual({ symbol: "BTC" });

    const suspended = reader.getSuspendedStep();
    expect(suspended?.stepId).toBe("await-approval");

    expect(reader.getResumeLabels().approve).toEqual({ stepId: "await-approval" });
    expect(reader.getResumeLabel("approve")).toEqual({ stepId: "await-approval" });
  });
});

describe("snapshotWorkflow", () => {
  it("delegates to getWorkflowRunById with nested workflows on by default", async () => {
    const calls: Array<{ runId: string; options: unknown }> = [];
    const state = makeState();
    const workflow = {
      getWorkflowRunById: async (runId: string, options: unknown) => {
        calls.push({ runId, options });
        return state;
      },
    } as unknown as Workflow;

    const result = await snapshotWorkflow(workflow, "run-123");
    expect(result).toBe(state);
    expect(calls).toEqual([{ runId: "run-123", options: { withNestedWorkflows: true } }]);
  });

  it("honors an explicit withNestedWorkflows: false", async () => {
    let seen: unknown;
    const workflow = {
      getWorkflowRunById: async (_runId: string, options: unknown) => {
        seen = options;
        return null;
      },
    } as unknown as Workflow;

    const result = await snapshotWorkflow(workflow, "r", { withNestedWorkflows: false });
    expect(result).toBeNull();
    expect(seen).toEqual({ withNestedWorkflows: false });
  });
});

describe("snapshotRun", () => {
  it("returns null when the run has no Mastra instance", async () => {
    const run = { mastra: undefined, runId: "r", workflowId: "w" } as unknown as Run;
    expect(await snapshotRun(run)).toBeNull();
  });

  it("resolves the workflow from mastra and snapshots it", async () => {
    const state = makeState();
    const run = {
      runId: "run-123",
      workflowId: "wf-under-test",
      mastra: {
        getWorkflow: (id: string) => {
          expect(id).toBe("wf-under-test");
          return {
            getWorkflowRunById: async () => state,
          };
        },
      },
    } as unknown as Run;

    expect(await snapshotRun(run)).toBe(state);
  });

  it("returns null when getWorkflow throws (unregistered workflow)", async () => {
    const run = {
      runId: "r",
      workflowId: "missing",
      mastra: {
        getWorkflow: () => {
          throw new Error("not registered");
        },
      },
    } as unknown as Run;

    expect(await snapshotRun(run)).toBeNull();
  });
});

describe("timeTravelWorkflow", () => {
  it("forwards step + inputData to Run.timeTravel", async () => {
    let seen: unknown;
    const run = {
      timeTravel: async (args: unknown) => {
        seen = args;
        return { status: "success" };
      },
    } as unknown as Run;

    const out = await timeTravelWorkflow(run, {
      step: "propose-trade",
      inputData: { symbol: "ETH" },
    });

    expect(out as unknown).toEqual({ status: "success" });
    expect(seen).toMatchObject({ step: "propose-trade", inputData: { symbol: "ETH" } });
  });

  it("passes reconstructed context through for replay without re-running prior steps", async () => {
    let seen: any;
    const run = {
      timeTravel: async (args: unknown) => {
        seen = args;
        return { status: "success" };
      },
    } as unknown as Run;

    await timeTravelWorkflow(run, {
      step: "step2",
      context: {
        step1: { status: "success", output: { v: 2 }, payload: {}, startedAt: 1, endedAt: 2 },
      },
    });

    expect(seen.context.step1.output).toEqual({ v: 2 });
  });
});

describe("resumeFromSnapshot", () => {
  it("forwards resumeData and label to Run.resume", async () => {
    let seen: unknown;
    const run = {
      resume: async (args: unknown) => {
        seen = args;
        return { status: "success" };
      },
    } as unknown as Run;

    await resumeFromSnapshot(run, { resumeData: { confirm: true }, label: "approve" });
    expect(seen).toMatchObject({ resumeData: { confirm: true }, label: "approve" });
  });

  it("works with no args (resume the currently suspended step)", async () => {
    let called = false;
    const run = {
      resume: async () => {
        called = true;
        return { status: "success" };
      },
    } as unknown as Run;

    await resumeFromSnapshot(run);
    expect(called).toBe(true);
  });
});
