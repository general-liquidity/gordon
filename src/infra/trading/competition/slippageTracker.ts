/**
 * Realized-slippage accountant for live competition fills.
 *
 * The single biggest live unknown for our barbell/RV strategy is the REAL
 * execution cost — the "edge is ~0 after cost" conclusion hinges entirely on
 * how much spread/slippage we actually pay. This module records every fill's
 * realized slippage vs the reference (mid) price so we can measure the true
 * cost live and validate (or break) that assumption against real fills.
 *
 * Adverse-slippage sign convention (positive = we paid up / sold low = adverse):
 *   - BUY:  (fillPrice - refPrice) / refPrice × 1e4   (filling above mid is bad)
 *   - SELL: (refPrice - fillPrice) / refPrice × 1e4   (filling below mid is bad)
 *
 * costQuote is the signed quote-currency cost of that slippage on the fill:
 *   costQuote = slippageBps / 1e4 × refPrice × volume
 * (positive = realized cost drag, negative = price improvement).
 *
 * Pure, in-memory, standalone. No imports from other competition modules.
 * Never throws — invalid fills (refPrice ≤ 0 or non-finite inputs) are ignored.
 */

export interface SlippageFill {
  symbol: string;
  side: "buy" | "sell";
  refPrice: number;
  fillPrice: number;
  volume: number;
}

interface SlippageRecord {
  symbol: string;
  side: "buy" | "sell";
  slippageBps: number;
  costQuote: number;
}

export interface SlippageSymbolStat {
  fills: number;
  meanSlippageBps: number;
}

export interface SlippageSummary {
  fills: number;
  meanSlippageBps: number;
  medianSlippageBps: number;
  totalCostQuote: number;
  bySymbol: Record<string, SlippageSymbolStat>;
}

function isFiniteNum(x: number): boolean {
  return typeof x === "number" && Number.isFinite(x);
}

function mean(xs: number[]): number {
  if (xs.length === 0) return 0;
  let s = 0;
  for (const x of xs) s += x;
  return s / xs.length;
}

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1]! + sorted[mid]!) / 2
    : sorted[mid]!;
}

export class SlippageTracker {
  private readonly records: SlippageRecord[] = [];

  record(fill: SlippageFill): void {
    if (
      !isFiniteNum(fill.refPrice) ||
      fill.refPrice <= 0 ||
      !isFiniteNum(fill.fillPrice) ||
      !isFiniteNum(fill.volume)
    ) {
      return;
    }

    const directional =
      fill.side === "buy"
        ? (fill.fillPrice - fill.refPrice) / fill.refPrice
        : (fill.refPrice - fill.fillPrice) / fill.refPrice;
    const slippageBps = directional * 1e4;
    const costQuote = (slippageBps / 1e4) * fill.refPrice * fill.volume;

    this.records.push({
      symbol: fill.symbol,
      side: fill.side,
      slippageBps,
      costQuote,
    });
  }

  summary(): SlippageSummary {
    const all = this.records.map((r) => r.slippageBps);
    let totalCostQuote = 0;
    for (const r of this.records) totalCostQuote += r.costQuote;

    const bySymbol: Record<string, SlippageSymbolStat> = {};
    const grouped = new Map<string, number[]>();
    for (const r of this.records) {
      let bucket = grouped.get(r.symbol);
      if (!bucket) {
        bucket = [];
        grouped.set(r.symbol, bucket);
      }
      bucket.push(r.slippageBps);
    }
    for (const [symbol, bps] of grouped) {
      bySymbol[symbol] = { fills: bps.length, meanSlippageBps: mean(bps) };
    }

    return {
      fills: this.records.length,
      meanSlippageBps: mean(all),
      medianSlippageBps: median(all),
      totalCostQuote,
      bySymbol,
    };
  }

  format(): string {
    const s = this.summary();
    if (s.fills === 0) return "Slippage: no fills recorded.";

    const lines = [
      `Slippage — ${s.fills} fill${s.fills === 1 ? "" : "s"} ` +
        `(positive bps = adverse / paid up):`,
      `  mean:   ${s.meanSlippageBps.toFixed(2)} bps`,
      `  median: ${s.medianSlippageBps.toFixed(2)} bps`,
      `  total realized cost: ${s.totalCostQuote.toFixed(4)} (quote ccy)`,
    ];
    const symbols = Object.keys(s.bySymbol).sort();
    if (symbols.length > 0) {
      lines.push("  by symbol:");
      for (const sym of symbols) {
        const st = s.bySymbol[sym]!;
        lines.push(
          `    ${sym}: ${st.meanSlippageBps.toFixed(2)} bps mean ` +
            `over ${st.fills} fill${st.fills === 1 ? "" : "s"}`,
        );
      }
    }
    return lines.join("\n");
  }
}
