/**
 * Gordon Agents
 * Multi-agent orchestration using Mastra's Agent Networks
 *
 * Architecture:
 * - Agent class from @mastra/core for LLM-powered agents
 * - Sub-agents via `agents` object for network routing
 * - Tools as objects: { tool_id: toolInstance }
 * - .network() method for multi-agent orchestration
 * - Memory integration with LibSQL for task tracking
 *
 * IMPORTANT: Agents are lazily initialized to ensure environment
 * variables are loaded before the provider registry is accessed.
 *
 * Memory Management:
 * - Configurable lastMessages via config
 * - Session duration tracking with auto-clear
 * - Memory usage warnings when approaching limits
 *
 * Agent definitions have been extracted to per-agent files in ./definitions/.
 * This file retains shared state (memory config, session management, helpers)
 * and re-exports agent accessors for backward compatibility.
 */

import { Agent } from "@mastra/core/agent";
import { createModuleLogger } from "../logger/logger.ts";
import { getMemoryStats, resetSharedMemory } from "./shared-context.ts";
import { resetSubAgentMemory } from "./memoryFactory.ts";
import {
  getScanner,
  getAnalyst,
  getPlanner,
  getExecutor,
  getMonitor,
  getTeacher,
  getBacktester,
  getCritic,
  getAuditor,
  getGordon,
} from "./definitions/index.ts";
import { setMemoryConfig, getMemoryConfig } from "./memoryConfig.ts";

// Re-export memory config functions for backward compatibility
export { setMemoryConfig, getMemoryConfig };

const logger = createModuleLogger("agents");

// ============================================================================
// Memory Configuration & Session Management
// ============================================================================

/** Session tracking state */
interface SessionState {
  startTime: number;
  lastActivity: number;
  messageCount: number;
  warningIssued: boolean;
}

let _sessionState: SessionState | null = null;

/**
 * Initialize or get session state
 */
function getSessionState(): SessionState {
  if (!_sessionState) {
    _sessionState = {
      startTime: Date.now(),
      lastActivity: Date.now(),
      messageCount: 0,
      warningIssued: false,
    };
  }
  return _sessionState;
}

/**
 * Check if session has exceeded maximum duration
 */
export function isSessionExpired(): boolean {
  const session = getSessionState();
  const _memoryConfig = getMemoryConfig();
  const maxDurationMs = _memoryConfig.maxSessionDurationHours * 60 * 60 * 1000;
  return Date.now() - session.startTime > maxDurationMs;
}

/**
 * Memory usage statistics
 */
export interface MemoryUsageStats {
  messageCount: number;
  maxMessages: number;
  usagePercent: number;
  sessionDurationHours: number;
  maxSessionHours: number;
  sessionExpired: boolean;
  warningLevel: "none" | "warning" | "critical";
  contextStats: {
    analysesCount: number;
    backtestsCount: number;
    hasScanner: boolean;
    hasPlanner: boolean;
    totalVersions: number;
  };
}

/**
 * Get memory usage statistics and check for warnings
 */
export function getMemoryUsageStats(): MemoryUsageStats {
  const session = getSessionState();
  const contextStats = getMemoryStats();
  const memConfig = getMemoryConfig();

  const usagePercent = session.messageCount / memConfig.lastMessages;
  const sessionDurationHours = (Date.now() - session.startTime) / (60 * 60 * 1000);
  const sessionExpired = isSessionExpired();

  let warningLevel: "none" | "warning" | "critical" = "none";
  if (usagePercent >= 0.95 || sessionExpired) {
    warningLevel = "critical";
  } else if (usagePercent >= memConfig.memoryWarningThreshold) {
    warningLevel = "warning";
  }

  return {
    messageCount: session.messageCount,
    maxMessages: memConfig.lastMessages,
    usagePercent: Math.min(usagePercent, 1),
    sessionDurationHours,
    maxSessionHours: memConfig.maxSessionDurationHours,
    sessionExpired,
    warningLevel,
    contextStats: {
      analysesCount: contextStats.analysesCount,
      backtestsCount: contextStats.backtestsCount,
      hasScanner: contextStats.hasScanner,
      hasPlanner: contextStats.hasPlanner,
      totalVersions: contextStats.totalVersions,
    },
  };
}

/**
 * Check memory usage and return warning message if needed
 * Should be called periodically (e.g., after each message)
 */
export function checkMemoryUsageWarning(): string | null {
  const stats = getMemoryUsageStats();
  const session = getSessionState();

  // Don't repeat warnings too frequently
  if (session.warningIssued && stats.warningLevel === "warning") {
    return null;
  }

  if (stats.warningLevel === "critical") {
    session.warningIssued = true;
    if (stats.sessionExpired) {
      return `[Memory Warning] Session has exceeded maximum duration (${stats.maxSessionHours}h). Consider starting a new session to maintain performance.`;
    }
    return `[Memory Warning] Memory usage at ${Math.round(stats.usagePercent * 100)}%. Oldest messages will be dropped soon. Consider starting a new session.`;
  }

  if (stats.warningLevel === "warning" && !session.warningIssued) {
    session.warningIssued = true;
    return `[Memory Notice] Memory usage at ${Math.round(stats.usagePercent * 100)}% (${stats.messageCount}/${stats.maxMessages} messages). Session running for ${stats.sessionDurationHours.toFixed(1)}h.`;
  }

  return null;
}

