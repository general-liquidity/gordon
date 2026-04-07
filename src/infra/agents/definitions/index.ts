/**
 * Agent Definitions — 4-Agent Architecture
 *
 * Gordon:      Main agent with ALL read-only tools (handles 95% of requests)
 * Executor:    Isolated trade execution (moves real money — separate for safety)
 * Researcher:  On-demand parallel work (spawned, not permanent)
 * Critic:      Risk check built into Executor's pipeline (not a routed agent)
 *
 * Legacy agents (Scanner, Analyst, Planner, Monitor, Teacher, Backtester,
 * Auditor) are retired — their tools are merged into Gordon directly.
 * Files kept for reference but no longer imported.
 */

export { getGordon } from "./gordon.ts";
export { getExecutor } from "./executor.ts";
export { getResearcher } from "./researcher.ts";

// Legacy exports — kept for backward compatibility during transition.
// These agents are no longer used in the routing network.
export { getScanner } from "./scanner.ts";
export { getAnalyst } from "./analyst.ts";
export { getPlanner } from "./planner.ts";
export { getMonitor } from "./monitor.ts";
export { getTeacher } from "./teacher.ts";
export { getBacktester } from "./backtester.ts";
export { getCritic } from "./critic.ts";
export { getAuditor } from "./auditor.ts";
