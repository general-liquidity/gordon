/**
 * Agent Consensus Protocol
 *
 * Multi-factor trade evaluation with weighted scoring from
 * five perspectives: risk, regime, portfolio, technical, and historical.
 */

export { evaluateConsensus } from "./protocol.ts";
export type {
  TradeProposal,
  VoteDecision,
  AgentVote,
  ConsensusResult,
} from "./protocol.ts";

export {
  saveConsensusResult,
  queryConsensusResults,
  getConsensusStats,
} from "./store.ts";
export type { ConsensusQuery } from "./store.ts";