/**
 * Track a new message in the session
 */
export function trackMessage(): void {
  const session = getSessionState();
  session.messageCount++;
  session.lastActivity = Date.now();
}

/**
 * Clear session and reset memory
 * Call this when starting a new session or when session expires
 */
export function clearSession(): void {
  _sessionState = null;
  resetSharedMemory();
  resetAgents();
  logger.info("Session cleared and memory reset");
}

/**
 * Auto-clear session if expired
 * Returns true if session was cleared
 */
export function autoClearIfExpired(): boolean {
  if (isSessionExpired()) {
    logger.info("Session expired, auto-clearing");
    clearSession();
    return true;
  }
  return false;
}

// ============================================================================
// Lazy Agent Initialization
// ============================================================================

/**
 * Cache for lazily initialized agents
 * Agents are created on first access to ensure environment is loaded
 */
let _agents: {
  scanner?: Agent;
  analyst?: Agent;
  planner?: Agent;
  executor?: Agent;
  monitor?: Agent;
  teacher?: Agent;
  backtester?: Agent;
  critic?: Agent;
  auditor?: Agent;
  gordon?: Agent;
} = {};

/**
 * Get or create the Scanner Agent
 */
function getScannerAgent(): Agent {
  if (!_agents.scanner) {
    _agents.scanner = getScanner();
  }
  return _agents.scanner;
}

/**
 * Get or create the Analyst Agent
 */
function getAnalystAgent(): Agent {
  if (!_agents.analyst) {
    _agents.analyst = getAnalyst();
  }
  return _agents.analyst;
}

/**
 * Get or create the Planner Agent
 */
function getPlannerAgent(): Agent {
  if (!_agents.planner) {
    _agents.planner = getPlanner();
  }
  return _agents.planner;
}

/**
 * Get or create the Executor Agent
 */
function getExecutorAgent(): Agent {
  if (!_agents.executor) {
    _agents.executor = getExecutor();
  }
  return _agents.executor;
}

/**
 * Get or create the Monitor Agent
 */
function getMonitorAgent(): Agent {
  if (!_agents.monitor) {
    _agents.monitor = getMonitor();
  }
  return _agents.monitor;
}

/**
 * Get or create the Teacher Agent
 */
function getTeacherAgent(): Agent {
  if (!_agents.teacher) {
    _agents.teacher = getTeacher();
  }
  return _agents.teacher;
}

/**
 * Get or create the Backtester Agent
 */
function getBacktesterAgent(): Agent {
  if (!_agents.backtester) {
    _agents.backtester = getBacktester();
  }
  return _agents.backtester;
}

/**
 * Get or create the Critic Agent
 */
function getCriticAgent(): Agent {
  if (!_agents.critic) {
    _agents.critic = getCritic();
  }
  return _agents.critic;
}

/**
 * Get or create the Auditor Agent
 */
function getAuditorAgent(): Agent {
  if (!_agents.auditor) {
    _agents.auditor = getAuditor();
  }
  return _agents.auditor;
}

/**
 * Get or create the main Gordon Agent
 */
function getGordonAgent(): Agent {
  if (!_agents.gordon) {
    _agents.gordon = getGordon();
  }
  return _agents.gordon;
}

// ============================================================================
// Exported Agent Accessors
// ============================================================================

/**
 * Lazy-loaded agents - accessed via getters to ensure env is loaded first
 */
export const scannerAgent = { get agent() { return getScannerAgent(); } };
export const analystAgent = { get agent() { return getAnalystAgent(); } };
export const plannerAgent = { get agent() { return getPlannerAgent(); } };
export const executorAgent = { get agent() { return getExecutorAgent(); } };
export const monitorAgent = { get agent() { return getMonitorAgent(); } };
export const teacherAgent = { get agent() { return getTeacherAgent(); } };
export const backtesterAgent = { get agent() { return getBacktesterAgent(); } };
export const criticAgent = { get agent() { return getCriticAgent(); } };
export const auditorAgent = { get agent() { return getAuditorAgent(); } };

/**
 * Main Gordon agent - use this for all interactions
 */
export const gordonAgent = getGordonAgent;

/**
 * Get all agents (lazily initialized)
 */
export function getAllAgents() {
  return {
    gordon: getGordonAgent(),
    scanner: getScannerAgent(),
    analyst: getAnalystAgent(),
    planner: getPlannerAgent(),
    executor: getExecutorAgent(),
    monitor: getMonitorAgent(),
    teacher: getTeacherAgent(),
    backtester: getBacktesterAgent(),
    critic: getCriticAgent(),
    auditor: getAuditorAgent(),
  };
}

/**
 * Reset agent cache (useful for testing or reinitializing)
 */
export function resetAgents(): void {
  _agents = {};
  resetSubAgentMemory();
}
