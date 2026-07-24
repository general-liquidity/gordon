/**
 * Instrumented Tools
 *
 * All tools wrapped with metrics recording, exported as named constants
 * for use by individual agent definition files.
 *
 * Also re-exports the shared processor instances (gordonInputGuard, gordonOutputSanitizer).
 */

import { GordonInputGuard, GordonOutputSanitizer, GordonToolCallReconciler } from "../processors/index.ts";
import {
  askUserTools,
  indicatorTools,
  explainTools,
  marketTools,
  marketDataTools,
  positionTools,
  schedulerTools,
  systemTools,
  earnTools,
  chartTools,
  orderbookTools,
  walletTools,
  discoveryTools,
  historyTools,
  accountTools,
  tradingTools,
  marketAnalysisTools,
  riskManagementTools,
  strategyTools,
  strategyGenerationTools,
  metricsTools,
  compositionTools,
  backtestTools,
  sharedContextTools,
  parallelAnalysisTools,
  multiModalChartTools,
  liquidationIntelligenceTools,
  pairAnalysisTools,
  autonomousTools,
  xSocialTools,
  proactiveModeTools,
  backtestVerdictTools,
  finnhubTools,
  finnhubFundamentalsTools,
  finnhubMarketsTools,
  smcPatternTools,
  calibrationTools,
  skillLoaderTools,
  adherenceTools,
  quoteVerifyTools,
  diagnosticTools,
  microstructureTools,
  institutionalAiTools,
  producerHealthTools,
  newsTools,
  stockNewsTools,
  webTools,
  strategyRecipeTools,
  positionTrackingTools,
  checkRiskTool,
  memoryTools,
  selfHistoryTools,
  aceTools,
  agentFeedbackTools,
  playbookTools,
  playbookBacktestTools,
  auditTools,
  protocolTools,
  regimeTools,
  runtimeTools,
  advancedTools,
  systematicTools,
  withToolsMetrics,
  peerTools,
  recursiveDecomposeTools,
} from "../tools/index.ts";
import { agentTools } from "../tools/surface/index.ts";
import { tradingInfraTools } from "../tools/runtime/tradingInfra.ts";
import { evalTools } from "../../domain/evals/index.ts";
import { executionCostTools } from "../tools/trading/execution-cost.ts";
import { secFilingTools } from "../tools/providers/sec-filing-tools.ts";
// Binance Skills Hub + binance-cli moved to MCP marketplace listings —
// see src/infra/ai/mcp/marketplace/catalog.json (binance-cli, binance-
// skills-hub) and wrappers/{binance-cli-mcp,binance-skills-mcp}.

// Singleton processor instances (shared across all agents)
export const gordonInputGuard = new GordonInputGuard();
export const gordonOutputSanitizer = new GordonOutputSanitizer();
/**
 * FW1 — pre-turn tool-call reconciler. Wired into each agent's
 * inputProcessors array BEFORE gordonInputGuard so structural repair
 * happens before content guardrails see the messages.
 */
export const gordonToolCallReconciler = new GordonToolCallReconciler();

