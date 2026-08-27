/**
 * Native (Mastra-built-in) activation wiring — shared across the 3 agent defs.
 *
 * ADDITIVE + FLAG-GATED, default-off. Every helper here returns an empty /
 * inert result when its flag is unset, so agent construction is byte-identical
 * to today with all flags off. Nothing in this module enforces anything on its
 * own — the native layers it wires COMPOSE WITH Gordon's existing deny-first
 * safety stack, they never replace it.
 *
 * Three concerns:
 *  1. Native input/output processors (`GORDON_MASTRA_PROCESSORS`) — appended
 *     AFTER each agent's own reconciler/guard/token-limiter so Gordon's
 *     structural repair runs first. The CostGuard processor is EXCLUDED: it
 *     requires observability storage that this build removed and would throw at
 *     registration. Only the warn-mode injection/PII/moderation detectors wire.
 *  2. Native goal loop (`GORDON_DURABLE_AGENTS`) — the flag-gated `goal:{}`
 *     block on the Gordon constructor. No-op object when off.
 *  3. Durable Mastra instance (`GORDON_DURABLE_AGENTS`) — a Mastra instance with
 *     libSQL storage + background tasks so durable-agent run snapshots persist.
 *     Constructed only when the flag is set.
 */

import { Mastra } from "@mastra/core";
import type { Agent } from "@mastra/core/agent";
import { CostGuardProcessor } from "@mastra/core/processors";
import { getNativeInputProcessors, getNativeOutputProcessors } from "./processors/index.ts";
import { isDurableAgentsEnabled } from "./harness/durableRunner.ts";
import { getFastMastraModel, type MastraModelConfig } from "../runtime/providers/registry.ts";
import { createMastraStorageConfig } from "./memory/mastraStorage.ts";
import { createModuleLogger } from "../logger/logger.ts";

const logger = createModuleLogger("native-wiring");

/**
 * Native INPUT processors to append after an agent's own processors, with the
 * CostGuard processor removed. Empty unless `GORDON_MASTRA_PROCESSORS` is set.
 *
 * CostGuard is filtered here (not in the native module, owned elsewhere) so a
 * discoverable cost budget cannot pull an observability-storage-dependent
 * processor into registration and throw. The injection/PII/moderation detectors
 * (all warn-mode) survive.
 */
export function nativeInputProcessorsForAgent() {
  return getNativeInputProcessors().filter((p) => !(p instanceof CostGuardProcessor));
}

/**
 * Native OUTPUT processors to append after an agent's own processors. Empty
 * unless `GORDON_MASTRA_PROCESSORS` is set. (No CostGuard on the output side.)
 */
export function nativeOutputProcessorsForAgent() {
  return getNativeOutputProcessors();
}

/**
 * Flag-gated `goal` block for the Gordon Agent constructor. Returns `{}` (no
 * `goal` key → identical construction) unless `GORDON_DURABLE_AGENTS` is set.
 * When set, supplies the judge model + run budget the native goal loop needs;
 * the durable runner sets the per-thread objective at run start.
 */
export function gordonGoalConfig(): { goal?: { judge: MastraModelConfig; maxRuns: number } } {
  if (!isDurableAgentsEnabled()) return {};
  return {
    goal: {
      judge: getFastMastraModel(),
      maxRuns: 50,
    },
  };
}

let durableMastra: Mastra | null = null;

/**
 * Construct (once) and hold a Mastra instance registering the Gordon agent with
 * libSQL storage + background tasks, so durable-agent run snapshots persist and
 * `recoverActiveRuns` can re-drive orphaned runs after a restart. No-op (returns
 * null) unless `GORDON_DURABLE_AGENTS` is set. libSQL falls back to in-memory
 * storage when the runtime is unavailable (durable runs then fail safe — the
 * live stream is lost on restart, the trade simply never executes).
 */
export function registerDurableMastra(agent: Agent): Mastra | null {
  if (!isDurableAgentsEnabled()) return null;
  if (durableMastra) return durableMastra;

  const dbUrl = process.env.DATABASE_URL || "file:gordon.db";
  const { storage, mode } = createMastraStorageConfig({
    storeId: "gordon-durable",
    dbUrl,
  });

  durableMastra = new Mastra({
    agents: { gordon: agent } as never,
    storage,
    backgroundTasks: { enabled: true },
  });
  logger.info("Durable Mastra instance registered", { mode });
  return durableMastra;
}
