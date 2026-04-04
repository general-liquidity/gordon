/**
 * Agent Definitions — Barrel Export
 *
 * Each agent is defined in its own file with a lazy getter function.
 * Import from here to get any agent definition.
 */

export { getScanner } from "./scanner.ts";
export { getAnalyst } from "./analyst.ts";
export { getPlanner } from "./planner.ts";
export { getExecutor } from "./executor.ts";
export { getMonitor } from "./monitor.ts";
export { getTeacher } from "./teacher.ts";
export { getBacktester } from "./backtester.ts";
export { getCritic } from "./critic.ts";
export { getAuditor } from "./auditor.ts";
export { getGordon } from "./gordon.ts";
