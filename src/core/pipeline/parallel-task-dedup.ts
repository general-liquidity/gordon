/**
 * Dispatch-side parallel-task dedup — the assignment-axis guard against
 * "different-but-coherent action amplification" (the goal-blast-radius concern:
 * /goal or a Workflow fan-out spawning N coherent-but-redundant lanes against
 * the SAME surface). The goal-progress-stall guard closed the time/progress axis
 * of that gap; this closes the assignment axis.
 *
 * Ported in spirit from evo's `dedupeBriefs` (Jaccard overlap of a lane's
 * declared surface). Each task declares the surface it will act on — for a
 * trading agent the decision identity (symbol + action), via `tradingTaskSurface`.
 * Lanes whose surfaces overlap ≥ threshold are clustered (transitively) and
 * collapsed to one representative before dispatch. Pure; returns the analysis +
 * a recommended dedup — the caller decides to drop / merge / serialize.
 */

export interface ParallelTask {
  id: string;
  /** Tokens describing the surface this task acts on (decision identity). */
  surface: string[];
}

export interface DedupeOptions {
  /** Jaccard overlap at/above which two tasks count as redundant. Default 0.6. */
  overlapThreshold?: number;
}

export interface RedundantPair {
  a: string;
  b: string;
  jaccard: number;
  shared: string[];
}

export interface ParallelDedupeResult {
  /** Representative task id per cluster — dispatch these. */
  keep: string[];
  /** Redundant task ids collapsed into a kept representative. */
  dropped: string[];
  /** Connected components (clusters of mutually/transitively redundant tasks). */
  groups: string[][];
  redundantPairs: RedundantPair[];
  reducedFrom: number;
  reducedTo: number;
  flagged: boolean;
  interpretation: string;
}

function normalize(surface: string[]): Set<string> {
  return new Set(surface.map((s) => s.trim().toLowerCase()).filter((s) => s.length > 0));
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0; // no declared surface → can't prove overlap
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

export function dedupeParallelTasks(
  tasks: ParallelTask[],
  opts: DedupeOptions = {},
): ParallelDedupeResult {
  const threshold = opts.overlapThreshold ?? 0.6;
  const n = tasks.length;
  const sets = tasks.map((t) => normalize(t.surface));

  // union-find for transitive clustering (A~B, B~C ⇒ {A,B,C})
  const parent = tasks.map((_, i) => i);
  const find = (x: number): number => {
    let r = x;
    while (parent[r] !== r) r = parent[r]!;
    while (parent[x] !== r) {
      const next = parent[x]!;
      parent[x] = r;
      x = next;
    }
    return r;
  };
  const unite = (a: number, b: number): void => {
    parent[find(a)] = find(b);
  };

  const redundantPairs: RedundantPair[] = [];
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const jac = jaccard(sets[i]!, sets[j]!);
      if (jac >= threshold) {
        const shared = [...sets[i]!].filter((x) => sets[j]!.has(x)).sort();
        redundantPairs.push({
          a: tasks[i]!.id,
          b: tasks[j]!.id,
          jaccard: parseFloat(jac.toFixed(3)),
          shared,
        });
        unite(i, j);
      }
    }
  }

  const components = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    const r = find(i);
    const arr = components.get(r);
    if (arr) arr.push(i);
    else components.set(r, [i]);
  }

  const groups: string[][] = [];
  const keep: string[] = [];
  const dropped: string[] = [];
  for (const idxs of components.values()) {
    groups.push(idxs.map((i) => tasks[i]!.id));
    keep.push(tasks[idxs[0]!]!.id); // first by input order — deterministic
    for (let k = 1; k < idxs.length; k++) dropped.push(tasks[idxs[k]!]!.id);
  }

  const flagged = dropped.length > 0;
  return {
    keep,
    dropped,
    groups,
    redundantPairs,
    reducedFrom: n,
    reducedTo: keep.length,
    flagged,
    interpretation: flagged
      ? `${dropped.length}/${n} parallel tasks redundant (surface overlap ≥ ${threshold}) — collapse before dispatch to avoid coherent-action amplification; keeping ${keep.length}`
      : `${n} parallel tasks have distinct surfaces — no redundancy`,
  };
}

/** Build a task surface from a trading sub-task's decision identity (symbol + action [+ venue]). */
export function tradingTaskSurface(fields: {
  symbol?: string;
  action?: string;
  venue?: string;
}): string[] {
  const s: string[] = [];
  if (fields.symbol) s.push(`sym:${fields.symbol.trim().toLowerCase()}`);
  if (fields.action) s.push(`act:${fields.action.trim().toLowerCase()}`);
  if (fields.venue) s.push(`venue:${fields.venue.trim().toLowerCase()}`);
  return s;
}
