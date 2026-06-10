import { PortfolioContextBuilder } from "../../../core/risk-kernel/portfolio-context.ts";
import type { GordonContext } from "../../agents/types.ts";
import type { PortfolioContext } from "./riskClassifier.ts";

const DEFAULT_TOTAL = 100_000;
const DEFAULT_CASH = 50_000;

/** Build classifier portfolio context from live exchange data or GordonContext fallbacks. */
export async function buildClassifierPortfolioContext(
  ctx: GordonContext | undefined,
): Promise<PortfolioContext> {
  if (ctx?.exchange) {
    try {
      const live = await new PortfolioContextBuilder().buildFromExchange(ctx.exchange);
      const total = live.totalEquity;
      return {
        totalValueUsd: total,
        cashUsd: live.availableBalance,
        positions: live.openPositions.map((p) => {
          const notionalUsd = Math.abs(p.size * p.currentPrice);
          return {
            symbol: p.symbol,
            notionalUsd,
            weightPct: total > 0 ? (notionalUsd / total) * 100 : 0,
            unrealizedPnlPct:
              p.entryPrice > 0 ? ((p.currentPrice - p.entryPrice) / p.entryPrice) * 100 : 0,
          };
        }),
        dailyPnlUsd: live.todayPnL,
        dailyLossLimitUsd:
          (ctx.config?.riskManagement?.maxDailyLossPercent ?? 2) * total * 0.01,
        maxDrawdownPct: ctx.config?.riskManagement?.maxDrawdownPercent ?? 10,
        currentDrawdownPct: live.currentDrawdown,
        recentTradeCount: live.todayTradeCount,
        tradedSymbols: new Set(live.openPositions.map((p) => p.symbol)),
      };
    } catch {
      // fall through to context fields
    }
  }

  const total = ctx?.portfolioValue ?? DEFAULT_TOTAL;
  const cash = ctx?.availableCash ?? DEFAULT_CASH;
  return {
    totalValueUsd: total,
    cashUsd: cash,
    positions: [],
    dailyPnlUsd: 0,
    dailyLossLimitUsd: (ctx?.config?.riskManagement?.maxDailyLossPercent ?? 2) * total * 0.01,
    maxDrawdownPct: ctx?.config?.riskManagement?.maxDrawdownPercent ?? 10,
    currentDrawdownPct: 0,
    recentTradeCount: 0,
    tradedSymbols: new Set<string>(),
  };
}