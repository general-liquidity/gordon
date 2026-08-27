// ============================================================================
// Task Dependency Graph — Multi-step trading workflow orchestration
//
// "Don't execute trade until risk check passes"
// "Backtest must complete before deploy"
//
// Tracks tasks with blocks/blocked_by edges. When a task completes,
// cascade-checks all dependents and unblocks them if ready.
// ============================================================================

export interface TaskNode {
  id: string;
  title: string;
  status: "pending" | "in_progress" | "completed" | "failed" | "blocked";
  dependencies: string[]; // IDs of tasks that must complete first
  dependents: string[]; // IDs of tasks that depend on this one
  createdAt: number;
  completedAt?: number;
  result?: any;
  error?: string;
}

let idCounter = 0;

export class TaskDependencyGraph {
  private nodes: Map<string, TaskNode> = new Map();

  createTask(title: string, dependsOn?: string[]): TaskNode {
    const id = `dep_${++idCounter}_${Date.now()}`;
    const deps = dependsOn ?? [];

    // Validate that all dependency IDs exist
    for (const depId of deps) {
      if (!this.nodes.has(depId)) {
        throw new Error(`Dependency "${depId}" does not exist`);
      }
    }

    const allDepsComplete = deps.every((depId) => this.nodes.get(depId)!.status === "completed");

    const node: TaskNode = {
      id,
      title,
      status: deps.length > 0 && !allDepsComplete ? "blocked" : "pending",
      dependencies: deps,
      dependents: [],
      createdAt: Date.now(),
    };

    this.nodes.set(id, node);

    // Register this task as a dependent on each dependency
    for (const depId of deps) {
      const depNode = this.nodes.get(depId)!;
      depNode.dependents.push(id);
    }

    return node;
  }

  completeTask(id: string, result?: any): void {
    const node = this.nodes.get(id);
    if (!node) throw new Error(`Task "${id}" not found`);
    if (node.status !== "in_progress" && node.status !== "pending") {
      throw new Error(`Cannot complete task in "${node.status}" state`);
    }

    node.status = "completed";
    node.completedAt = Date.now();
    node.result = result;

    // Cascade-check all dependents
    for (const depId of node.dependents) {
      this.checkUnblock(depId);
    }
  }

  failTask(id: string, error: string): void {
    const node = this.nodes.get(id);
    if (!node) throw new Error(`Task "${id}" not found`);

    node.status = "failed";
    node.completedAt = Date.now();
    node.error = error;

    // Cascade-fail all dependents
    this.cascadeFail(node.dependents);
  }

  startTask(id: string): void {
    const node = this.nodes.get(id);
    if (!node) throw new Error(`Task "${id}" not found`);
    if (node.status !== "pending") {
      throw new Error(`Cannot start task in "${node.status}" state — must be "pending"`);
    }

    node.status = "in_progress";
  }

  getReadyTasks(): TaskNode[] {
    return [...this.nodes.values()].filter((n) => n.status === "pending");
  }

  getBlockedTasks(): TaskNode[] {
    return [...this.nodes.values()].filter((n) => n.status === "blocked");
  }

  getAllTasks(): TaskNode[] {
    return [...this.nodes.values()];
  }

  getTask(id: string): TaskNode | null {
    return this.nodes.get(id) ?? null;
  }

  getExecutionOrder(): string[] {
    // Kahn's algorithm — topological sort
    const inDegree = new Map<string, number>();
    const adj = new Map<string, string[]>();

    for (const node of this.nodes.values()) {
      if (!inDegree.has(node.id)) inDegree.set(node.id, 0);
      if (!adj.has(node.id)) adj.set(node.id, []);

      for (const depId of node.dependencies) {
        if (!adj.has(depId)) adj.set(depId, []);
        adj.get(depId)!.push(node.id);
        inDegree.set(node.id, (inDegree.get(node.id) ?? 0) + 1);
      }
    }

    const queue: string[] = [];
    for (const [id, deg] of inDegree) {
      if (deg === 0) queue.push(id);
    }

    const order: string[] = [];
    while (queue.length > 0) {
      const current = queue.shift()!;
      order.push(current);

      for (const next of adj.get(current) ?? []) {
        const newDeg = (inDegree.get(next) ?? 1) - 1;
        inDegree.set(next, newDeg);
        if (newDeg === 0) queue.push(next);
      }
    }

    return order;
  }

  hasCycle(): boolean {
    const order = this.getExecutionOrder();
    return order.length < this.nodes.size;
  }

  toJSON(): object {
    const nodes: TaskNode[] = [];
    for (const node of this.nodes.values()) {
      nodes.push({ ...node });
    }
    return { nodes, idCounter };
  }

  static fromJSON(data: any): TaskDependencyGraph {
    const graph = new TaskDependencyGraph();
    const parsed = data as { nodes: TaskNode[]; idCounter: number };

    if (parsed.idCounter !== undefined) {
      idCounter = parsed.idCounter;
    }

    for (const node of parsed.nodes) {
      graph.nodes.set(node.id, { ...node });
    }

    return graph;
  }

  // --------------------------------------------------------------------------
  // Private helpers
  // --------------------------------------------------------------------------

  private checkUnblock(id: string): void {
    const node = this.nodes.get(id);
    if (node?.status !== "blocked") return;

    const allDepsComplete = node.dependencies.every(
      (depId) => this.nodes.get(depId)?.status === "completed",
    );

    if (allDepsComplete) {
      node.status = "pending";
    }
  }

  private cascadeFail(dependentIds: string[]): void {
    for (const depId of dependentIds) {
      const dep = this.nodes.get(depId);
      if (!dep) continue;
      if (dep.status === "completed" || dep.status === "failed") continue;

      dep.status = "failed";
      dep.completedAt = Date.now();
      dep.error = "Dependency failed";

      // Recurse into this task's dependents
      this.cascadeFail(dep.dependents);
    }
  }
}
