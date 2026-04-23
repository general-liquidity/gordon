import type { GordonContext } from "../../infra/agents/types.ts";
import type { StreamEvent } from "../../infra/agents/orchestrator.ts";

export type RuntimePermissionScope =
  | "market.read"
  | "analysis.run"
  | "portfolio.read"
  | "papertrade.execute"
  | "livetrade.execute"
  | "transfer.execute"
  | "wallet.write"
  | "system.mode.write"
  | "runtime.background.write"
  | "plugin.install"
  | "mcp.connect";

export type RuntimeApprovalClass =
  | "none"
  | "session"
  | "per_action"
  | "per_tool"
  | "always_require_human";

export type RuntimeRiskClass = "low" | "medium" | "high" | "critical";

export type RuntimeSideEffectLevel = "none" | "read" | "write" | "execution";

export type RuntimeToolCategory =
  | "market"
  | "analysis"
  | "planning"
  | "execution"
  | "monitoring"
  | "portfolio"
  | "wallet"
  | "system"
  | "education"
  | "backtest"
  | "runtime"
  | "unknown";

export type RuntimeWorkerRole =
  | "Gordon"
  | "Scanner"
  | "Analyst"
  | "Planner"
  | "Executor"
  | "Monitor"
  | "Teacher"
  | "Backtester"
  | "Critic"
  | "Auditor";

export type RuntimeToolSource = "builtin" | "mcp" | "plugin" | "dynamic";

export interface RuntimeSessionContext {
  runtimeId: string;
  sessionId?: string;
  resourceId?: string;
  threadId?: string;
}

export interface RuntimeSessionSnapshot {
  resourceId: string;
  threadId: string | null;
  threadStartedAt: string | null;
  lastActiveAt: string;
  sessionCount: number;
}

export interface RuntimeToolSpec {
  id: string;
  category: RuntimeToolCategory;
  riskClass: RuntimeRiskClass;
  permissionScope: RuntimePermissionScope;
  sideEffectLevel: RuntimeSideEffectLevel;
  requiresTradePermission: boolean;
  supportsStreaming: boolean;
  supportsBackground: boolean;
  idempotent: boolean;
  workerRole: RuntimeWorkerRole;
  auditEventType: string;
  origin?: RuntimeToolSource;
  pluginId?: string;
  serverId?: string;
  displayName?: string;
}

export interface RuntimeWorkerDefinition {
  name: RuntimeWorkerRole;
  description: string;
  handoffTargets: RuntimeWorkerRole[];
  defaultScopes: RuntimePermissionScope[];
}

export type RuntimeTranscriptRole = "user" | "assistant" | "system" | "tool" | "agent";

export interface RuntimeTranscriptEntry {
  id: string;
  timestamp: string;
  role: RuntimeTranscriptRole;
  content: string;
  metadata?: Record<string, unknown>;
}

export interface RuntimePluginSummary {
  id: string;
  name: string;
  enabled: boolean;
  category?: string;
  version?: string;
  status?: "ready" | "disabled" | "degraded";
  lifecycle?: "mcp" | "routed";
  toolCount?: number;
  commandCount?: number;
  surfacedCommandCount?: number;
  integrationCommands?: string[];
  defaultAgent?: string;
  alsoOnGordon?: boolean;
  routedToolCount?: number;
  reloadRecommended?: boolean;
  attentionLevel?: "none" | "info" | "warning";
  attentionReasons?: string[];
  lastReloadAt?: string | null;
}

export interface RuntimeMcpServerSummary {
  id: string;
  name: string;
  category: string;
  toolCount: number | null;
}

export interface RuntimeToolSummary {
  id: string;
  origin: RuntimeToolSource;
  pluginId?: string;
  serverId?: string;
  displayName?: string;
  routedToAgent?: string;
  exposedOnGordon?: boolean;
}

export interface RuntimeToolingState {
  lastSyncedAt: string | null;
  lastReloadAt: string | null;
  hotReloadEnabled: boolean;
  routingCount: number;
  plugins: RuntimePluginSummary[];
  mcpServers: RuntimeMcpServerSummary[];
  tools: RuntimeToolSummary[];
  commands: string[];
}

export type RuntimeRemoteConnectionStatus =
  | "offline"
  | "connecting"
  | "connected"
  | "degraded";

export interface RuntimeRemoteState {
  connectionStatus: RuntimeRemoteConnectionStatus;
  reachable: boolean;
  actor?: string;
  detail?: string;
  updatedAt: string | null;
}

export interface RuntimeApprovalRequest {
  id: string;
  toolName: string;
  permissionScope: RuntimePermissionScope;
  approvalClass: RuntimeApprovalClass;
  riskClass: RuntimeRiskClass;
  sideEffectLevel: RuntimeSideEffectLevel;
  runtimeId: string;
  sessionId?: string;
  resourceId?: string;
  threadId?: string;
  fingerprint: string;
  status: "pending" | "approved" | "denied" | "expired";
  reason?: string;
  actor?: string;
  decisionSource?: "human" | "rule" | "classifier" | "hook";
  requestedAt: string;
  decidedAt?: string;
}

export interface RuntimeApprovalRule {
  id: string;
  toolName?: string;
  /**
   * Glob pattern that matches tool IDs. Supports `*` as a multi-char wildcard
   * and `?` as a single-char wildcard. Specific `toolName` matches always win
   * over pattern matches; among equally-specific rules, the most recently
   * created rule wins. Example: `"kraken_*"`, `"mcp_research_*"`.
   */
  toolNamePattern?: string;
  permissionScope?: RuntimePermissionScope;
  decision: "allow" | "deny";
  scope: "session" | "persistent";
  createdAt: string;
  createdBy: string;
  expiresAt?: string | null;
}

export interface RuntimeApprovalState {
  pending: RuntimeApprovalRequest[];
  recent: RuntimeApprovalRequest[];
  rules: RuntimeApprovalRule[];
  lastUpdatedAt: string | null;
}

export interface RuntimeBridgeSession {
  id: string;
  runtimeId: string;
  sessionId?: string;
  source: string;
  commandType: string;
  correlationId?: string;
  requestId?: string;
  status: "active" | "completed" | "failed";
  startedAt: string;
  updatedAt: string;
  detail?: string;
}

export interface RuntimeBridgeState {
  active: RuntimeBridgeSession[];
  recent: RuntimeBridgeSession[];
  lastUpdatedAt: string | null;
}

export interface RuntimeHistoryResult {
  runtimeId: string;
  source: "transcript" | "scratchpad" | "handoff" | "bridge" | "approval";
  entryId: string;
  role?: RuntimeTranscriptRole;
  worker?: string;
  timestamp: string;
  content: string;
  metadata?: Record<string, unknown>;
}

export interface RuntimeHistorySessionSummary {
  runtimeId: string;
  sessionId?: string;
  threadId?: string | null;
  resourceId?: string | null;
  savedAt: string;
  transcriptEntryCount: number;
  lastUserMessage?: string;
  lastAssistantMessage?: string;
}

export interface RuntimeResolveContextOptions {
  session: RuntimeSessionContext;
  contextOverride?: GordonContext;
}

export interface RuntimeQueryExecutionOptions {
  contextOverride?: GordonContext;
  signal?: AbortSignal;
  sessionId?: string;
  threadId?: string;
  resourceId?: string;
}

export type RuntimeStreamEvent = StreamEvent;
