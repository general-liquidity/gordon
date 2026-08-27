// ============================================================================
// Trade Reflection — Post-trade learning loop
//
// After every closed trade, produces structured analysis:
// - Was the decision correct or incorrect?
// - What contributing factors drove success or failure?
// - What patterns should be remembered for future trades?
//
// Inspired by TradingAgents (UCLA/MIT). Adapted for Gordon's trading stack.
// Feeds into memory system + denial memory for continuous learning.
// ============================================================================

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { getGordonDir } from "../../../infra/storage/paths.ts";

const REFLECTIONS_PATH = join(getGordonDir(), "reflections.json");

export interface TradeOutcome {
  tradeId: string;
  symbol: string;
  side: "LONG" | "SHORT";
  entryPrice: number;
  exitPrice: number;
  quantity: number;
  pnl: number;
  pnlPercent: number;
  holdDurationMs: number;
  stopLoss?: number;
  takeProfit?: number;
  originalConfidence: number;
  originalReasoning: string;
  keyFactors: string[];
  closedAt: number;
}

export interface TradeContext {
  technicalSignals?: string[]; // indicator states at entry
  newsHeadlines?: string[]; // relevant news at entry
  marketRegime?: string; // trending/ranging/volatile
  correlationState?: string; // was it a crowded trade
  fundamentalFactors?: string[]; // P/E, growth, etc
}

export interface ReflectionResult {
  id: string;
  tradeId: string;
  timestamp: number;
  wasCorrect: boolean;
  correctnessScore: number; // -1 to 1 (magnitude of correctness)
  primaryCause: string; // main reason for success/failure
  contributingFactors: Array<{
    category:
      | "technical"
      | "fundamental"
      | "news"
      | "sentiment"
      | "macro"
      | "execution"
      | "risk_management";
    factor: string;
    impact: "positive" | "negative" | "neutral";
  }>;
  lessonLearned: string;
  memoryToStore: string; // compressed learning for future retrieval
  patternIdentified?: string;
  shouldHaveDone?: string; // counterfactual best action
}

export const REFLECTION_PROMPT = `You are a senior trading analyst reviewing a closed trade.
Your job is to produce a structured reflection that will inform future decisions.

TRADE OUTCOME:
Symbol: {symbol}
Side: {side}
Entry: \${entry}
Exit: \${exit}
P&L: {pnlSign}\${pnl} ({pnlPct}%)
Hold duration: {holdDuration}
Original confidence: {confidence}/10
Original reasoning: {reasoning}
Key factors cited: {keyFactors}

MARKET CONTEXT AT ENTRY:
Technical signals: {technicalSignals}
News at time: {newsHeadlines}
Market regime: {regime}
Fundamentals: {fundamentals}

Analyze this trade and produce JSON:
1. Was the decision CORRECT (profitable outcome aligned with reasoning) or INCORRECT?
2. What was the PRIMARY cause of success/failure?
3. Which factors CONTRIBUTED positively or negatively?
4. What is the KEY LESSON to remember for similar future situations?
5. Identify any PATTERN that emerged.
6. What SHOULD you have done differently (if anything)?

Be brutally honest. Good outcomes with bad reasoning are still bad trades.
Bad outcomes with good reasoning are still good trades (bad luck, not bad skill).

Respond in JSON:
{
  "wasCorrect": true|false,
  "correctnessScore": -1 to 1,
  "primaryCause": "...",
  "contributingFactors": [
    {"category": "...", "factor": "...", "impact": "positive|negative|neutral"}
  ],
  "lessonLearned": "...",
  "memoryToStore": "Brief 1-2 sentence pattern for future retrieval",
  "patternIdentified": "...",
  "shouldHaveDone": "..."
}`;

