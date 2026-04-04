/**
 * Polkadot Agent Kit Provider
 * Lazy singleton for PolkadotAgentKit initialization with action indexing
 *
 * Design:
 * - Lazy: Only initializes when first Polkadot tool is called
 * - Graceful: Returns clear error when keys are not configured
 * - Singleton: One PolkadotAgentKit instance shared across all tools
 * - Actions: Exposes actions by name via getAction() for Mastra tool bridging
 *
 * Required env vars: POLKADOT_PRIVATE_KEY or POLKADOT_MNEMONIC
 */

import { POLKADOT_ENV_KEYS } from "./types.ts";

// ============================================================================
// Singleton State
// ============================================================================

type PolkadotAction = { name: string; invoke: (args: unknown) => Promise<string> };

interface PolkadotAgentKitLike {
  initializeApi(): Promise<void>;
  getActions(): PolkadotAction[];
}

let _agentKit: PolkadotAgentKitLike | null = null;
let _actions: Map<string, PolkadotAction> | null = null;
const POLKADOT_AGENT_KIT_MODULE = "@polkadot-agent-kit/sdk";

async function loadPolkadotAgentKit() {
  // Keep this import opaque to Bun's compiler so the standalone binary
  // does not eagerly pull in the optional Polkadot dependency tree.
  const dynamicImport = new Function("specifier", "return import(specifier);") as (
    specifier: string,
  ) => Promise<{ PolkadotAgentKit: new (config: Record<string, unknown>) => PolkadotAgentKitLike }>;
  const module = await dynamicImport(POLKADOT_AGENT_KIT_MODULE);
  return module.PolkadotAgentKit;
}

// ============================================================================
// Configuration Check
// ============================================================================

/**
 * Check if Polkadot Agent Kit is configured (at least one credential present)
 */
export function isPolkadotKitConfigured(): boolean {
  return Boolean(
    process.env[POLKADOT_ENV_KEYS.PRIVATE_KEY] ||
    process.env[POLKADOT_ENV_KEYS.MNEMONIC]
  );
}

// ============================================================================
// Lazy Initialization
// ============================================================================

/**
 * Get or create the PolkadotAgentKit singleton
 *
 * Initializes on first call with:
 * - Private key or mnemonic from environment
 * - Key type (Sr25519 or Ed25519)
 * - Chain connections (all supported by default)
 *
 * @throws Error if credentials are not configured
 */
export async function getPolkadotKit(): Promise<PolkadotAgentKitLike> {
  if (_agentKit) return _agentKit;

  if (!isPolkadotKitConfigured()) {
    throw new Error(
      "Polkadot Agent Kit not configured. Set POLKADOT_PRIVATE_KEY or POLKADOT_MNEMONIC environment variable. " +
      "Learn more at https://dotagentkit.com"
    );
  }

  const keyType = (process.env[POLKADOT_ENV_KEYS.KEY_TYPE] as "Sr25519" | "Ed25519") || "Ed25519";
  const chainsEnv = process.env[POLKADOT_ENV_KEYS.CHAINS];
  const chains = chainsEnv ? chainsEnv.split(",").map(c => c.trim()) : undefined;

  const config: Record<string, unknown> = { keyType };

  if (process.env[POLKADOT_ENV_KEYS.PRIVATE_KEY]) {
    config.privateKey = process.env[POLKADOT_ENV_KEYS.PRIVATE_KEY];
  } else if (process.env[POLKADOT_ENV_KEYS.MNEMONIC]) {
    config.mnemonic = process.env[POLKADOT_ENV_KEYS.MNEMONIC];
  }

  if (chains) {
    config.chains = chains;
  }

  let PolkadotAgentKit: new (config: Record<string, unknown>) => PolkadotAgentKitLike;
  try {
    PolkadotAgentKit = await loadPolkadotAgentKit();
  } catch (error) {
    throw new Error(
      `Polkadot Agent Kit runtime is unavailable in this build: ${(error as Error).message}`,
    );
  }

  _agentKit = new PolkadotAgentKit(config) as PolkadotAgentKitLike;

  // Connect to chain RPCs
  await _agentKit.initializeApi();

  // Index actions by name for O(1) lookup
  _actions = new Map();
  for (const action of _agentKit.getActions()) {
    _actions.set(action.name, action);
  }

  console.log(`[PolkadotKit] Initialized with ${_actions.size} actions, keyType=${keyType}`);

  return _agentKit;
}

// ============================================================================
// Action Access
// ============================================================================

/**
 * Get a specific Polkadot Agent Kit action by name
 *
 * @param actionName - Action name (e.g., "check_balance", "transfer_native")
 * @returns The action object with invoke(), or null if not found
 */
export async function getAction(actionName: string): Promise<PolkadotAction | null> {
  await getPolkadotKit(); // Ensure initialized
  return _actions?.get(actionName) ?? null;
}

/**
 * Execute a Polkadot Agent Kit action by name
 *
 * @param actionName - Action name to execute
 * @param args - Arguments matching the action's schema
 * @returns The action's string result
 * @throws Error if action not found or execution fails
 */
export async function executeAction(actionName: string, args: Record<string, unknown> = {}): Promise<string> {
  const action = await getAction(actionName);
  if (!action) {
    throw new Error(`Polkadot Agent Kit action "${actionName}" not found. Available actions: ${getAvailableActionNames().join(", ")}`);
  }
  return action.invoke(args);
}

/**
 * Get all available action names (after initialization)
 */
export function getAvailableActionNames(): string[] {
  if (!_actions) return [];
  return Array.from(_actions.keys());
}
