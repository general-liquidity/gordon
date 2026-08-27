// Overnight Workflow
//
// Suspend/resume workflow pattern for long-running autonomous tasks.
// Agent researches overnight, suspends at decision point, user approves
// in the morning. Workflow state persists across process restarts.
//
// Use cases:
// - "Scan all my watchlist symbols overnight, wake me if you find A+ setups"
// - "Backtest this strategy with 50 parameter combinations, show me top 5 in the morning"
// - "Monitor BTC for volatility regime change, alert me when it shifts"

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const WORKFLOWS_DIR = join(homedir(), ".gordon", "workflows");

export type WorkflowStatus =
  | "pending"
  | "running"
  | "suspended"
  | "completed"
  | "failed"
  | "cancelled";

export interface WorkflowStep {
  id: string;
  name: string;
  status: "pending" | "running" | "completed" | "failed" | "skipped";
  startedAt?: number;
  completedAt?: number;
  result?: any;
  error?: string;
}

export interface WorkflowState {
  id: string;
  title: string;
  description: string;
  status: WorkflowStatus;
  createdAt: number;
  startedAt?: number;
  suspendedAt?: number;
  resumedAt?: number;
  completedAt?: number;
  currentStepIndex: number;
  steps: WorkflowStep[];
  suspendReason?: string;
  awaitingApproval?: {
    summary: string;
    findings: any;
    proposedAction?: any;
  };
  metadata: Record<string, any>;
}

export class OvernightWorkflowManager {
  private workflows: Map<string, WorkflowState> = new Map();

  constructor() {
    mkdirSync(WORKFLOWS_DIR, { recursive: true });
    this.loadAll();
  }

  create(
    title: string,
    description: string,
    steps: Array<{ id: string; name: string }>,
    metadata: Record<string, any> = {},
  ): WorkflowState {
    const id = `wf_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const state: WorkflowState = {
      id,
      title,
      description,
      status: "pending",
      createdAt: Date.now(),
      currentStepIndex: 0,
      steps: steps.map((s) => ({ ...s, status: "pending" })),
      metadata,
    };
    this.workflows.set(id, state);
    this.save(state);
    return state;
  }

  start(id: string): WorkflowState | null {
    const wf = this.workflows.get(id);
    if (wf?.status !== "pending") return null;
    wf.status = "running";
    wf.startedAt = Date.now();
    this.save(wf);
    return wf;
  }

  advanceStep(id: string, result: any): WorkflowState | null {
    const wf = this.workflows.get(id);
    if (wf?.status !== "running") return null;

    const step = wf.steps[wf.currentStepIndex];
    if (!step) return wf;

    step.status = "completed";
    step.completedAt = Date.now();
    step.result = result;

    wf.currentStepIndex++;

    if (wf.currentStepIndex >= wf.steps.length) {
      wf.status = "completed";
      wf.completedAt = Date.now();
    }

    this.save(wf);
    return wf;
  }

  suspend(
    id: string,
    reason: string,
    awaitingApproval?: WorkflowState["awaitingApproval"],
  ): WorkflowState | null {
    const wf = this.workflows.get(id);
    if (wf?.status !== "running") return null;

    wf.status = "suspended";
    wf.suspendedAt = Date.now();
    wf.suspendReason = reason;
    wf.awaitingApproval = awaitingApproval;

    this.save(wf);
    return wf;
  }

  resume(id: string): WorkflowState | null {
    const wf = this.workflows.get(id);
    if (wf?.status !== "suspended") return null;

    wf.status = "running";
    wf.resumedAt = Date.now();
    wf.suspendReason = undefined;
    wf.awaitingApproval = undefined;

    this.save(wf);
    return wf;
  }

  fail(id: string, error: string): WorkflowState | null {
    const wf = this.workflows.get(id);
    if (!wf) return null;
    wf.status = "failed";
    wf.completedAt = Date.now();
    const step = wf.steps[wf.currentStepIndex];
    if (step) {
      step.status = "failed";
      step.error = error;
    }
    this.save(wf);
    return wf;
  }

  cancel(id: string): WorkflowState | null {
    const wf = this.workflows.get(id);
    if (!wf) return null;
    wf.status = "cancelled";
    wf.completedAt = Date.now();
    this.save(wf);
    return wf;
  }

  get(id: string): WorkflowState | null {
    return this.workflows.get(id) ?? null;
  }

  list(filter?: { status?: WorkflowStatus }): WorkflowState[] {
    const all = Array.from(this.workflows.values());
    if (filter?.status) return all.filter((w) => w.status === filter.status);
    return all;
  }

  getSuspended(): WorkflowState[] {
    return this.list({ status: "suspended" });
  }

  getPendingApprovals(): WorkflowState[] {
    return this.list({ status: "suspended" }).filter((w) => w.awaitingApproval !== undefined);
  }

  private save(wf: WorkflowState): void {
    try {
      writeFileSync(join(WORKFLOWS_DIR, `${wf.id}.json`), JSON.stringify(wf, null, 2));
    } catch {}
  }

  private loadAll(): void {
    try {
      const { readdirSync } = require("node:fs");
      const files = readdirSync(WORKFLOWS_DIR).filter((f: string) => f.endsWith(".json"));
      for (const file of files) {
        try {
          const data = JSON.parse(readFileSync(join(WORKFLOWS_DIR, file), "utf-8"));
          this.workflows.set(data.id, data);
        } catch {}
      }
    } catch {}
  }
}

let instance: OvernightWorkflowManager | null = null;
export function getOvernightWorkflowManager(): OvernightWorkflowManager {
  if (!instance) instance = new OvernightWorkflowManager();
  return instance;
}
