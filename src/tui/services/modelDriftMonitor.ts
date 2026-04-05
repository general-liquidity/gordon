// ============================================================================
// Model Drift Monitor — HALT trading if model accuracy degrades
//
// Tracks rolling accuracy + Sharpe. If accuracy drops below 80% of baseline,
// emits HALT signal. Critical safety layer preventing degraded model trades.
// ============================================================================

export type DriftStatus = "HEALTHY" | "CAUTION" | "HALT" | "WARMING_UP";

export interface DriftSnapshot {
  status: DriftStatus;
  accuracy: number;
  rollingSharpe: number;
  totalPredictions: number;
  baseline: number;
  action: string;
  reason?: string;
}

export class ModelDriftMonitor {
  private predictions: Array<{ predicted: string; actual: string; return_: number }> = [];
  private baselineAccuracy: number;
  private windowSize: number;
  private minSamples: number;

  constructor(options: { baselineAccuracy?: number; windowSize?: number; minSamples?: number } = {}) {
    this.baselineAccuracy = options.baselineAccuracy ?? 0.65;
    this.windowSize = options.windowSize ?? 100;
    this.minSamples = options.minSamples ?? 30;
  }

  record(predicted: string, actual: string, return_: number): void {
    this.predictions.push({ predicted, actual, return_ });
    if (this.predictions.length > this.windowSize) this.predictions.shift();
  }

  getStatus(): DriftSnapshot {
    const n = this.predictions.length;
    if (n < this.minSamples) {
      return {
        status: "WARMING_UP",
        accuracy: 0, rollingSharpe: 0,
        totalPredictions: n, baseline: this.baselineAccuracy,
        action: `Collecting data (${n}/${this.minSamples})`,
      };
    }

    const correct = this.predictions.filter((p) => p.predicted === p.actual).length;
    const accuracy = correct / n;

    const strategyReturns = this.predictions.map((p) => {
      if (p.predicted === "BULLISH") return p.return_;
      if (p.predicted === "BEARISH") return -p.return_;
      return 0;
    });
    const active = strategyReturns.filter((r) => r !== 0);
    const mean = active.length > 0 ? active.reduce((s, r) => s + r, 0) / active.length : 0;
    const variance = active.length > 0
      ? active.reduce((s, r) => s + (r - mean) ** 2, 0) / active.length : 0;
    const stddev = Math.sqrt(variance);
    const sharpe = stddev > 0 ? (mean / stddev) * Math.sqrt(252) : 0;

    if (accuracy < this.baselineAccuracy * 0.8 || sharpe < 0) {
      return {
        status: "HALT", accuracy, rollingSharpe: sharpe,
        totalPredictions: n, baseline: this.baselineAccuracy,
        action: "Stop trading immediately. Retrain model.",
        reason: accuracy < this.baselineAccuracy * 0.8
          ? `Accuracy ${(accuracy * 100).toFixed(1)}% below threshold ${(this.baselineAccuracy * 0.8 * 100).toFixed(1)}%`
          : `Sharpe ${sharpe.toFixed(2)} is negative`,
      };
    }

    if (accuracy < this.baselineAccuracy * 0.9) {
      return {
        status: "CAUTION", accuracy, rollingSharpe: sharpe,
        totalPredictions: n, baseline: this.baselineAccuracy,
        action: "Reduce position sizes by 50%",
        reason: `Accuracy ${(accuracy * 100).toFixed(1)}% showing degradation`,
      };
    }

    return {
      status: "HEALTHY", accuracy, rollingSharpe: sharpe,
      totalPredictions: n, baseline: this.baselineAccuracy,
      action: "Continue normal operations",
    };
  }

  reset(): void { this.predictions = []; }
  shouldHalt(): boolean { return this.getStatus().status === "HALT"; }
}

let instance: ModelDriftMonitor | null = null;
export function getDriftMonitor(): ModelDriftMonitor {
  if (!instance) instance = new ModelDriftMonitor();
  return instance;
}
