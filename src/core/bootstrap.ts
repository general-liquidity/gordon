/**
 * v0.7 Bootstrap
 *
 * Central wiring point that initializes all v0.7 subsystems at application
 * startup. Each subsystem is initialized independently so a failure in one
 * does not prevent the others from starting.
 *
 * Usage:
 *   import { bootstrapV07 } from "./core/bootstrap.ts";
 *
 *   const result = await bootstrapV07();
 *   // result.memory, result.playbooks, result.positionStore, result.subscriptionRegistry
 *
 * Does NOT start the MarketEventEmitter or agent invoker — those require an
 * exchange connection which is established later in App.tsx.
 */

import { getMemoryManager, type MemoryManager } from "./memory/index.ts";
import {
  PlaybookParser,
  PlaybookLoader,
  playbookRegistry,
  type PlaybookRegistry,
} from "./playbooks/index.ts";
import { getPositionStore, type PositionStore } from "./positions/index.ts";
import { getEventBus } from "../events/index.ts";
import {
  getSubscriptionRegistry,
  createDefaultSubscriptions,
  type AgentSubscriptionRegistry,
} from "../events/index.ts";
import { createModuleLogger } from "../infra/logger/index.ts";

const logger = createModuleLogger("bootstrap");

// ============================================================================
// Types
// ============================================================================

/**
 * Result of a successful bootstrap, containing references to all initialized
 * v0.7 subsystems.
 */
export interface BootstrapResult {
  memory: MemoryManager;
  playbooks: { registry: PlaybookRegistry; loader: PlaybookLoader };
  positionStore: PositionStore;
  subscriptionRegistry: AgentSubscriptionRegistry;
}

// ============================================================================
// Bootstrap
// ============================================================================

/**
 * Initialize all v0.7 subsystems.
 *
 * Idempotent — calling multiple times is safe because the underlying
 * singletons (memory manager, position store, subscription registry) guard
 * against double-initialization.
 *
 * Each init step is wrapped in its own try/catch so a failure in one
 * subsystem does not prevent the rest from starting.
 *
 * @returns References to all initialized subsystems
 */
export async function bootstrapV07(): Promise<BootstrapResult> {
  const start = Date.now();
  logger.info("v0.7 bootstrap starting");

  // ------------------------------------------------------------------
  // 1. Persistent Memory
  // ------------------------------------------------------------------
  let memory: MemoryManager | undefined;
  try {
    memory = await getMemoryManager();
    logger.info("Persistent memory initialized", {
      elapsed: `${Date.now() - start}ms`,
    });
  } catch (err) {
    logger.error(
      "Failed to initialize persistent memory",
      err instanceof Error ? err : new Error(String(err))
    );
  }

  // ------------------------------------------------------------------
  // 2. Playbooks
  // ------------------------------------------------------------------
  let loader: PlaybookLoader | undefined;
  try {
    const parser = new PlaybookParser();
    loader = new PlaybookLoader(parser, playbookRegistry);

    const builtinCount = await loader.loadBuiltins();
    const userCount = await loader.loadUserPlaybooks();

    logger.info("Playbooks loaded", {
      builtin: String(builtinCount),
      user: String(userCount),
      total: String(playbookRegistry.size),
      elapsed: `${Date.now() - start}ms`,
    });
  } catch (err) {
    logger.error(
      "Failed to load playbooks",
      err instanceof Error ? err : new Error(String(err))
    );
  }

  // ------------------------------------------------------------------
  // 3. Position Store
  // ------------------------------------------------------------------
  let positionStore: PositionStore | undefined;
  try {
    positionStore = await getPositionStore();
    logger.info("Position store initialized", {
      elapsed: `${Date.now() - start}ms`,
    });
  } catch (err) {
    logger.error(
      "Failed to initialize position store",
      err instanceof Error ? err : new Error(String(err))
    );
  }

  // ------------------------------------------------------------------
  // 4. Wire Memory to EventBus
  // ------------------------------------------------------------------
  if (memory) {
    try {
      memory.subscribeToEvents(getEventBus());
      logger.info("Memory wired to event bus", {
        events: "POSITION_CLOSED, ANALYSIS_COMPLETE, SETUP_DETECTED",
      });
    } catch (err) {
      logger.error(
        "Failed to wire memory to event bus",
        err instanceof Error ? err : new Error(String(err))
      );
    }
  }

  // ------------------------------------------------------------------
  // 5. Agent Subscriptions (register defaults, do NOT enable yet)
  // ------------------------------------------------------------------
  let subscriptionRegistry: AgentSubscriptionRegistry | undefined;
  try {
    subscriptionRegistry = getSubscriptionRegistry();
    const defaults = createDefaultSubscriptions(subscriptionRegistry);
    subscriptionRegistry.registerAll(defaults);

    logger.info("Agent subscriptions registered", {
      count: String(subscriptionRegistry.getSubscriptionCount()),
      enabled: "false",
      elapsed: `${Date.now() - start}ms`,
    });
  } catch (err) {
    logger.error(
      "Failed to register agent subscriptions",
      err instanceof Error ? err : new Error(String(err))
    );
  }

  // ------------------------------------------------------------------
  // Done
  // ------------------------------------------------------------------
  const elapsed = Date.now() - start;
  logger.info("v0.7 bootstrap complete", { elapsed: `${elapsed}ms` });

  return {
    memory: memory!,
    playbooks: { registry: playbookRegistry, loader: loader! },
    positionStore: positionStore!,
    subscriptionRegistry: subscriptionRegistry!,
  };
}
