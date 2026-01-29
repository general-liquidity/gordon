/**
 * Gordon Agent Infrastructure
 * OpenAI Agents SDK integration for agentic trading
 */

// Types
export type {
  GordonContext,
  ScanToolResult,
  AnalyzeToolResult,
  PlanToolResult,
  ExecuteToolResult,
  MonitorToolResult,
  ExplainToolResult,
} from "./types.ts";

// Tools
export {
  scanMarketTool,
  analyzeCoinTool,
  createPlanTool,
  executePlanTool,
  checkPositionsTool,
  closeTradeTool,
  explainTool,
  armSystemTool,
  getPortfolioTool,
  listPlansTool,
  approvePlanTool,
  testConnectionTool,
  getAccountDetailsTool,
  getTradeHistoryTool,
  getTransferHistoryTool,
  getEarnPositionsTool,
  allTools,
  toolCounts,
} from "./tools/index.ts";

// Specialized Agents
export {
  scannerAgent,
  analystAgent,
  plannerAgent,
  executorAgent,
  monitorAgent,
  teacherAgent,
  allAgents,
} from "./agents.ts";

// Main Orchestrator
export {
  gordonAgent,
  processMessage,
  processMessageStream,
  quickScan,
  quickCheckPositions,
  initializeTracing,
} from "./orchestrator.ts";
export type { StreamEvent } from "./orchestrator.ts";

// Guardrails
export { inputGuardrails, outputGuardrails } from "./guardrails.ts";

// Agent Hooks
export { setupAgentHooks } from "./agents.ts";
