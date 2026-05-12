// ============================================================================
// Market Pulse — Sentiment scan across a watchlist
//
// Scans symbols, fetches recent news, runs sentiment analysis, and shows
// bullish/bearish counts per ticker: BTC [+++--] (avg conf: 7/10)
// ============================================================================

export interface PulseEntry {
  ticker: string;
  signal: "BULLISH" | "BEARISH" | "NEUTRAL";
  confidence: number;
  newsTitle: string;
  timestamp: number;
}

export interface SymbolPulse {
  ticker: string;
  bullCount: number;
  bearCount: number;
  neutralCount: number;
  avgConfidence: number;
  dominantSignal: "BULLISH" | "BEARISH" | "NEUTRAL" | "MIXED";
  entries: PulseEntry[];
}

export async function scanMarketPulse(
  tickers: string[],
  analyzeNews: (title: string, ticker: string) => Promise<{ signal: string; confidence: number }>,
  fetchNews: (ticker: string, limit: number) => Promise<Array<{ title: string; timestamp: number }>>,
  newsPerTicker: number = 3,
): Promise<SymbolPulse[]> {
  const results: SymbolPulse[] = [];

  for (const ticker of tickers) {
    try {
      const news = await fetchNews(ticker, newsPerTicker);
      const entries: PulseEntry[] = [];

      for (const item of news) {
        try {
          const analysis = await analyzeNews(item.title, ticker);
          entries.push({
            ticker,
            signal: analysis.signal as any,
            confidence: analysis.confidence,
            newsTitle: item.title,
            timestamp: item.timestamp,
          });
        } catch {}
      }

      const bull = entries.filter((e) => e.signal === "BULLISH").length;
      const bear = entries.filter((e) => e.signal === "BEARISH").length;
      const neutral = entries.filter((e) => e.signal === "NEUTRAL").length;
      const avgConf = entries.length > 0
        ? entries.reduce((s, e) => s + e.confidence, 0) / entries.length : 0;

      let dominant: SymbolPulse["dominantSignal"] = "NEUTRAL";
      if (bull > bear && bull > neutral) dominant = "BULLISH";
      else if (bear > bull && bear > neutral) dominant = "BEARISH";
      else if (bull === bear && bull > 0) dominant = "MIXED";

      results.push({
        ticker, bullCount: bull, bearCount: bear, neutralCount: neutral,
        avgConfidence: avgConf, dominantSignal: dominant, entries,
      });
    } catch {}
  }

  return results;
}

export function renderPulseBar(pulse: SymbolPulse): string {
  const bulls = "+".repeat(pulse.bullCount);
  const bears = "-".repeat(pulse.bearCount);
  const neutrals = ".".repeat(pulse.neutralCount);
  return `${pulse.ticker.padEnd(8)} [${bulls}${bears}${neutrals}] (avg conf: ${pulse.avgConfidence.toFixed(0)}/10)`;
}
