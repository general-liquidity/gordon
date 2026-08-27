import { PortfolioContextBuilder } from "../../../core/risk-kernel/portfolio-context.ts";
import type { GordonContext } from "../../agents/types.ts";
import type { PortfolioContext } from "./riskClassifier.ts";

const DEFAULT_TOTAL = 100_000;
const DEFAULT_CASH = 50_000;

/** Build classifier portfolio context from live exchange data or GordonContext fallbacks. */
export async function buildClassifierPortfolioContext(
  ctx: GordonContext | undefined,
): Promise<PortfolioContext & { usingDegradedDefaults?: boolean }> {
  if (ctx?.exchange) {
    try {
      const live = await new PortfolioContextBuilder().buildFromExchange(ctx.exchange);
      const total = live.totalEquity;
      return {
        usingDegradedDefaults: false,
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
        dailyLossLimitUsd: (ctx.config?.riskManagement?.maxDailyLossPercent ?? 2) * total * 0.01,
        maxDrawdownPct: ctx.config?.riskManagement?.maxDrawdownPercent ?? 10,
        currentDrawdownPct: live.currentDrawdown,
        // The daily tracker is the only source here. Using its count as the
        // hourly value is a conservative upper bound; preserve the actual
        // daily count separately so constitution checks do not invent `* 3`.
        recentTradeCount: live.todayTradeCount,
        todayTradeCount: live.todayTradeCount,
        tradedSymbols: new Set(live.openPositions.map((p) => p.symbol)),
      };
    } catch (error) {
      // A live venue was explicitly supplied, so stale context fields and the
      // synthetic 100k/50k defaults are not a safe substitute. Empty
      // positions would make every concentration check look clean.
      throw new Error("Live portfolio context is unavailable; refusing degraded risk scoring", {
        cause: error,
      });
    }
  }

  const total = ctx?.portfolioValue ?? DEFAULT_TOTAL;
  const cash = ctx?.availableCash ?? DEFAULT_CASH;
  const usingDefaults = !ctx?.exchange || total === DEFAULT_TOTAL;
  return {
    usingDegradedDefaults: usingDefaults,
    totalValueUsd: total,
    cashUsd: cash,
    positions: [],
    dailyPnlUsd: 0,
    dailyLossLimitUsd: (ctx?.config?.riskManagement?.maxDailyLossPercent ?? 2) * total * 0.01,
    maxDrawdownPct: ctx?.config?.riskManagement?.maxDrawdownPercent ?? 10,
    currentDrawdownPct: 0,
    recentTradeCount: 0,
    todayTradeCount: 0,
    tradedSymbols: new Set<string>(),
  };
}
