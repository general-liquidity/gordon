/**
 * Candidate Producers — barrel + registration helper
 *
 * Single entry point for registering all producers with a ProactiveEngine
 * instance. The engine's CandidateProducer registry pattern means each
 * producer is independent — `registerAllProducers(engine)` wires up
 * everything we ship in v1, and returns an unregister function for
 * clean teardown.
 */

import type { ProactiveEngine } from "../proactiveEngine.ts";
import { tradeEventProducer, resetTradeEventProducerState } from "./tradeEventProducer.ts";
import { scanOpportunityProducer } from "./scanOpportunityProducer.ts";
import { riskProducer } from "./riskProducer.ts";
import { stopProducer } from "./stopProducer.ts";
import { periodicProducer, resetPeriodicProducerState } from "./periodicProducer.ts";
import { portfolioDriftProducer } from "./portfolioDriftProducer.ts";
import { regimeFlipProducer, resetRegimeFlipProducerState } from "./regimeFlipProducer.ts";
import { volatilitySpikeProducer, resetVolatilitySpikeProducerState } from "./volatilitySpikeProducer.ts";
import { fundingAlertProducer, resetFundingAlertProducerState } from "./fundingAlertProducer.ts";
import { newsEventProducer, resetNewsEventProducerState } from "./newsEventProducer.ts";
import { stockNewsEventProducer, resetStockNewsEventProducerState } from "./stockNewsEventProducer.ts";
import {
  earningsApproachingProducer,
  insiderFlowProducer,
  analystUpgradeProducer,
  congressionalTradeProducer,
  resetStockEventsProducerState,
} from "./stockEventsProducer.ts";
import { getProducerHealthTracker } from "../producerHealth.ts";
import type { CandidateProducer } from "../proactiveEngine.ts";
import type { ProactiveSuggestion } from "../types.ts";

export {
  tradeEventProducer,
  scanOpportunityProducer,
  riskProducer,
  stopProducer,
  periodicProducer,
  portfolioDriftProducer,
  regimeFlipProducer,
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
 * Wrap a producer with health tracking. Each call is recorded as a heartbeat
 * (with candidate count), errors are captured to last-error state, and the
 * wrapped producer preserves the original signature. Centralized so adding
 * a producer automatically gets health tracking.
 */
function withHealthTracking(name: string, producer: CandidateProducer): CandidateProducer {
  const tracker = getProducerHealthTracker();
  tracker.registerProducer(name);
  return async (obs): Promise<ProactiveSuggestion[]> => {
    try {
      const candidates = await producer(obs);
      tracker.recordHeartbeat(name, candidates.length);
      return candidates;
    } catch (err) {
      tracker.recordError(name, err instanceof Error ? err.message : String(err));
      throw err;
    }
  };
}

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
    resetVolatilitySpikeProducerState();
    resetFundingAlertProducerState();
    resetNewsEventProducerState();
    resetStockNewsEventProducerState();
    resetStockEventsProducerState();
    getProducerHealthTracker().stop();
  };
}
