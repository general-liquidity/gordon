/**
 * Solana Agent Kit Provider
 * Lazy singleton for SolanaAgentKit initialization with action indexing
 *
 * Design:
 * - Lazy: Only initializes when first Solana tool is called
 * - Graceful: Returns clear error when keys are not configured
 * - Singleton: One SolanaAgentKit instance shared across all tools
 * - Actions: Exposes actions by name for Mastra tool bridging
 *
 * Key difference from Coinbase/Polkadot: Solana actions use
 * action.handler(agent, args) instead of action.invoke(args),
 * so the agent instance must be passed to every handler call.
 *
 * Required env vars: SOLANA_PRIVATE_KEY, SOLANA_RPC_URL
 */

import { SolanaAgentKit, KeypairWallet } from "solana-agent-kit";
import TokenPlugin from "@solana-agent-kit/plugin-token";
import DefiPlugin from "@solana-agent-kit/plugin-defi";
import { Keypair } from "@solana/web3.js";
// @ts-ignore — bs58 has no type declarations
import bs58 from "bs58";

import { SOLANA_ENV_KEYS } from "./types.ts";

// ============================================================================
// Action type (from solana-agent-kit core)
// ============================================================================

interface SolanaAction {
  name: string;
  description: string;
  schema: { parse: (input: unknown) => Record<string, unknown> };
  handler: (agent: SolanaAgentKit, input: Record<string, unknown>) => Promise<Record<string, unknown>>;
}

// ============================================================================
// Singleton State
// ============================================================================

let _agentKit: SolanaAgentKit | null = null;
let _actions: Map<string, SolanaAction> | null = null;

// ============================================================================
// Configuration Check
// ============================================================================

/**
 * Check if Solana Agent Kit is configured (required env vars present)
 */
export function isSolanaKitConfigured(): boolean {
  return Boolean(
    process.env[SOLANA_ENV_KEYS.PRIVATE_KEY] &&
    process.env[SOLANA_ENV_KEYS.RPC_URL]
  );
}

// ============================================================================
// Lazy Initialization
// ============================================================================

/**
 * Get or create the SolanaAgentKit singleton
 *
 * Initializes on first call with:
 * - KeypairWallet from base58-encoded private key
 * - TokenPlugin (Jupiter swaps, transfers, Pyth, PumpFun, rugcheck, limit orders)
 *
 * @throws Error if credentials are not configured
 */
export async function getSolanaKit(): Promise<SolanaAgentKit> {
  if (_agentKit) return _agentKit;

  if (!isSolanaKitConfigured()) {
    throw new Error(
      "Solana Agent Kit not configured. Set SOLANA_PRIVATE_KEY and SOLANA_RPC_URL environment variables. " +
      "Learn more at https://github.com/sendaifun/solana-agent-kit"
    );
  }

  const privateKey = process.env[SOLANA_ENV_KEYS.PRIVATE_KEY]!;
  const rpcUrl = process.env[SOLANA_ENV_KEYS.RPC_URL]!;

  const keypair = Keypair.fromSecretKey(bs58.decode(privateKey));
  const wallet = new KeypairWallet(keypair, rpcUrl);

  const config: Record<string, unknown> = {};
  if (process.env[SOLANA_ENV_KEYS.HELIUS_API_KEY]) {
    config.HELIUS_API_KEY = process.env[SOLANA_ENV_KEYS.HELIUS_API_KEY];
  }
  if (process.env[SOLANA_ENV_KEYS.JUPITER_REFERRAL_ACCOUNT]) {
    config.JUPITER_REFERRAL_ACCOUNT = process.env[SOLANA_ENV_KEYS.JUPITER_REFERRAL_ACCOUNT];
  }
  if (process.env[SOLANA_ENV_KEYS.JUPITER_FEE_BPS]) {
    config.JUPITER_FEE_BPS = parseInt(process.env[SOLANA_ENV_KEYS.JUPITER_FEE_BPS]!, 10);
  }

  _agentKit = new SolanaAgentKit(wallet, rpcUrl, config as ConstructorParameters<typeof SolanaAgentKit>[2]);

  // Register plugins (all actions indexed by name for O(1) lookup)
  _agentKit.use(TokenPlugin);
  _agentKit.use(DefiPlugin);

  // Index actions by name for O(1) lookup
  _actions = new Map();
  for (const action of (_agentKit as unknown as { actions: SolanaAction[] }).actions) {
    _actions.set(action.name, action);
  }

  console.log(`[SolanaKit] Initialized with ${_actions.size} actions`);

  return _agentKit;
}

// ============================================================================
// Action Access
// ============================================================================

/**
 * Execute a Solana Agent Kit action by name
 *
 * Key difference from Coinbase/Polkadot: Solana uses action.handler(agent, args)
 * instead of action.invoke(args). The agent instance holds the wallet/connection.
 *
 * @param actionName - Action name to execute (e.g., "TRADE", "TRANSFER")
 * @param args - Arguments matching the action's Zod schema
 * @returns JSON-stringified result from the action handler
 * @throws Error if action not found or execution fails
 */
export async function executeAction(actionName: string, args: Record<string, unknown> = {}): Promise<string> {
  const agent = await getSolanaKit();
  const action = _actions?.get(actionName);
  if (!action) {
    throw new Error(`Solana Agent Kit action "${actionName}" not found. Available: ${getAvailableActionNames().join(", ")}`);
  }

  // Validate input with the action's Zod schema
  const validatedInput = action.schema.parse(args);

  // Execute: handler needs the agent instance (holds wallet/connection)
  const result = await action.handler(agent as unknown as SolanaAgentKit, validatedInput as Record<string, unknown>);

  // Convert Record<string, any> to LLM-friendly string
  return typeof result === "string" ? result : JSON.stringify(result);
}

/**
 * Get all available action names (after initialization)
 */
export function getAvailableActionNames(): string[] {
  if (!_actions) return [];
  return Array.from(_actions.keys());
}
