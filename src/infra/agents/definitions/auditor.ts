/**
 * Auditor Agent Definition
 * Inspects what Gordon did, why it did it, and whether the runtime and approval trail support the action.
 */

import { Agent } from "@mastra/core/agent";
import { TokenLimiterProcessor } from "@mastra/core/processors";
import { composeAgentInstructions } from "../promptSections.ts";
import { getRoutingToolsForAgent } from "../../routing/manager.ts";
import {
  instrumentedAuditTools,
  instrumentedRuntimeTools,
  instrumentedHistoryTools,
  instrumentedAccountTools,
  instrumentedWalletTools,
  instrumentedMetricsTools,
  instrumentedMemoryTools,
  instrumentedSharedContextTools,
  instrumentedAdvancedTools,
  instrumentedAutonomousTools,
  instrumentedPositionTrackingTools,
  instrumentedEvalTools,
  gordonInputGuard,
  gordonOutputSanitizer,
} from "../instrumentedTools.ts";
import { createSubAgentMemory } from "../memoryFactory.ts";
import { resolveRuntimeModel, registerObservability } from "../agentHelpers.ts";

const AUDITOR_INSTRUCTIONS = `You are Gordon's runtime auditor agent.

Your role is to inspect what Gordon did, why it did it, and whether the runtime and approval trail support the action.

## Your Capabilities
- Review runtime state, approvals, bridge ingress, and background activity
- Inspect audit chain history for traceability and policy compliance
- Verify that positions, orders, transfers, and strategy actions match the recorded plan
- Summarize operational risk, drift, or missing provenance

## What To Prioritize
1. Whether the action had the right approval state
2. Whether runtime and audit history agree on what happened
3. Whether portfolio state, orders, and balance changes are internally consistent
4. Whether Gordon is operating outside the intended scope or venue

## Available Tools
- Audit chain: query_audit_trail, get_decision_path, get_agent_activity, get_audit_stats
- Runtime state: get_portfolio_state, check_portfolio_health, generate_circuit_breaker_proof
- Portfolio and account state: account, wallet, history, metrics, active position tracking
- Shared context and memory: read_shared_context, search_memory, get_lessons

## Operating Style
- Be precise and evidence-first.
- Prefer verifiable traces over narrative explanations.
- If the record is incomplete, say exactly what is missing.`;

export function getAuditor(): Agent {
  const agent = new Agent({
    id: "auditor",
    name: "Auditor",
    description:
      "Specialist in runtime traceability, approvals, audit review, and operational correctness. " +
      "Use when the user wants to inspect what happened, validate policy compliance, or review the runtime record.",
    instructions: composeAgentInstructions("auditor", AUDITOR_INSTRUCTIONS),
    model: resolveRuntimeModel,
    tools: {
      ...instrumentedAuditTools,
      ...instrumentedRuntimeTools,
      ...instrumentedHistoryTools,
      ...instrumentedAccountTools,
      ...instrumentedWalletTools,
      ...instrumentedMetricsTools,
      ...instrumentedMemoryTools,
      ...instrumentedSharedContextTools,
      ...instrumentedAdvancedTools,
      get_autonomous_status: instrumentedAutonomousTools.get_autonomous_status,
      list_active_positions: instrumentedPositionTrackingTools.list_active_positions,
      get_position_detail: instrumentedPositionTrackingTools.get_position_detail,
      get_performance_report: instrumentedEvalTools.get_performance_report,
      ...getRoutingToolsForAgent("Auditor"),
    },
    memory: createSubAgentMemory(),
    inputProcessors: [gordonInputGuard, new TokenLimiterProcessor({ limit: 32000 })],
    outputProcessors: [gordonOutputSanitizer],
  });
  registerObservability(agent);
  return agent;
}
