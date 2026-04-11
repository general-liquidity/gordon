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

export {
  tradeEventProducer,
  scanOpportunityProducer,
  riskProducer,
  stopProducer,
  periodicProducer,
};

/**
 * Register all v1 producers with the engine. Returns an unregister function
 * that removes all producers and resets their internal state.
 */
export function registerAllProducers(engine: ProactiveEngine): () => void {
  const unregisterFns = [
    engine.registerProducer(tradeEventProducer),
    engine.registerProducer(scanOpportunityProducer),
    engine.registerProducer(riskProducer),
    engine.registerProducer(stopProducer),
    engine.registerProducer(periodicProducer),
  ];

  return () => {
    for (const fn of unregisterFns) fn();
    resetTradeEventProducerState();
    resetPeriodicProducerState();
  };
}
