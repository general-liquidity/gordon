/**
 * CDP AgentKit Provider
 * Lazy singleton for AgentKit initialization with wallet + action providers
 *
 * Design:
 * - Lazy: Only initializes when first AgentKit tool is called
 * - Graceful: Returns clear error when CDP keys are not configured
 * - Singleton: One AgentKit instance shared across all tools
 * - Actions: Exposes actions by name via getAction() for Mastra tool bridging
 *
 * Required env vars: CDP_API_KEY_ID, CDP_API_KEY_SECRET, CDP_WALLET_SECRET
 * Optional: CDP_NETWORK_ID (defaults to "base-sepolia" for safety)
 */

import {
  AgentKit,
  CdpEvmWalletProvider,
  walletActionProvider,
  erc20ActionProvider,
  wethActionProvider,
  cdpApiActionProvider,
  cdpEvmWalletActionProvider,
} from "@coinbase/agentkit";
import type { Action } from "@coinbase/agentkit";

import { CDP_ENV_KEYS } from "./types.ts";

// ============================================================================
// Singleton State
// ============================================================================

let _agentKit: AgentKit | null = null;
let _actions: Map<string, Action> | null = null;

// ============================================================================
// Configuration Check
// ============================================================================

/**
 * Check if CDP AgentKit is configured (all required env vars present)
 */
export function isAgentKitConfigured(): boolean {
  return Boolean(
    process.env[CDP_ENV_KEYS.API_KEY_ID] &&
    process.env[CDP_ENV_KEYS.API_KEY_SECRET] &&
    process.env[CDP_ENV_KEYS.WALLET_SECRET]
  );
}

// ============================================================================
// Lazy Initialization
// ============================================================================

/**
 * Get or create the AgentKit singleton
 *
 * Initializes on first call with:
 * - CdpEvmWalletProvider (Base network, CDP Server Wallet)
 * - walletActionProvider (get_wallet_details, native_transfer, get_balance)
 * - erc20ActionProvider (get_balance, transfer for ERC20 tokens)
 * - wethActionProvider (wrap/unwrap ETH)
 * - cdpApiActionProvider (faucet, trade API)
 * - cdpEvmWalletActionProvider (DEX swap, swap price, spend permissions)
 *
 * @throws Error if CDP keys are not configured
 */
export async function getAgentKit(): Promise<AgentKit> {
  if (_agentKit) return _agentKit;

  if (!isAgentKitConfigured()) {
    throw new Error(
      "CDP AgentKit not configured. Set CDP_API_KEY_ID, CDP_API_KEY_SECRET, and CDP_WALLET_SECRET environment variables. " +
      "Get keys at https://portal.cdp.coinbase.com"
    );
  }

  const networkId = process.env[CDP_ENV_KEYS.NETWORK_ID] || "base-sepolia";

  const walletProvider = await CdpEvmWalletProvider.configureWithWallet({
    apiKeyId: process.env[CDP_ENV_KEYS.API_KEY_ID]!,
    apiKeySecret: process.env[CDP_ENV_KEYS.API_KEY_SECRET]!,
    walletSecret: process.env[CDP_ENV_KEYS.WALLET_SECRET]!,
    networkId,
  });

  const wallet = walletActionProvider();
  const erc20 = erc20ActionProvider();
  const weth = wethActionProvider();
  const cdp = cdpApiActionProvider();
  const cdpEvm = cdpEvmWalletActionProvider();

  _agentKit = await AgentKit.from({
    walletProvider,
    actionProviders: [wallet, erc20, weth, cdp, cdpEvm],
  });

  // Index actions by name for O(1) lookup
  _actions = new Map();
  for (const action of _agentKit.getActions()) {
    _actions.set(action.name, action);
  }

  return _agentKit;
}

// ============================================================================
// Action Access
// ============================================================================

/**
 * Get a specific AgentKit action by name
 *
 * @param actionName - Action name (e.g., "get_wallet_details", "native_transfer")
 * @returns The action object with invoke(), or null if not found
 */
export async function getAction(actionName: string): Promise<Action | null> {
  await getAgentKit(); // Ensure initialized
  return _actions?.get(actionName) ?? null;
}

/**
 * Execute an AgentKit action by name
 *
 * @param actionName - Action name to execute
 * @param args - Arguments matching the action's schema
 * @returns The action's string result
 * @throws Error if action not found or execution fails
 */
export async function executeAction(actionName: string, args: Record<string, unknown> = {}): Promise<string> {
  const action = await getAction(actionName);
  if (!action) {
    throw new Error(`AgentKit action "${actionName}" not found. Available actions: ${getAvailableActionNames().join(", ")}`);
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
