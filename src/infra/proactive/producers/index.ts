/**
 * Candidate Producers — barrel + registration helper
 *
 * Single entry point for registering all producers with a ProactiveEngine
 * instance. The engine's CandidateProducer registry pattern means each
 * producer is independent — `registerAllProducers(engine)` wires up
 * everything we ship in v1, and returns an unregister function for
 * clean teardown.
 */

import type { ProactiveEngine } from "../engine/proactiveEngine.ts";
import { tradeEventProducer, resetTradeEventProducerState } from "./events/tradeEventProducer.ts";
import { scanOpportunityProducer } from "./signals/scanOpportunityProducer.ts";
import { riskProducer } from "./risk/riskProducer.ts";
import { stopProducer } from "./risk/stopProducer.ts";
import { periodicProducer, resetPeriodicProducerState } from "./periodicProducer.ts";
import { portfolioDriftProducer } from "./risk/portfolioDriftProducer.ts";
import { regimeFlipProducer, resetRegimeFlipProducerState } from "./signals/regimeFlipProducer.ts";
import { chartPatternProducer, resetChartPatternProducerState } from "./signals/chartPatternProducer.ts";
import { volatilitySpikeProducer, resetVolatilitySpikeProducerState } from "./signals/volatilitySpikeProducer.ts";
import { fundingAlertProducer, resetFundingAlertProducerState } from "./signals/fundingAlertProducer.ts";
import { newsEventProducer, resetNewsEventProducerState } from "./events/newsEventProducer.ts";
import { stockNewsEventProducer, resetStockNewsEventProducerState } from "./events/stockNewsEventProducer.ts";
import {
  earningsApproachingProducer,
  insiderFlowProducer,
  analystUpgradeProducer,
  congressionalTradeProducer,
  resetStockEventsProducerState,
} from "./events/stockEventsProducer.ts";
import { getProducerHealthTracker } from "../engine/producerHealth.ts";
import type { CandidateProducer } from "../engine/proactiveEngine.ts";
import type { ProactiveSuggestion } from "../types.ts";

export {
  tradeEventProducer,
  scanOpportunityProducer,
  riskProducer,
  stopProducer,
  periodicProducer,
  portfolioDriftProducer,
  regimeFlipProducer,
  chartPatternProducer,
  volatilitySpikeProducer,
  fundingAlertProducer,
  newsEventProducer,
  stockNewsEventProducer,
  earningsApproachingProducer,
  insiderFlowProducer,
  analystUpgradeProducer,
  congressionalTradeProducer,
};

/**
 * Per-producer wall-clock cap. One slow HTTP fetch (e.g. Finnhub stalling
 * on watchlist iteration) used to block the entire tick because the engine
 * awaits each producer sequentially. 15s lets normal RSS scans + multi-
 * symbol fetches complete; anything past that gets aborted so the next
 * producer can run.
 */
const PRODUCER_TIMEOUT_MS = 15_000;

function runWithTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`producer ${label} timed out after ${ms}ms`)),
      ms,
    );
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

/**
 * Wrap a producer with health tracking + a per-call wall-clock cap. Each
 * call is recorded as a heartbeat (with candidate count), errors AND
 * timeouts are captured to last-error state, and the wrapped producer
 * preserves the original signature. Centralized so adding a producer
 * automatically gets both health tracking and timeout protection.
 */
function withHealthTracking(name: string, producer: CandidateProducer): CandidateProducer {
  const tracker = getProducerHealthTracker();
  tracker.registerProducer(name);
  return async (obs): Promise<ProactiveSuggestion[]> => {
    try {
      const candidates = await runWithTimeout(
        Promise.resolve(producer(obs)),
        PRODUCER_TIMEOUT_MS,
        name,
      );
      tracker.recordHeartbeat(name, candidates.length);
      return candidates;
    } catch (err) {
      tracker.recordError(name, err instanceof Error ? err.message : String(err));
      throw err;
    }
  };
}

export { runWithTimeout, PRODUCER_TIMEOUT_MS };

/**
 * Register all v1 producers with the engine. Returns an unregister function
 * that removes all producers and resets their internal state.
 */
export function registerAllProducers(engine: ProactiveEngine): () => void {
  getProducerHealthTracker().start();

  const unregisterFns = [
    engine.registerProducer(withHealthTracking("tradeEvent", tradeEventProducer)),
    engine.registerProducer(withHealthTracking("scanOpportunity", scanOpportunityProducer)),
    engine.registerProducer(withHealthTracking("risk", riskProducer)),
    engine.registerProducer(withHealthTracking("stop", stopProducer)),
    engine.registerProducer(withHealthTracking("periodic", periodicProducer)),
    engine.registerProducer(withHealthTracking("portfolioDrift", portfolioDriftProducer)),
    engine.registerProducer(withHealthTracking("regimeFlip", regimeFlipProducer)),
    engine.registerProducer(withHealthTracking("chartPattern", chartPatternProducer)),
    engine.registerProducer(withHealthTracking("volatilitySpike", volatilitySpikeProducer)),
    engine.registerProducer(withHealthTracking("fundingAlert", fundingAlertProducer)),
    engine.registerProducer(withHealthTracking("newsEvent", newsEventProducer)),
    engine.registerProducer(withHealthTracking("stockNewsEvent", stockNewsEventProducer)),
    engine.registerProducer(withHealthTracking("earningsApproaching", earningsApproachingProducer)),
    engine.registerProducer(withHealthTracking("insiderFlow", insiderFlowProducer)),
    engine.registerProducer(withHealthTracking("analystUpgrade", analystUpgradeProducer)),
    engine.registerProducer(withHealthTracking("congressionalTrade", congressionalTradeProducer)),
  ];

  return () => {
    for (const fn of unregisterFns) fn();
    resetTradeEventProducerState();
    resetPeriodicProducerState();
    resetRegimeFlipProducerState();
    resetChartPatternProducerState();
    resetVolatilitySpikeProducerState();
    resetFundingAlertProducerState();
    resetNewsEventProducerState();
    resetStockNewsEventProducerState();
    resetStockEventsProducerState();
    getProducerHealthTracker().stop();
  };
}
