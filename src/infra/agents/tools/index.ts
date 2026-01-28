/**
 * Agent Tools Index
 * Exports all tools organized by domain
 */

// Domain-specific tool exports
export { marketTools, scanMarketTool, analyzeCoinTool } from "./market.ts";
export { tradingTools, createPlanTool, executePlanTool, closeTradeTool, listPlansTool, approvePlanTool, armSystemTool } from "./trading.ts";
export { accountTools, getPortfolioTool, getAccountDetailsTool, getEarnPositionsTool } from "./account.ts";
export { historyTools, getTradeHistoryTool, getTransferHistoryTool } from "./history.ts";
export { positionTools, checkPositionsTool } from "./positions.ts";
export { explainTools, explainTool } from "./explain.ts";
export { systemTools, testConnectionTool } from "./system.ts";

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
  total: allTools.length,
};
