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
  gordonAgent,
  getAllAgents,
  resetAgents,
} from "./agents.ts";

// Response Schemas (Mastra structuredOutput)
export {
  TradeSignalSchema,
  MarketScanResultSchema,
  AnalysisResultSchema,
  PortfolioStatusSchema,
  AgentDecisionSchema,
  getSchemaByName,
  RESPONSE_SCHEMAS,
} from "./schemas/index.ts";
export type {
  TradeSignal,
  MarketScanResult,
  AnalysisResult,
  PortfolioStatus,
  AgentDecision,
} from "./schemas/index.ts";

// Native Processors (Mastra guardrails)
export { GordonInputGuard, GordonOutputSanitizer } from "./processors/index.ts";

// Main Orchestrator
export {
  processMessage,
  processSimpleMessage,
  processMessageStream,
  processStructuredMessage,
  quickScan,
  quickCheckPositions,
  initializeTracing,
  // Summarization
  summarizeIfNeeded,
  needsSummarization,
  getSummarizationStats,
  resetSummarizer,
  // Streaming with Pipe Support (Mastra pipeTo pattern)
  processMessageStreamWithPipe,
  createMessageStreamWorkflow,
  // Streaming workflow utilities
  createStreamingWorkflow,
  streamParallelAnalysis,
  streamMultiCoinAnalysis,
  createStreamingDeepAnalysis,
  createStreamingMultiCoinAnalysis,
  // Stream writers
  createConsoleWriter,
  createArrayWriter,
  createCallbackWriter,
  createMultiplexWriter,
  createTransformWriter,
  ConsoleStreamWriter,
  ArrayStreamWriter,
  CallbackStreamWriter,
  MultiplexStreamWriter,
  TransformStreamWriter,
  // Chunk factories
  createChunk,
  createProgressChunk,
  createResultChunk,
  createErrorChunk,
  createStartChunk,
  createEndChunk,
  createHeartbeatChunk,
  createStreamingPipeline,
} from "./orchestrator.ts";
export type {
  StreamEvent,
  ProcessingOptions,
  ProcessingResultWithSummarization,
  MessageStreamChunk,
  // Streaming types
  StreamWriter,
  StreamChunk,
  StreamingWorkflowOptions,
  ProgressData,
  ResultData,
  AnalysisChunk,
  StreamingResult,
  StreamingWorkflowResult,
  StreamingParallelOptions,
} from "./orchestrator.ts";

// Guardrails Middleware
export {
  checkInputGuardrails,
  checkOutputGuardrails,
  validateTrade,
  validateRiskReward,
  withGuardrails,
} from "./middleware/index.ts";

// Memory (Mastra integration)
export {
  createMemoryStore,
  createMemoryOptions,
  generateThreadId,
  getMemory,
  resetMemory,
} from "./memory.ts";

// Thread Management (for "what if" scenario branching)
export {
  cloneThread,
  listThreads,
  deleteThread,
  getThreadInfo,
  switchThread,
  updateThreadLabel,
  ensureThreadRegistered,
} from "./threadManager.ts";
export type {
  ThreadInfo,
  CloneResult,
  SwitchResult,
} from "./threadManager.ts";

// Memory Summarization
export {
  ConversationSummarizer,
  createSummarizer,
  createSummarizerConfigFromMemoryConfig,
  DEFAULT_SUMMARIZER_CONFIG,
} from "../memory/index.ts";
export type {
  SummarizerConfig,
  TradingContext,
  SummarizationResult,
} from "../memory/index.ts";

// MCP Plugin Integration (@mastra/mcp)
export {
  initMCPTools,
  getMCPTools,
  getMCPToolsByServer,
  disconnectMCP,
  isMCPInitialized,
  getMCPStats,
} from "../mcp/client.ts";

// Reflection
export {
  reflectOnPlan,
  reflectOnPlanRules,
  reflectOnPlanWithLLM,
  reflectOnAnalysis,
  reflectWithLLM,
  quickValidatePlan,
  formatReflectionSummary,
} from "./reflection.ts";
export type { ReflectionResult, ReflectionOptions } from "./reflection.ts";