// Instrumented tool collections
export const instrumentedAskUserTools = withToolsMetrics(askUserTools);
export const instrumentedIndicatorTools = withToolsMetrics(indicatorTools);
export const instrumentedExplainTools = withToolsMetrics(explainTools);
export const instrumentedMarketTools = withToolsMetrics(marketTools);
export const instrumentedPositionTools = withToolsMetrics(positionTools);
export const instrumentedSchedulerTools = withToolsMetrics(schedulerTools);
export const instrumentedSystemTools = withToolsMetrics(systemTools);
export const instrumentedEarnTools = withToolsMetrics(earnTools);
export const instrumentedChartTools = withToolsMetrics(chartTools);
export const instrumentedOrderbookTools = withToolsMetrics(orderbookTools);
export const instrumentedWalletTools = withToolsMetrics(walletTools);
export const instrumentedDiscoveryTools = withToolsMetrics(discoveryTools);
export const instrumentedHistoryTools = withToolsMetrics(historyTools);
export const instrumentedAccountTools = withToolsMetrics(accountTools);
export const instrumentedTradingTools = withToolsMetrics(tradingTools);
export const instrumentedPeerTools = withToolsMetrics(peerTools);
export const instrumentedMarketAnalysisTools = withToolsMetrics(marketAnalysisTools);
export const instrumentedLiquidationIntelligenceTools = withToolsMetrics(liquidationIntelligenceTools);
export const instrumentedRiskManagementTools = withToolsMetrics(riskManagementTools);
export const instrumentedStrategyTools = withToolsMetrics(strategyTools);
export const instrumentedMetricsTools = withToolsMetrics(metricsTools);
export const instrumentedCompositionTools = withToolsMetrics(compositionTools);
export const instrumentedBacktestTools = withToolsMetrics(backtestTools);
export const instrumentedSharedContextTools = withToolsMetrics(sharedContextTools);
export const instrumentedParallelAnalysisTools = withToolsMetrics(parallelAnalysisTools);
export const instrumentedStrategyGenerationTools = withToolsMetrics(strategyGenerationTools);
export const instrumentedMultiModalChartTools = withToolsMetrics(multiModalChartTools);
export const instrumentedMarketDataTools = withToolsMetrics(marketDataTools);
export const instrumentedPairAnalysisTools = withToolsMetrics(pairAnalysisTools);
export const instrumentedAutonomousTools = withToolsMetrics(autonomousTools);
export const instrumentedXSocialTools = withToolsMetrics(xSocialTools);
export const instrumentedProactiveModeTools = withToolsMetrics(proactiveModeTools);
export const instrumentedBacktestVerdictTools = withToolsMetrics(backtestVerdictTools);
export const instrumentedFinnhubTools = withToolsMetrics(finnhubTools);
export const instrumentedFinnhubFundamentalsTools = withToolsMetrics(finnhubFundamentalsTools);
export const instrumentedSecFilingTools = withToolsMetrics(secFilingTools);
export const instrumentedFinnhubMarketsTools = withToolsMetrics(finnhubMarketsTools);
export const instrumentedSmcPatternTools = withToolsMetrics(smcPatternTools);
export const instrumentedCalibrationTools = withToolsMetrics(calibrationTools);
export const instrumentedSkillLoaderTools = withToolsMetrics(skillLoaderTools);
export const instrumentedAdherenceTools = withToolsMetrics(adherenceTools);
export const instrumentedQuoteVerifyTools = withToolsMetrics(quoteVerifyTools);
export const instrumentedDiagnosticTools = withToolsMetrics(diagnosticTools);
export const instrumentedMicrostructureTools = withToolsMetrics(microstructureTools);
export const instrumentedInstitutionalAiTools = withToolsMetrics(institutionalAiTools);
export const instrumentedProducerHealthTools = withToolsMetrics(producerHealthTools);
export const instrumentedNewsTools = withToolsMetrics(newsTools);
export const instrumentedStockNewsTools = withToolsMetrics(stockNewsTools);
/** Open-web reach (web_fetch / web_search). COLD TIER — register gated. */
export const instrumentedWebTools = withToolsMetrics(webTools);
export const instrumentedStrategyRecipeTools = withToolsMetrics(strategyRecipeTools);
export const instrumentedEvalTools = withToolsMetrics(evalTools);
export const instrumentedPositionTrackingTools = withToolsMetrics(positionTrackingTools);
export const instrumentedMemoryTools = withToolsMetrics(memoryTools);
/** Self-history recall (search_session_history). COLD TIER — register gated. */
export const instrumentedSelfHistoryTools = withToolsMetrics(selfHistoryTools);
export const instrumentedACETools = withToolsMetrics(aceTools);
export const instrumentedAgentFeedbackTools = withToolsMetrics(agentFeedbackTools);
export const instrumentedPlaybookTools = withToolsMetrics(playbookTools);
export const instrumentedPlaybookBacktestTools = withToolsMetrics(playbookBacktestTools);
export const instrumentedAuditTools = withToolsMetrics(auditTools);
export const instrumentedProtocolTools = withToolsMetrics(protocolTools);
export const instrumentedRegimeTools = withToolsMetrics(regimeTools);
export const instrumentedRuntimeTools = withToolsMetrics(runtimeTools);
export const instrumentedAdvancedTools = withToolsMetrics(advancedTools);
export const instrumentedSystematicTools = withToolsMetrics(systematicTools);
export const instrumentedCheckRiskTool = withToolsMetrics({ check_risk: checkRiskTool });
export const instrumentedExecutionCostTools = withToolsMetrics(executionCostTools);
/** Canonical 22-tool surface — must go through metrics + permission gate like implementation tools. */
export const instrumentedAgentTools = withToolsMetrics(agentTools);
export const instrumentedRecursiveDecomposeTools = withToolsMetrics(recursiveDecomposeTools);
export const instrumentedTradingInfraTools = withToolsMetrics(tradingInfraTools);
