/**
 * Agent Tools Index
 * Exports all tools organized by domain
 */

// Domain-specific tool exports
export { marketTools, scanMarketTool, analyzeCoinTool, getHistoricalOpportunitiesTool } from "./market.ts";
export { tradingTools, createPlanTool, executePlanTool, closeTradeTool, listPlansTool, approvePlanTool, armSystemTool } from "./trading.ts";
export { accountTools, getPortfolioTool, getAccountDetailsTool, getEarnPositionsTool } from "./account.ts";
export { historyTools, getTradeHistoryTool, getTransferHistoryTool } from "./history.ts";
export { positionTools, checkPositionsTool } from "./positions.ts";
export { explainTools, explainTool } from "./explain.ts";
export { systemTools, testConnectionTool } from "./system.ts";
export { schedulerTools, startSchedulerTool, stopSchedulerTool, getSchedulerStatusTool } from "./scheduler.ts";

// New tool exports
export { walletTools, getDustableAssetsTool, convertDustTool, transferFundsTool, getCoinInfoTool, getTradeFeesTool, getAssetDividendsTool, getDepositAddressTool } from "./wallet.ts";
export { earnTools, getFlexibleProductsTool, getLockedProductsTool, getAllEarnPositionsTool, subscribeFlexibleTool, redeemFlexibleTool, subscribeLockedTool } from "./earn.ts";
export { orderbookTools, getOrderBookTool, getSpreadTool, getRecentTradesTool, placeOCOOrderTool, cancelAllOrdersTool, getOrderStatusTool, testOrderTool } from "./orderbook.ts";
export { discoveryTools, getTrendingTokensTool, getHighVolumeTokensTool, getAvailableMarketsTool, placeBracketOrderTool } from "./discovery.ts";
export { chartTools, displayPriceChartTool, displayCandlestickChartTool, displayComparisonChartTool, displayVolumeChartTool } from "./charts.ts";
export { indicatorTools, getTechnicalAnalysisTool, getTechnicalSignalsTool, getStopLossLevelsTool, getPositionSizeTool, getRSITool, getVWAPTool, getStochasticRSITool } from "./indicators.ts";

// Type exports
export type { ToolRunContext } from "./types.ts";
export { errors } from "./types.ts";

// Import all tool arrays
import { marketTools } from "./market.ts";
import { tradingTools } from "./trading.ts";
import { accountTools } from "./account.ts";
import { historyTools } from "./history.ts";
import { positionTools } from "./positions.ts";
import { explainTools } from "./explain.ts";
import { systemTools } from "./system.ts";
import { schedulerTools } from "./scheduler.ts";
import { walletTools } from "./wallet.ts";
import { earnTools } from "./earn.ts";
import { orderbookTools } from "./orderbook.ts";
import { discoveryTools } from "./discovery.ts";
import { chartTools } from "./charts.ts";
import { indicatorTools } from "./indicators.ts";

/**
 * All tools combined - use this for the agent
 */
export const allTools = [
  ...marketTools,
  ...tradingTools,
  ...accountTools,
  ...historyTools,
  ...positionTools,
  ...explainTools,
  ...systemTools,
  ...schedulerTools,
  ...walletTools,
  ...earnTools,
  ...orderbookTools,
  ...discoveryTools,
  ...chartTools,
  ...indicatorTools,
];

/**
 * Tool counts by category (useful for debugging)
 */
export const toolCounts = {
  market: marketTools.length,
  trading: tradingTools.length,
  account: accountTools.length,
  history: historyTools.length,
  positions: positionTools.length,
  explain: explainTools.length,
  system: systemTools.length,
  scheduler: schedulerTools.length,
  wallet: walletTools.length,
  earn: earnTools.length,
  orderbook: orderbookTools.length,
  discovery: discoveryTools.length,
  charts: chartTools.length,
  indicators: indicatorTools.length,
  total: allTools.length,
};
