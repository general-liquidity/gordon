import {
  getPerformanceMonitor,
  type AttributedFrameKind,
} from "./performanceMonitor.ts";

export interface RenderBudget {
  keystrokeMs: number;
  streamMs: number;
  breachThreshold: number;
}

export const DEFAULT_RENDER_BUDGET: RenderBudget = {
  keystrokeMs: 16,
  streamMs: 33,
  breachThreshold: 3,
};

export interface BudgetBreach {
  kind: "keystroke" | "stream";
  budgetMs: number;
  observedMs: number;
  consecutive: number;
  at: number;
}

export type BreachSink = (breach: BudgetBreach) => void;

export class BudgetEvaluator {
  private readonly budget: RenderBudget;
  private readonly sink: BreachSink;
  private consecutive: Record<"keystroke" | "stream", number> = { keystroke: 0, stream: 0 };
  private worst: Record<"keystroke" | "stream", number> = { keystroke: 0, stream: 0 };
  private breaches = 0;

  constructor(budget: RenderBudget, sink: BreachSink) {
    this.budget = budget;
    this.sink = sink;
  }

  get breachCount(): number {
    return this.breaches;
  }

  recordFrame(kind: AttributedFrameKind, durationMs: number): void {
    if (kind !== "keystroke" && kind !== "stream") return;
    const budgetMs = kind === "keystroke" ? this.budget.keystrokeMs : this.budget.streamMs;
    if (durationMs <= budgetMs) {
      this.consecutive[kind] = 0;
      this.worst[kind] = 0;
      return;
    }
    this.consecutive[kind] += 1;
    this.worst[kind] = Math.max(this.worst[kind], durationMs);
    if (this.consecutive[kind] === this.budget.breachThreshold) {
      this.breaches += 1;
      this.sink({
        kind,
        budgetMs,
        observedMs: this.worst[kind],
        consecutive: this.consecutive[kind],
        at: Date.now(),
      });
    }
  }
}

let activeEvaluator: BudgetEvaluator | null = null;

export function installRenderBudget(opts: {
  budget?: Partial<RenderBudget>;
  sink?: BreachSink;
} = {}): () => void {
  if (!isRenderBudgetEnabled()) return () => {};

  const budget = { ...DEFAULT_RENDER_BUDGET, ...opts.budget };
  let inSink = false;
  const sink = opts.sink ?? ((breach: BudgetBreach) => {
    if (inSink) return;
    inSink = true;
    try {
      console.error(
        `[render-budget] ${breach.kind} frame ${breach.observedMs.toFixed(1)}ms > ${breach.budgetMs}ms budget (${breach.consecutive} consecutive)`,
      );
      if (isRenderBudgetStrict()) {
        throw new Error(`render budget breached: ${breach.kind}`);
      }
    } finally {
      inSink = false;
    }
  });
  const evaluator = new BudgetEvaluator(budget, sink);
  activeEvaluator = evaluator;
  const unsubscribe = getPerformanceMonitor().onAttributedFrame((kind, durationMs) => {
    evaluator.recordFrame(kind, durationMs);
  });
  return () => {
    unsubscribe();
    if (activeEvaluator === evaluator) activeEvaluator = null;
  };
}

export function getRenderBudgetBreachCount(): number {
  return activeEvaluator?.breachCount ?? 0;
}

export function isRenderBudgetEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env.GORDON_RENDER_BUDGET?.toLowerCase();
  return raw === "1" || raw === "true" || raw === "strict";
}

export function isRenderBudgetStrict(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.GORDON_RENDER_BUDGET?.toLowerCase() === "strict";
}
