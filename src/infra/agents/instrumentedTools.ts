/**
 * Instrumented Tools
 *
 * All tools wrapped with metrics recording, exported as named constants
 * for use by individual agent definition files.
 *
 * Also re-exports the shared processor instances (gordonInputGuard, gordonOutputSanitizer).
 */

import { GordonInputGuard, GordonOutputSanitizer } from "./processors/index.ts";
import {
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
  baseOnchainTools,
  agentKitOnchainTools,
  agentKitDefiTools,
  polkadotKitAssetTools,
  polkadotKitStakingTools,
  polkadotKitDefiTools,
  solanaKitWalletTools,
  solanaKitTradingTools,
  solanaKitDefiPerpsTools,
  solanaKitDefiLendingTools,
  solanaKitDefiPoolsTools,
  solanaKitDefiBridgeTools,
  chainlinkStreamsTools,
  chainlinkFeedsTools,
  chainlinkCCIPTools,
  synthDataTools,
  baseSignalTools,
  baseIndexerTools,
  uniswapDataTools,
  dexSearchTools,
  xSocialTools,
  cdpWebhookTools,
  cdpSqlTools,
  cdpPolicyTools,
  cdpOnrampTools,
  cdpEvmMultichainTools,
  cdpWebhookReceiverTools,
  proactiveModeTools,
  backtestVerdictTools,
  defillamaYieldTools,
  positionTrackingTools,
  checkRiskTool,
  memoryTools,
  playbookTools,
  playbookBacktestTools,
  auditTools,
  protocolTools,
  regimeTools,
  runtimeTools,
  advancedTools,
  systematicTools,
  withToolsMetrics,
} from "./tools/index.ts";
import { evalTools } from "../domain/evals/index.ts";

// Singleton processor instances (shared across all agents)
export const gordonInputGuard = new GordonInputGuard();
export const gordonOutputSanitizer = new GordonOutputSanitizer();

// Instrumented tool collections
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
export const instrumentedBaseOnchainTools = withToolsMetrics(baseOnchainTools);
export const instrumentedAgentKitOnchainTools = withToolsMetrics(agentKitOnchainTools);
export const instrumentedAgentKitDefiTools = withToolsMetrics(agentKitDefiTools);
export const instrumentedPolkadotKitAssetTools = withToolsMetrics(polkadotKitAssetTools);
export const instrumentedPolkadotKitStakingTools = withToolsMetrics(polkadotKitStakingTools);
export const instrumentedPolkadotKitDefiTools = withToolsMetrics(polkadotKitDefiTools);
export const instrumentedSolanaKitWalletTools = withToolsMetrics(solanaKitWalletTools);
export const instrumentedSolanaKitTradingTools = withToolsMetrics(solanaKitTradingTools);
export const instrumentedSolanaKitDefiPerpsTools = withToolsMetrics(solanaKitDefiPerpsTools);
export const instrumentedSolanaKitDefiLendingTools = withToolsMetrics(solanaKitDefiLendingTools);
export const instrumentedSolanaKitDefiPoolsTools = withToolsMetrics(solanaKitDefiPoolsTools);
export const instrumentedSolanaKitDefiBridgeTools = withToolsMetrics(solanaKitDefiBridgeTools);
export const instrumentedChainlinkStreamsTools = withToolsMetrics(chainlinkStreamsTools);
export const instrumentedChainlinkFeedsTools = withToolsMetrics(chainlinkFeedsTools);
export const instrumentedChainlinkCCIPTools = withToolsMetrics(chainlinkCCIPTools);
export const instrumentedSynthDataTools = withToolsMetrics(synthDataTools);
export const instrumentedBaseSignalTools = withToolsMetrics(baseSignalTools);
export const instrumentedBaseIndexerTools = withToolsMetrics(baseIndexerTools);
export const instrumentedUniswapDataTools = withToolsMetrics(uniswapDataTools);
export const instrumentedDexSearchTools = withToolsMetrics(dexSearchTools);
export const instrumentedXSocialTools = withToolsMetrics(xSocialTools);
export const instrumentedCdpWebhookTools = withToolsMetrics(cdpWebhookTools);
export const instrumentedCdpSqlTools = withToolsMetrics(cdpSqlTools);
export const instrumentedCdpPolicyTools = withToolsMetrics(cdpPolicyTools);
export const instrumentedCdpOnrampTools = withToolsMetrics(cdpOnrampTools);
export const instrumentedCdpEvmMultichainTools = withToolsMetrics(cdpEvmMultichainTools);
export const instrumentedCdpWebhookReceiverTools = withToolsMetrics(cdpWebhookReceiverTools);
export const instrumentedProactiveModeTools = withToolsMetrics(proactiveModeTools);
export const instrumentedBacktestVerdictTools = withToolsMetrics(backtestVerdictTools);
export const instrumentedDefillamaYieldTools = withToolsMetrics(defillamaYieldTools);
export const instrumentedEvalTools = withToolsMetrics(evalTools);
export const instrumentedPositionTrackingTools = withToolsMetrics(positionTrackingTools);
export const instrumentedMemoryTools = withToolsMetrics(memoryTools);
export const instrumentedPlaybookTools = withToolsMetrics(playbookTools);
export const instrumentedPlaybookBacktestTools = withToolsMetrics(playbookBacktestTools);
export const instrumentedAuditTools = withToolsMetrics(auditTools);
export const instrumentedProtocolTools = withToolsMetrics(protocolTools);
export const instrumentedRegimeTools = withToolsMetrics(regimeTools);
export const instrumentedRuntimeTools = withToolsMetrics(runtimeTools);
export const instrumentedAdvancedTools = withToolsMetrics(advancedTools);
export const instrumentedSystematicTools = withToolsMetrics(systematicTools);
export const instrumentedCheckRiskTool = withToolsMetrics({ check_risk: checkRiskTool });