export function buildReflectionPrompt(outcome: TradeOutcome, context: TradeContext = {}): string {
  return REFLECTION_PROMPT.replace("{symbol}", outcome.symbol)
    .replace("{side}", outcome.side)
    .replace("{entry}", outcome.entryPrice.toFixed(2))
    .replace("{exit}", outcome.exitPrice.toFixed(2))
    .replace("{pnlSign}", outcome.pnl >= 0 ? "+" : "-")
    .replace("{pnl}", Math.abs(outcome.pnl).toFixed(2))
    .replace("{pnlPct}", (outcome.pnl >= 0 ? "+" : "") + outcome.pnlPercent.toFixed(2))
    .replace("{holdDuration}", formatDuration(outcome.holdDurationMs))
    .replace("{confidence}", String(outcome.originalConfidence))
    .replace("{reasoning}", outcome.originalReasoning)
    .replace("{keyFactors}", outcome.keyFactors.join(", "))
    .replace("{technicalSignals}", (context.technicalSignals ?? ["none provided"]).join(", "))
    .replace("{newsHeadlines}", (context.newsHeadlines ?? ["none provided"]).join("; "))
    .replace("{regime}", context.marketRegime ?? "unknown")
    .replace("{fundamentals}", (context.fundamentalFactors ?? ["none provided"]).join(", "));
}

function formatDuration(ms: number): string {
  const days = Math.floor(ms / (1000 * 60 * 60 * 24));
  const hours = Math.floor((ms % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h`;
  return `${Math.floor(ms / 60000)}m`;
}

export class TradeReflectionStore {
  private reflections: ReflectionResult[] = [];

  constructor() {
    this.load();
  }

  record(result: Omit<ReflectionResult, "id" | "timestamp">): string {
    const id = `refl_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    this.reflections.push({ ...result, id, timestamp: Date.now() });
    this.save();
    return id;
  }

  getByTrade(tradeId: string): ReflectionResult | null {
    return this.reflections.find((r) => r.tradeId === tradeId) ?? null;
  }

  getAll(): ReflectionResult[] {
    return [...this.reflections].sort((a, b) => b.timestamp - a.timestamp);
  }

  getRecentLessons(n: number = 10): string[] {
    return this.getAll()
      .slice(0, n)
      .map((r) => r.lessonLearned);
  }

  // Get patterns that repeat across multiple reflections
  getRecurringPatterns(minOccurrences: number = 2): Array<{ pattern: string; count: number }> {
    const patterns: Record<string, number> = {};
    for (const r of this.reflections) {
      if (r.patternIdentified) {
        patterns[r.patternIdentified] = (patterns[r.patternIdentified] ?? 0) + 1;
      }
    }
    return Object.entries(patterns)
      .filter(([_, count]) => count >= minOccurrences)
      .map(([pattern, count]) => ({ pattern, count }))
      .sort((a, b) => b.count - a.count);
  }

  // Get accuracy of primary cause attribution
  getReflectionAccuracy(): { total: number; correct: number; accuracy: number } {
    const total = this.reflections.length;
    const correct = this.reflections.filter((r) => r.wasCorrect).length;
    return { total, correct, accuracy: total > 0 ? correct / total : 0 };
  }

  // Build memory injection for agent prompts
  toAgentContext(limit: number = 5): string {
    const recent = this.getAll().slice(0, limit);
    if (recent.length === 0) return "";

    const lines = [`Recent trade reflections (${recent.length}):`];
    for (const r of recent) {
      const marker = r.wasCorrect ? "✓" : "✗";
      lines.push(`${marker} ${r.memoryToStore}`);
    }
    return lines.join("\n");
  }

  private load(): void {
    try {
      if (existsSync(REFLECTIONS_PATH)) {
        this.reflections = JSON.parse(readFileSync(REFLECTIONS_PATH, "utf-8"));
      }
    } catch {
      this.reflections = [];
    }
  }

  private save(): void {
    try {
      writeFileSync(REFLECTIONS_PATH, JSON.stringify(this.reflections, null, 2));
    } catch {}
  }
}

let instance: TradeReflectionStore | null = null;
export function getReflectionStore(): TradeReflectionStore {
  if (!instance) instance = new TradeReflectionStore();
  return instance;
}
