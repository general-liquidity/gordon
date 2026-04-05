// ============================================================================
// News Backtest — Validate LLM analysis against historical price reactions
//
// Feed historical news items, get back accuracy + Sharpe + win rate for
// the agent's predictions. Critical for validating the full pipeline.
// ============================================================================

export interface NewsItem {
  date: string;
  ticker: string;
  title: string;
  content: string;
}

export interface BacktestResult {
  date: string;
  ticker: string;
  predictedSignal: "BULLISH" | "BEARISH" | "NEUTRAL";
  confidence: number;
  actualReturn: number;
  actualSignal: "BULLISH" | "BEARISH" | "NEUTRAL";
  correct: boolean;
}

export interface BacktestMetrics {
  totalPredictions: number;
  correct: number;
  accuracy: number;
  bullishAccuracy: number;
  bearishAccuracy: number;
  neutralAccuracy: number;
  highConfidenceAccuracy: number;
  avgReturn: number;
  totalReturn: number;
  sharpe: number;
  winRate: number;
  maxDrawdown: number;
}

export async function runNewsBacktest(
  newsItems: NewsItem[],
  analyzeNews: (title: string, ticker: string) => Promise<{ signal: string; confidence: number }>,
  getPriceReturn: (ticker: string, date: string) => Promise<number | null>,
  options: { minConfidence?: number } = {},
): Promise<{ results: BacktestResult[]; metrics: BacktestMetrics }> {
  const { minConfidence = 6 } = options;
  const results: BacktestResult[] = [];

  for (const item of newsItems) {
    try {
      const analysis = await analyzeNews(item.title, item.ticker);
      const ret = await getPriceReturn(item.ticker, item.date);
      if (ret === null) continue;

      const actualSignal: "BULLISH" | "BEARISH" | "NEUTRAL" =
        ret > 0.005 ? "BULLISH" : ret < -0.005 ? "BEARISH" : "NEUTRAL";

      results.push({
        date: item.date,
        ticker: item.ticker,
        predictedSignal: analysis.signal as any,
        confidence: analysis.confidence,
        actualReturn: ret,
        actualSignal,
        correct: analysis.signal === actualSignal,
      });
    } catch {}
  }

  return { results, metrics: computeMetrics(results, minConfidence) };
}

function computeMetrics(results: BacktestResult[], minConfidence: number): BacktestMetrics {
  if (results.length === 0) {
    return {
      totalPredictions: 0, correct: 0, accuracy: 0,
      bullishAccuracy: 0, bearishAccuracy: 0, neutralAccuracy: 0,
      highConfidenceAccuracy: 0, avgReturn: 0, totalReturn: 0,
      sharpe: 0, winRate: 0, maxDrawdown: 0,
    };
  }

  const correct = results.filter((r) => r.correct).length;
  const accuracy = correct / results.length;

  const accByPred = (pred: string) => {
    const subset = results.filter((r) => r.predictedSignal === pred);
    if (subset.length === 0) return 0;
    return subset.filter((r) => r.correct).length / subset.length;
  };

  const highConf = results.filter((r) => r.confidence >= minConfidence);
  const highConfAcc = highConf.length > 0
    ? highConf.filter((r) => r.correct).length / highConf.length : 0;

  const strategyReturns = results.map((r) => {
    if (r.confidence < minConfidence) return 0;
    if (r.predictedSignal === "BULLISH") return r.actualReturn;
    if (r.predictedSignal === "BEARISH") return -r.actualReturn;
    return 0;
  });

  const active = strategyReturns.filter((r) => r !== 0);
  const avgReturn = active.length > 0 ? active.reduce((s, r) => s + r, 0) / active.length : 0;
  const totalReturn = strategyReturns.reduce((s, r) => s * (1 + r), 1) - 1;
  const variance = active.length > 0
    ? active.reduce((s, r) => s + (r - avgReturn) ** 2, 0) / active.length : 0;
  const stddev = Math.sqrt(variance);
  const sharpe = stddev > 0 ? (avgReturn / stddev) * Math.sqrt(252) : 0;
  const winRate = active.length > 0 ? active.filter((r) => r > 0).length / active.length : 0;

  let peak = 1, trough = 1, maxDD = 0, equity = 1;
  for (const r of strategyReturns) {
    equity *= (1 + r);
    if (equity > peak) { peak = equity; trough = equity; }
    if (equity < trough) trough = equity;
    const dd = (peak - trough) / peak;
    if (dd > maxDD) maxDD = dd;
  }

  return {
    totalPredictions: results.length,
    correct, accuracy,
    bullishAccuracy: accByPred("BULLISH"),
    bearishAccuracy: accByPred("BEARISH"),
    neutralAccuracy: accByPred("NEUTRAL"),
    highConfidenceAccuracy: highConfAcc,
    avgReturn, totalReturn, sharpe, winRate, maxDrawdown: maxDD,
  };
}
