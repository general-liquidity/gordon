// ============================================================================
// Symbol Accuracy Stats — Per-symbol LLM prediction tracking
//
// Not all stocks are equally predictable. Track per-symbol accuracy to know
// where the model has edge and where it's just noise.
// ============================================================================

import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import { getGordonDir } from "../../../infra/storage/paths.ts";

const SYMBOL_STATS_PATH = join(getGordonDir(), "symbol-accuracy.json");

export interface SymbolPrediction {
  timestamp: number;
  predictedSignal: "BULLISH" | "BEARISH" | "NEUTRAL";
  confidence: number;
  actualReturn?: number;
  correct?: boolean;
}

export interface SymbolStats {
  symbol: string;
  totalPredictions: number;
  resolvedPredictions: number;
  correct: number;
  incorrect: number;
  accuracy: number;
  avgReturn: number;
  winRate: number;
  bestSignal: "BULLISH" | "BEARISH" | "NEUTRAL";
  bestSignalAccuracy: number;
}

export class SymbolAccuracyTracker {
  private predictions: Record<string, SymbolPrediction[]> = {};

  constructor() { this.load(); }

  record(symbol: string, prediction: Omit<SymbolPrediction, "timestamp">): void {
    const sym = symbol.toUpperCase();
    if (!this.predictions[sym]) this.predictions[sym] = [];
    this.predictions[sym]!.push({ ...prediction, timestamp: Date.now() });
    this.save();
  }

  resolve(symbol: string, timestamp: number, actualReturn: number): void {
    const sym = symbol.toUpperCase();
    const preds = this.predictions[sym];
    if (!preds) return;
    const pred = preds.find((p) => p.timestamp === timestamp);
    if (!pred) return;
    pred.actualReturn = actualReturn;
    if (pred.predictedSignal === "BULLISH") pred.correct = actualReturn > 0.005;
    else if (pred.predictedSignal === "BEARISH") pred.correct = actualReturn < -0.005;
    else pred.correct = Math.abs(actualReturn) < 0.005;
    this.save();
  }

  getStats(symbol: string): SymbolStats | null {
    const sym = symbol.toUpperCase();
    const preds = this.predictions[sym] ?? [];
    const resolved = preds.filter((p) => p.correct !== undefined);
    if (preds.length === 0) return null;

    const correct = resolved.filter((p) => p.correct).length;
    const incorrect = resolved.filter((p) => p.correct === false).length;
    const accuracy = resolved.length > 0 ? correct / resolved.length : 0;
    const avgReturn = resolved.length > 0
      ? resolved.reduce((s, p) => s + (p.actualReturn ?? 0), 0) / resolved.length
      : 0;

    const wins = resolved.filter((p) => {
      if (p.predictedSignal === "BULLISH" && (p.actualReturn ?? 0) > 0) return true;
      if (p.predictedSignal === "BEARISH" && (p.actualReturn ?? 0) < 0) return true;
      return false;
    }).length;
    const winRate = resolved.length > 0 ? wins / resolved.length : 0;

    const bySignal = { BULLISH: [] as SymbolPrediction[], BEARISH: [] as SymbolPrediction[], NEUTRAL: [] as SymbolPrediction[] };
    for (const p of resolved) bySignal[p.predictedSignal].push(p);
    let bestSignal: "BULLISH" | "BEARISH" | "NEUTRAL" = "NEUTRAL";
    let bestAcc = 0;
    for (const [sig, arr] of Object.entries(bySignal)) {
      if (arr.length < 3) continue;
      const acc = arr.filter((p) => p.correct).length / arr.length;
      if (acc > bestAcc) { bestAcc = acc; bestSignal = sig as any; }
    }

    return {
      symbol: sym,
      totalPredictions: preds.length,
      resolvedPredictions: resolved.length,
      correct, incorrect, accuracy, avgReturn, winRate,
      bestSignal, bestSignalAccuracy: bestAcc,
    };
  }

  getAllStats(): SymbolStats[] {
    return Object.keys(this.predictions)
      .map((sym) => this.getStats(sym))
      .filter((s): s is SymbolStats => s !== null)
      .sort((a, b) => b.accuracy - a.accuracy);
  }

  getTopPerformers(n: number = 10): SymbolStats[] {
    return this.getAllStats().filter((s) => s.resolvedPredictions >= 5).slice(0, n);
  }

  getWorstPerformers(n: number = 10): SymbolStats[] {
    return this.getAllStats().filter((s) => s.resolvedPredictions >= 5).reverse().slice(0, n);
  }

  private load(): void {
    try {
      if (existsSync(SYMBOL_STATS_PATH)) {
        this.predictions = JSON.parse(readFileSync(SYMBOL_STATS_PATH, "utf-8"));
      }
    } catch { this.predictions = {}; }
  }

  private save(): void {
    try { writeFileSync(SYMBOL_STATS_PATH, JSON.stringify(this.predictions, null, 2)); } catch {}
  }
}

let instance: SymbolAccuracyTracker | null = null;
export function getSymbolAccuracyTracker(): SymbolAccuracyTracker {
  if (!instance) instance = new SymbolAccuracyTracker();
  return instance;
}
