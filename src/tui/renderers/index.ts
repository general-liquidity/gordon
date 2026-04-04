/**
 * Renderer Registry -- Maps renderer names to components
 * Phase 10: Central index for all structured output renderers.
 */

export { ScanResultRenderer } from "./ScanResultRenderer.js";
export { AnalysisRenderer } from "./AnalysisRenderer.js";
export { PlanRenderer } from "./PlanRenderer.js";
export { PositionRenderer } from "./PositionRenderer.js";
export { BacktestRenderer } from "./BacktestRenderer.js";
export { OrderBookRenderer } from "./OrderBookRenderer.js";
export { DoctorRenderer } from "./DoctorRenderer.js";
export { HelpRenderer } from "./HelpRenderer.js";
export { StrategyRenderer } from "./StrategyRenderer.js";
export { RiskRenderer } from "./RiskRenderer.js";
export { MarketAnalysisRenderer } from "./MarketAnalysisRenderer.js";
export { IndicatorRenderer } from "./IndicatorRenderer.js";
export { LiquidationRenderer } from "./LiquidationRenderer.js";
export { YieldRenderer } from "./YieldRenderer.js";
export { SECFilingRenderer } from "./SECFilingRenderer.js";
export { NewsRenderer } from "./NewsRenderer.js";
export { EnrichedQuoteRenderer } from "./EnrichedQuoteRenderer.js";

// ============================================================================
// Registry -- name -> renderer component mapping
// ============================================================================

import { ScanResultRenderer } from "./ScanResultRenderer.js";
import { AnalysisRenderer } from "./AnalysisRenderer.js";
import { PlanRenderer } from "./PlanRenderer.js";
import { PositionRenderer } from "./PositionRenderer.js";
import { BacktestRenderer } from "./BacktestRenderer.js";
import { OrderBookRenderer } from "./OrderBookRenderer.js";
import { DoctorRenderer } from "./DoctorRenderer.js";
import { HelpRenderer } from "./HelpRenderer.js";
import { StrategyRenderer } from "./StrategyRenderer.js";
import { RiskRenderer } from "./RiskRenderer.js";
import { MarketAnalysisRenderer } from "./MarketAnalysisRenderer.js";
import { IndicatorRenderer } from "./IndicatorRenderer.js";
import { LiquidationRenderer } from "./LiquidationRenderer.js";
import { YieldRenderer } from "./YieldRenderer.js";
import { SECFilingRenderer } from "./SECFilingRenderer.js";
import { NewsRenderer } from "./NewsRenderer.js";
import { EnrichedQuoteRenderer } from "./EnrichedQuoteRenderer.js";

import type { ComponentType } from "react";

/**
 * Registry of named renderers.
 * Use `getRenderer(name)` to look up a renderer by its identifier.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const RENDERER_REGISTRY: Record<string, ComponentType<any>> = {
  scan: ScanResultRenderer,
  analysis: AnalysisRenderer,
  plan: PlanRenderer,
  position: PositionRenderer,
  backtest: BacktestRenderer,
  orderbook: OrderBookRenderer,
  doctor: DoctorRenderer,
  help: HelpRenderer,
  strategy: StrategyRenderer,
  risk: RiskRenderer,
  marketanalysis: MarketAnalysisRenderer,
  indicator: IndicatorRenderer,
  liquidation: LiquidationRenderer,
  yield: YieldRenderer,
  secfiling: SECFilingRenderer,
  news: NewsRenderer,
  enrichedquote: EnrichedQuoteRenderer,
};

/**
 * Look up a renderer component by name.
 * Returns undefined if no renderer is registered for that name.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getRenderer(name: string): ComponentType<any> | undefined {
  return RENDERER_REGISTRY[name.toLowerCase()];
}

/**
 * Get all registered renderer names.
 */
export function getRendererNames(): string[] {
  return Object.keys(RENDERER_REGISTRY);
}
