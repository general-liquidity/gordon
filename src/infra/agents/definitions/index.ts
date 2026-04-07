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

// Legacy agent files deleted. All tools merged into Gordon.
// If any code still imports these, it should use getGordon() instead.
