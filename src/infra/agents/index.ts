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
  allTools,
} from "./tools.ts";

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
} from "./orchestrator.ts";
