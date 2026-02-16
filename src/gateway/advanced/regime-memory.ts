import { getMemoryManager } from "../../core/memory/index.ts";
import { RegimeDetector } from "../../core/regime/detector.ts";

export interface RegimeMemoryQuery {
  symbol: string;
  timeframe?: string;
  query?: string;
  limit?: number;
}

export interface RegimeMemoryResult {
  symbol: string;
  timeframe: string;
  currentRegime: string | null;
  confidence?: number;
  matches: Array<{
    type: string;
    score: number;
    createdAt: string;
    content: string;
    symbols?: string[];
  }>;
}

/**
 * Retrieve memory scoped to current market regime context.
 * Falls back to symbol-scoped retrieval if no current regime is cached.
 */
export async function queryRegimeScopedMemory(input: RegimeMemoryQuery): Promise<RegimeMemoryResult> {
  const timeframe = input.timeframe ?? "1h";
  const detector = RegimeDetector.getInstance();
  const regime = detector.getCurrentRegime(input.symbol.toUpperCase(), timeframe);

  const manager = await getMemoryManager();
  const queryParts = [
    input.symbol.toUpperCase(),
    regime?.regime,
    regime?.metrics?.atr_percentile !== undefined ? `atr ${regime.metrics.atr_percentile.toFixed(0)}` : null,
    input.query ?? null,
  ].filter(Boolean);
  const query = queryParts.join(" ");

  const results = await manager.journal.search(query, {
    symbol: input.symbol.toUpperCase(),
    limit: input.limit ?? 8,
  });

  return {
    symbol: input.symbol.toUpperCase(),
    timeframe,
    currentRegime: regime?.regime ?? null,
    confidence: regime?.confidence,
    matches: results.map((r) => ({
      type: r.entry.type,
      score: r.score,
      createdAt: r.entry.createdAt,
      content: r.entry.content,
      symbols: r.entry.symbols,
    })),
  };
}
