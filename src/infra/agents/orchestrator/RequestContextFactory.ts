import { RequestContext } from "@mastra/core/request-context";
import type { GordonContext } from "../types.ts";
import { determineWorkflowPhase } from "../workflowPhase.ts";
import { getExecutionReadiness } from "../runtimeHarness.ts";

export function createAgentRequestContext(
  context: GordonContext,
  compiledSubagentProfiles: Record<string, unknown>,
): RequestContext {
  const requestContext = new RequestContext();
  const workflowPhase = determineWorkflowPhase(context);
  const executionReadiness = getExecutionReadiness(context);
  requestContext.set("binance", context.binance);
  requestContext.set("exchange", context.exchange);
  requestContext.set("broker", context.broker);
  requestContext.set("agentRails", context.agentRails);
  requestContext.set("config", context.config);
  requestContext.set("llm", context.llm);
  requestContext.set("userId", context.userId || "default");
  requestContext.set("threadId", context.threadId || "");
  requestContext.set("portfolioValue", context.portfolioValue || 0);
  requestContext.set("availableCash", context.availableCash || 0);
  requestContext.set("requestedActionId", context.requestedActionId);
  requestContext.set("requestedTaskScope", context.requestedTaskScope);
  requestContext.set("credentialProfile", context.credentialProfile ?? "default");
  requestContext.set("workflowPhase", workflowPhase);
  requestContext.set("executionReadiness", executionReadiness);
  requestContext.set("compiledSubagentProfiles", compiledSubagentProfiles);
  return requestContext;
}
