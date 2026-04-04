// ============================================================================
// Speculation Engine — Pre-fetch likely next data while showing current result
// ============================================================================

interface Message { content?: string; }
export interface PredictedAction { type: "fetch_candles" | "fetch_orderbook" | "run_analysis"; symbol?: string; }

export class SpeculationEngine {
  private pending: AbortController | null = null;

  predict(messages: Message[]): PredictedAction | null {
    const last = messages[messages.length - 1]?.content ?? "";
    // If user just scanned, predict they'll analyze the top symbol
    if (last.includes("scan")) return { type: "run_analysis" };
    // If user viewed a symbol, predict orderbook fetch
    const symbolMatch = last.match(/\b([A-Z]{2,10}\/[A-Z]{2,6})\b/);
    if (symbolMatch) return { type: "fetch_orderbook", symbol: symbolMatch[1] };
    return null;
  }

  prefetch(_action: PredictedAction): void {
    this.pending = new AbortController();
    // Would actually pre-fetch data here
  }

  getResult(_action: PredictedAction): any | null { return null; }

  abort(): void {
    this.pending?.abort();
    this.pending = null;
  }
}
