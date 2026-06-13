/**
 * Edge-Driven Development (EDD) — the trading-native analogue of Spec-Driven
 * Development. An EDGE.md is the falsifiable unit (the "spec"); realized alpha is
 * the shipped output. Unlike a code spec, an edge decays, so the same conditions
 * that gate the backtest stay wired as a LIVE monitor and retire the edge when it
 * stops being true.
 *
 * Pure core: parsing + invariant evaluation, no I/O. The composition with the
 * statistical decay monitor lives at infra/trading/ops/edgeStatus.ts.
 */

export * from "./types.ts";
export { parseEdgeSpec } from "./parser.ts";
export {
  type EdgeMetrics,
  composeHealth,
  evaluateCondition,
  evaluateEdgeInvariants,
} from "./monitor.ts";
