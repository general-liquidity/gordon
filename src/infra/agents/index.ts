/**
 * Gordon Agent Infrastructure
 * Mastra-based multi-agent system for agentic trading
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

// Tools (Mastra format - exported as objects)
export {
  indicatorTools,
  explainTools,
  marketTools,
  positionTools,
  schedulerTools,
  systemTools,
  earnTools,
  chartTools,
  orderbookTools,
  walletTools,
  discoveryTools,
  historyTools,
  accountTools,
  tradingTools,
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
  processSimpleMessage,
  processMessageStream,
  quickScan,
  quickCheckPositions,
  initializeTracing,
} from "./orchestrator.ts";
export type { StreamEvent } from "./orchestrator.ts";

// Guardrails Middleware
export {
  checkInputGuardrails,
  checkOutputGuardrails,
  validateTrade,
  validateRiskReward,
  withGuardrails,
} from "./middleware/index.ts";

// Memory
export {
  createMemoryStore,
  createMemoryOptions,
  generateThreadId,
  getMemory,
  resetMemory,
} from "./memory.ts";
