/**
 * Agent Definitions — 4-Agent Architecture
 *
 * Gordon:      Main agent with ALL read-only tools (handles 95% of requests)
 * Executor:    Isolated trade execution (moves real money — separate for safety)
 * Researcher:  On-demand parallel work (spawned, not permanent)
 * Critic:      Risk check built into Executor's pipeline (not a routed agent)
 *
 * Retired single-purpose agents (Scanner, Analyst, Planner, Monitor,
 * Teacher, Backtester, Auditor) had their tools merged into Gordon.
 */

export { getGordon } from "./gordon.ts";
export { getExecutor } from "./executor.ts";
export { getResearcher } from "./researcher.ts";
