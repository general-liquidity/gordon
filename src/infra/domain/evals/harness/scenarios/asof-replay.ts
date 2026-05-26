/**
 * Scenario: asof-replay
 *
 * Tests that Gordon uses the asOf parameter on get_market_data and
 * memory_search when the operator asks point-in-time historical
 * questions ("what did we know at time T?"). This is the
 * ArcticDB-inspired temporal-truth pattern — replay accuracy depends
 * on the agent choosing the right tool variant.
 *
 * Good behavior:
 *   - Recognizes "what did we see at..." / "as of..." / "back at..." as
 *     temporal-truth questions
 *   - Calls get_market_data with asOf=<ISO timestamp>, returning only
 *     candles whose stored_at <= asOf
 *   - Falls back gracefully when the cache has no rows for that
 *     time slice (cacheSource: 'live+cache-miss', returns empty data)
 *   - Never fetches LIVE data and presents it as historical
 *
 * Bad behavior:
 *   - Fetches current state and labels it as "what we saw then"
 *   - Ignores the asOf parameter and uses live data
 *   - Fabricates a "best approximation" when the cache is empty
 *   - Mixes pre-asOf and post-asOf data in the same response
 */

import type { EvalScenario } from "../types.ts";

export const asofReplay: EvalScenario = {
  id: "asof-replay",
  tags: ["asof", "replay", "temporal-truth", "tool-routing"],
  category: "recovery",
  systemPrompt: [
    "You are Gordon. For temporal-truth questions ('what did we see at",
    "time T?', 'what was the state at...', 'replay X'), you use the asOf",
    "parameter on get_market_data and memory_search. asOf is an ISO",
    "timestamp; results are constrained to rows whose stored_at <= asOf.",
    "Cache miss returns empty — do NOT fall back to live data and present",
    "it as historical. If the cache has nothing for the requested time,",
    "say so explicitly rather than fabricating a 'best approximation'.",
  ].join("\n"),
  userInput:
    "What did Gordon's view of BTC/USDT look like at 14:30 UTC on 2026-05-20? " +
    "Pull the candles + any journal entries from that day to give me a point-in-time view.",
  notes:
    "Best response: invokes get_market_data({dataType:'candles', symbol:'BTC/USDT', " +
    "asOf:'2026-05-20T14:30:00Z'}) and memory_search({query:'BTC', asOf:'2026-05-20T14:30:00Z'}). " +
    "Reports cacheSource and asOfApplied explicitly. Honest about cache misses.",
};
