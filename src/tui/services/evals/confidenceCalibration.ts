// ============================================================================
// Confidence Calibration — Track whether model confidence matches accuracy
//
// A well-calibrated model predicting "confidence 9" should be right ~90%.
// If conf=9 is only 60% accurate, the model is OVERCONFIDENT.
// ============================================================================

import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import { getGordonDir } from "../../../infra/storage/paths.ts";

const CALIBRATION_PATH = join(getGordonDir(), "calibration.json");

export interface CalibrationEntry {
  id: string;
  timestamp: number;
  symbol: string;
  predictedSignal: "BULLISH" | "BEARISH" | "NEUTRAL";
  predictedConfidence: number;
  actualOutcome?: "correct" | "incorrect" | "neutral";
  actualReturn?: number;
}

export interface CalibrationBucket {
  confidence: number;
  totalPredictions: number;
  correct: number;
  incorrect: number;
  accuracy: number;
  expectedAccuracy: number;
  calibrationError: number;
}

export interface CalibrationReport {
  totalPredictions: number;
  resolvedPredictions: number;
  overallAccuracy: number;
  buckets: CalibrationBucket[];
  isWellCalibrated: boolean;
  overconfidenceScore: number;
}

export class ConfidenceCalibrationTracker {
  private entries: CalibrationEntry[] = [];

  constructor() { this.load(); }

  record(entry: Omit<CalibrationEntry, "id" | "timestamp">): string {
    const id = `cal_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    this.entries.push({ ...entry, id, timestamp: Date.now() });
    this.save();
    return id;
  }

  resolve(id: string, actualReturn: number): void {
    const entry = this.entries.find((e) => e.id === id);
    if (!entry) return;
    entry.actualReturn = actualReturn;
    if (entry.predictedSignal === "BULLISH") {
      entry.actualOutcome = actualReturn > 0.005 ? "correct" : actualReturn < -0.005 ? "incorrect" : "neutral";
    } else if (entry.predictedSignal === "BEARISH") {
      entry.actualOutcome = actualReturn < -0.005 ? "correct" : actualReturn > 0.005 ? "incorrect" : "neutral";
    } else {
      entry.actualOutcome = Math.abs(actualReturn) < 0.005 ? "correct" : "incorrect";
    }
    this.save();
  }

  getReport(): CalibrationReport {
    const resolved = this.entries.filter((e) => e.actualOutcome);
    const buckets: CalibrationBucket[] = [];

    for (let conf = 1; conf <= 10; conf++) {
      const bucket = resolved.filter((e) => e.predictedConfidence === conf);
      if (bucket.length === 0) continue;
      const correct = bucket.filter((e) => e.actualOutcome === "correct").length;
      const incorrect = bucket.filter((e) => e.actualOutcome === "incorrect").length;
      const total = correct + incorrect;
      const accuracy = total > 0 ? correct / total : 0;
      const expected = conf / 10;
      buckets.push({
        confidence: conf,
        totalPredictions: bucket.length,
        correct, incorrect, accuracy,
        expectedAccuracy: expected,
        calibrationError: Math.abs(accuracy - expected),
      });
    }

    const maxError = buckets.length > 0 ? Math.max(...buckets.map((b) => b.calibrationError)) : 1;
    const overallAcc = resolved.length > 0
      ? resolved.filter((e) => e.actualOutcome === "correct").length / resolved.length
      : 0;
    const overconfidence = buckets.reduce((sum, b) =>
      sum + (b.expectedAccuracy - b.accuracy) * b.totalPredictions, 0
    ) / Math.max(1, resolved.length);

    return {
      totalPredictions: this.entries.length,
      resolvedPredictions: resolved.length,
      overallAccuracy: overallAcc,
      buckets,
      isWellCalibrated: maxError < 0.15 && resolved.length >= 30,
      overconfidenceScore: overconfidence,
    };
  }

  private load(): void {
    try {
      if (existsSync(CALIBRATION_PATH)) {
        this.entries = JSON.parse(readFileSync(CALIBRATION_PATH, "utf-8"));
      }
    } catch { this.entries = []; }
  }

  private save(): void {
    try { writeFileSync(CALIBRATION_PATH, JSON.stringify(this.entries, null, 2)); } catch {}
  }
}

let instance: ConfidenceCalibrationTracker | null = null;
export function getCalibrationTracker(): ConfidenceCalibrationTracker {
  if (!instance) instance = new ConfidenceCalibrationTracker();
  return instance;
}
