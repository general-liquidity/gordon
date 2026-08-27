/**
 * Memory Configuration State
 *
 * Isolated module to avoid circular dependencies between agents.ts and memoryFactory.ts.
 * Holds the mutable memory config singleton and its accessor/mutator.
 */

import type { MemoryConfig } from "../../../types/index.ts";
import { createModuleLogger } from "../../logger/logger.ts";

const logger = createModuleLogger("agents");

/** Default memory configuration */
const DEFAULT_MEMORY_CONFIG: MemoryConfig = {
  lastMessages: 20,
  maxSessionDurationHours: 24,
  memoryWarningThreshold: 0.8,
};

let _memoryConfig: MemoryConfig = DEFAULT_MEMORY_CONFIG;

/**
 * Set the memory configuration from GordonConfig
 */
export function setMemoryConfig(config: Partial<MemoryConfig>): void {
  _memoryConfig = { ...DEFAULT_MEMORY_CONFIG, ...config };
  logger.info("Memory config updated", {
    lastMessages: _memoryConfig.lastMessages,
    maxSessionHours: _memoryConfig.maxSessionDurationHours,
  });
}

/**
 * Get current memory configuration
 */
export function getMemoryConfig(): MemoryConfig {
  return _memoryConfig;
}

export { DEFAULT_MEMORY_CONFIG };
