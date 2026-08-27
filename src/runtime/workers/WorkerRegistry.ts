import type {
  RuntimePermissionScope,
  RuntimeWorkerDefinition,
  RuntimeWorkerRole,
} from "../contracts/types.ts";

const WORKER_DEFINITIONS: Record<RuntimeWorkerRole, RuntimeWorkerDefinition> = {
  Gordon: {
    name: "Gordon",
    description: "Primary coordinator for plan-first financial workflows.",
    handoffTargets: [
      "Scanner",
      "Analyst",
      "Planner",
      "Executor",
      "Monitor",
      "Teacher",
      "Backtester",
      "Critic",
      "Auditor",
    ],
    defaultScopes: ["analysis.run"],
  },
  Scanner: {
    name: "Scanner",
    description: "Fast market and opportunity discovery.",
    handoffTargets: ["Analyst", "Gordon"],
    defaultScopes: ["market.read"],
  },
  Analyst: {
    name: "Analyst",
    description: "Deep market, regime, and signal analysis.",
    handoffTargets: ["Planner", "Scanner", "Gordon", "Critic"],
    defaultScopes: ["market.read", "analysis.run"],
  },
  Planner: {
    name: "Planner",
    description: "Trade planning, risk sizing, and strategy construction.",
    handoffTargets: ["Executor", "Analyst", "Critic", "Gordon"],
    defaultScopes: ["analysis.run", "portfolio.read"],
  },
  Executor: {
    name: "Executor",
    description: "Execution rail owner for live or paper actions.",
    handoffTargets: ["Monitor", "Planner", "Auditor", "Gordon"],
    defaultScopes: ["livetrade.execute", "papertrade.execute", "transfer.execute"],
  },
  Monitor: {
    name: "Monitor",
    description: "Portfolio and position supervision.",
    handoffTargets: ["Planner", "Analyst", "Auditor", "Gordon"],
    defaultScopes: ["portfolio.read"],
  },
  Teacher: {
    name: "Teacher",
    description: "Explanation, review, and educational guidance.",
    handoffTargets: ["Gordon"],
    defaultScopes: ["analysis.run"],
  },
  Backtester: {
    name: "Backtester",
    description: "Research and backtesting specialist.",
    handoffTargets: ["Analyst", "Planner", "Critic", "Gordon"],
    defaultScopes: ["analysis.run"],
  },
  Critic: {
    name: "Critic",
    description: "Second-pass challenge and plan pressure testing.",
    handoffTargets: ["Planner", "Analyst", "Gordon"],
    defaultScopes: ["analysis.run"],
  },
  Auditor: {
    name: "Auditor",
    description: "Audit trail and policy review specialist.",
    handoffTargets: ["Monitor", "Gordon"],
    defaultScopes: ["portfolio.read", "analysis.run"],
  },
};

export class WorkerRegistry {
  list(): RuntimeWorkerDefinition[] {
    return Object.values(WORKER_DEFINITIONS);
  }

  get(worker: string): RuntimeWorkerDefinition | undefined {
    return WORKER_DEFINITIONS[worker as RuntimeWorkerRole];
  }

  has(worker: string): worker is RuntimeWorkerRole {
    return worker in WORKER_DEFINITIONS;
  }

  canHandoff(fromWorker: string, toWorker: string): boolean {
    const definition = this.get(fromWorker);
    return !!definition && definition.handoffTargets.includes(toWorker as RuntimeWorkerRole);
  }

  getDefaultScopes(worker: string): RuntimePermissionScope[] {
    return this.get(worker)?.defaultScopes ?? [];
  }
}
