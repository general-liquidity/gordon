/**
 * Portfolio Drift Producer
 *
 * Periodic producer that polls Gordon's position store and fires a
 * `portfolio_drift` candidate when the portfolio is concentrated beyond
 * safe thresholds. Two trigger conditions:
 *
 *   1. Single-position concentration: any one symbol > 40% of total value
 *   2. Top-2 concentration: the two largest positions > 70% of total value
 *
 * Gets the position store via dynamic import so the producer loads cleanly
 * even if the store's path changes. If the store is unavailable the producer
 * returns silently — proactive mode degrades, doesn't break.
 */

import type { CandidateProducer } from "../proactiveEngine.ts";
import { buildCandidate } from "../proactiveEngine.ts";
import type { ProactiveSuggestion } from "../types.ts";
import { createModuleLogger } from "../../logger/index.ts";

const logger = createModuleLogger("portfolio-drift-producer");

const SINGLE_SYMBOL_THRESHOLD = 0.4; // 40%
const TOP2_CONCENTRATION_THRESHOLD = 0.7; // 70%
const MIN_PORTFOLIO_USD = 500; // Skip tiny portfolios where drift is noise

interface MinimalPosition {
  symbol: string;
  quantity?: number;
  currentPrice?: number;
  unrealizedPnL?: number;
}

interface MinimalPositionStore {
  getActive: () => Promise<MinimalPosition[]>;
}

async function loadPositionStore(): Promise<MinimalPositionStore | null> {
  try {
    const mod = (await import("../../../core/positions/store.ts" as string)) as {
      getPositionStore?: () => Promise<MinimalPositionStore>;
    };
    if (typeof mod.getPositionStore !== "function") return null;
    return await mod.getPositionStore();
  } catch (err) {
    logger.debug("Position store not accessible for drift producer", { err: String(err) });
    return null;
  }
}

export const portfolioDriftProducer: CandidateProducer = async (obs): Promise<ProactiveSuggestion[]> => {
  if (obs.source !== "monitor_loop" || obs.eventType !== "tick_portfolio_drift") return [];

  const store = await loadPositionStore();
  if (!store) return [];

  let positions: MinimalPosition[];
  try {
    positions = await store.getActive();
  } catch (err) {
    logger.debug("getActive failed", { err: String(err) });
    return [];
  }

  if (positions.length < 2) return []; // Need at least 2 positions for drift to matter

  // Compute USD value per position
  const values = positions
    .map((p) => ({
      symbol: p.symbol,
      value: (p.quantity ?? 0) * (p.currentPrice ?? 0),
    }))
    .filter((p) => p.value > 0);

  const total = values.reduce((sum, v) => sum + v.value, 0);
  if (total < MIN_PORTFOLIO_USD) return [];

  // Sort descending by value
  values.sort((a, b) => b.value - a.value);

  const topSymbol = values[0]!;
  const topWeight = topSymbol.value / total;

  const top2Symbols = values.slice(0, 2);
  const top2Weight = top2Symbols.reduce((sum, v) => sum + v.value, 0) / total;

  const candidates: ProactiveSuggestion[] = [];

  if (topWeight > SINGLE_SYMBOL_THRESHOLD) {
    candidates.push(
      buildCandidate(
        "portfolio_drift",
        `${topSymbol.symbol} is ${(topWeight * 100).toFixed(0)}% of portfolio`,
        `Your portfolio has drifted — ${topSymbol.symbol} is now ` +
          `${(topWeight * 100).toFixed(0)}% of total value across ${positions.length} positions. ` +
          `Concentration risk: a single position at this weight means a big drawdown ` +
          `in one name wipes out diversification. Consider trimming or rebalancing.`,
        {
          confidence: topWeight > 0.55 ? 0.85 : 0.72,
          action: `Review get_portfolio or /rebalance to redistribute weight`,
          triggers: {
            source: "monitor_loop",
            eventType: "tick_portfolio_drift",
            symbol: topSymbol.symbol,
            metadata: {
              topSymbolWeight: topWeight,
              totalValueUsd: total,
              positionCount: positions.length,
            },
          },
          operation: {
            tool: "get_portfolio",
            args: {},
            readOnly: true,
            description: "Show current portfolio composition",
          },
        },
      ),
    );
  } else if (top2Weight > TOP2_CONCENTRATION_THRESHOLD) {
    candidates.push(
      buildCandidate(
        "portfolio_drift",
        `Top 2 positions account for ${(top2Weight * 100).toFixed(0)}% of portfolio`,
        `${top2Symbols[0]?.symbol} and ${top2Symbols[1]?.symbol} together are ` +
          `${(top2Weight * 100).toFixed(0)}% of your portfolio across ${positions.length} positions. ` +
          `Two-name concentration carries correlated risk — consider reducing or adding uncorrelated exposure.`,
        {
          confidence: 0.7,
          action: `Review /rebalance or open uncorrelated positions`,
          triggers: {
            source: "monitor_loop",
            eventType: "tick_portfolio_drift",
            metadata: {
              top2Weight,
              totalValueUsd: total,
              topSymbols: [top2Symbols[0]?.symbol, top2Symbols[1]?.symbol],
            },
          },
          operation: {
            tool: "get_portfolio",
            args: {},
            readOnly: true,
            description: "Show current portfolio composition",
          },
        },
      ),
    );
  }

  return candidates;
};
