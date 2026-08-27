// Denial Memory
//
// When user denies a trade, capture WHY. Over time, build a profile of
// the user's risk preferences so the agent stops proposing unacceptable trades.
//
// Examples of learned patterns:
// - "User denied 5 trades with drawdown > 4% → max acceptable drawdown: 4%"
// - "User denied 3 LONG trades on AAPL → dislikes AAPL longs"
// - "User only approves trades with R:R >= 2:1 → min R:R threshold"

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { getGordonDir } from "../../../infra/storage/paths.ts";

const DENIALS_PATH = join(getGordonDir(), "denials.json");

export interface DenialRecord {
  id: string;
  timestamp: number;
  symbol: string;
  side: "LONG" | "SHORT";
  entry: number;
  stopLoss: number;
  takeProfit: number;
  sizeUsd: number;
  drawdownPct: number;
  riskRewardRatio: number;
  confidence: number;
  userReason?: string; // optional user-provided explanation
}

export interface LearnedPreferences {
  maxDrawdownPct: number | null;
  minRiskRewardRatio: number | null;
  minConfidence: number | null;
  avoidedSymbols: string[];
  avoidedSideBySymbol: Record<string, Array<"LONG" | "SHORT">>;
  sampleSize: number;
}

export class DenialMemory {
  private denials: DenialRecord[] = [];

  constructor() {
    this.load();
  }

  record(denial: Omit<DenialRecord, "id" | "timestamp">): void {
    const id = `den_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    this.denials.push({ ...denial, id, timestamp: Date.now() });
    this.save();
  }

  getLearnedPreferences(): LearnedPreferences {
    if (this.denials.length === 0) {
      return {
        maxDrawdownPct: null,
        minRiskRewardRatio: null,
        minConfidence: null,
        avoidedSymbols: [],
        avoidedSideBySymbol: {},
        sampleSize: 0,
      };
    }

    // Max drawdown: the highest drawdown the user has ACCEPTED
    // (inferred: take the minimum drawdown among denials to suggest user's ceiling)
    const drawdowns = this.denials.map((d) => d.drawdownPct).sort((a, b) => a - b);
    const p25Drawdown = drawdowns[Math.floor(drawdowns.length * 0.25)] ?? null;

    // Min R:R: the highest R:R among denied trades suggests user wants even higher
    const rrs = this.denials.map((d) => d.riskRewardRatio).sort((a, b) => b - a);
    const p75RR = rrs[Math.floor(rrs.length * 0.25)] ?? null;

    // Min confidence: similar logic
    const confs = this.denials.map((d) => d.confidence).sort((a, b) => b - a);
    const p75Conf = confs[Math.floor(confs.length * 0.25)] ?? null;

    // Symbols consistently denied
    const symbolCounts: Record<string, number> = {};
    for (const d of this.denials) {
      symbolCounts[d.symbol] = (symbolCounts[d.symbol] ?? 0) + 1;
    }
    const avoidedSymbols = Object.entries(symbolCounts)
      .filter(([_, count]) => count >= 3)
      .map(([sym]) => sym);

    // Side-by-symbol patterns
    const sideBySymbol: Record<string, { LONG: number; SHORT: number }> = {};
    for (const d of this.denials) {
      if (!sideBySymbol[d.symbol]) sideBySymbol[d.symbol] = { LONG: 0, SHORT: 0 };
      sideBySymbol[d.symbol]![d.side]++;
    }
    const avoidedSideBySymbol: Record<string, Array<"LONG" | "SHORT">> = {};
    for (const [sym, counts] of Object.entries(sideBySymbol)) {
      const avoided: Array<"LONG" | "SHORT"> = [];
      if (counts.LONG >= 3) avoided.push("LONG");
      if (counts.SHORT >= 3) avoided.push("SHORT");
      if (avoided.length > 0) avoidedSideBySymbol[sym] = avoided;
    }

    return {
      maxDrawdownPct: p25Drawdown,
      minRiskRewardRatio: p75RR,
      minConfidence: p75Conf,
      avoidedSymbols,
      avoidedSideBySymbol,
      sampleSize: this.denials.length,
    };
  }

  // Generate instructions to inject into agent prompts
  toAgentInstructions(): string {
    const prefs = this.getLearnedPreferences();
    if (prefs.sampleSize < 3) return "";

    const lines = [`User's trading preferences (learned from ${prefs.sampleSize} denied trades):`];

    if (prefs.maxDrawdownPct !== null) {
      lines.push(`- Maximum acceptable drawdown: ${prefs.maxDrawdownPct.toFixed(1)}%`);
    }
    if (prefs.minRiskRewardRatio !== null) {
      lines.push(`- Minimum risk/reward ratio: ${prefs.minRiskRewardRatio.toFixed(1)}:1`);
    }
    if (prefs.minConfidence !== null) {
      lines.push(`- Minimum confidence: ${prefs.minConfidence}/10`);
    }
    if (prefs.avoidedSymbols.length > 0) {
      lines.push(`- Avoid these symbols: ${prefs.avoidedSymbols.join(", ")}`);
    }
    for (const [sym, sides] of Object.entries(prefs.avoidedSideBySymbol)) {
      lines.push(`- Avoid ${sides.join(" and ")} on ${sym}`);
    }
    lines.push("");
    lines.push("Do not propose trades violating these preferences.");
    return lines.join("\n");
  }

  private load(): void {
    try {
      if (existsSync(DENIALS_PATH)) {
        this.denials = JSON.parse(readFileSync(DENIALS_PATH, "utf-8"));
      }
    } catch {
      this.denials = [];
    }
  }

  private save(): void {
    try {
      writeFileSync(DENIALS_PATH, JSON.stringify(this.denials, null, 2));
    } catch {}
  }
}

let instance: DenialMemory | null = null;
export function getDenialMemory(): DenialMemory {
  if (!instance) instance = new DenialMemory();
  return instance;
}
