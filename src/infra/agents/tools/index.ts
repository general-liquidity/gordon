/**
 * Gordon Tools Index
 * All tools for Mastra agents (object-based format)
 *
 * Tools are organized by category:
 * - indicators: Technical analysis (RSI, MACD, Bollinger Bands, etc.)
 * - explain: Educational explanations
 * - market: Market scanning and analysis
 * - positions: Position monitoring
 * - scheduler: Task scheduling
 * - system: System control (arm/disarm)
 * - earn: Staking and savings
 * - charts: Price visualization
 * - orderbook: Order book and liquidity
 * - wallet: Wallet management
 * - discovery: Coin discovery
 * - history: Trade/transfer history
 * - account: Account information
 * - trading: Plan creation and execution
 * - marketAnalysis: Advanced market analysis (whale detection, breakouts, consolidation, scoring)
 * - riskManagement: Risk management (Kelly sizing, daily limits, exit conditions, drawdown)
 * - strategies: Strategy library (list, detect, scan, suggest)
 * - metrics: Performance metrics and statistics
 */

// Migrated tools
export { indicatorTools } from "./indicators.ts";
export { explainTools } from "./explain.ts";
export { marketTools } from "./market.ts";
export { positionTools } from "./positions.ts";
export { schedulerTools } from "./scheduler.ts";
export { systemTools } from "./system.ts";
export { earnTools } from "./earn.ts";
export { chartTools } from "./charts.ts";
export { orderbookTools } from "./orderbook.ts";
export { walletTools } from "./wallet.ts";
export { discoveryTools } from "./discovery.ts";
export { historyTools } from "./history.ts";
export { accountTools } from "./account.ts";
export { tradingTools } from "./trading.ts";
export { marketAnalysisTools } from "./market-analysis.ts";
export { riskManagementTools } from "./risk-management.ts";
export { strategyTools } from "./strategies.ts";
export { metricsTools } from "./metrics.ts";

// ============================================================================
// Combined Tools Object
// ============================================================================

import { indicatorTools } from "./indicators.ts";
import { explainTools } from "./explain.ts";
import { marketTools } from "./market.ts";
import { positionTools } from "./positions.ts";
import { schedulerTools } from "./scheduler.ts";
import { systemTools } from "./system.ts";
import { earnTools } from "./earn.ts";
import { chartTools } from "./charts.ts";
import { orderbookTools } from "./orderbook.ts";
import { walletTools } from "./wallet.ts";
import { discoveryTools } from "./discovery.ts";
import { historyTools } from "./history.ts";
import { accountTools } from "./account.ts";
import { tradingTools } from "./trading.ts";
import { marketAnalysisTools } from "./market-analysis.ts";
import { riskManagementTools } from "./risk-management.ts";
import { strategyTools } from "./strategies.ts";
import { metricsTools } from "./metrics.ts";

/**
 * All tools combined as a single object for Mastra Agent
 */
export const allTools = {
  ...indicatorTools,
  ...explainTools,
  ...marketTools,
  ...positionTools,
  ...schedulerTools,
  ...systemTools,
  ...earnTools,
  ...chartTools,
  ...orderbookTools,
  ...walletTools,
  ...discoveryTools,
  ...historyTools,
  ...accountTools,
  ...tradingTools,
  ...marketAnalysisTools,
  ...riskManagementTools,
  ...strategyTools,
  ...metricsTools,
};

/**
 * Tool counts by category (useful for debugging)
 */
export const toolCounts = {
  indicators: Object.keys(indicatorTools).length,
  explain: Object.keys(explainTools).length,
  market: Object.keys(marketTools).length,
  positions: Object.keys(positionTools).length,
  scheduler: Object.keys(schedulerTools).length,
  system: Object.keys(systemTools).length,
  earn: Object.keys(earnTools).length,
  charts: Object.keys(chartTools).length,
  orderbook: Object.keys(orderbookTools).length,
  wallet: Object.keys(walletTools).length,
  discovery: Object.keys(discoveryTools).length,
  history: Object.keys(historyTools).length,
  account: Object.keys(accountTools).length,
  trading: Object.keys(tradingTools).length,
  marketAnalysis: Object.keys(marketAnalysisTools).length,
  riskManagement: Object.keys(riskManagementTools).length,
  strategies: Object.keys(strategyTools).length,
  metrics: Object.keys(metricsTools).length,
  total: Object.keys(allTools).length,
};
