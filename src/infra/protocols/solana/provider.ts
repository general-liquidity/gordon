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

import { SOLANA_ENV_KEYS } from "./types.ts";

// ============================================================================
// Action/runtime types
// ============================================================================

interface SolanaAgentKitLike {
  use(plugin: unknown): void;
  actions: SolanaAction[];
}

interface SolanaAction {
  name: string;
  description: string;
  schema: { parse: (input: unknown) => Record<string, unknown> };
  handler: (agent: SolanaAgentKitLike, input: Record<string, unknown>) => Promise<Record<string, unknown>>;
}

interface SolanaRuntime {
  SolanaAgentKit: new (
    wallet: unknown,
    rpcUrl: string,
    config?: Record<string, unknown>,
  ) => SolanaAgentKitLike;
  KeypairWallet: new (keypair: unknown, rpcUrl: string) => unknown;
  Keypair: { fromSecretKey(secretKey: Uint8Array): unknown };
  TokenPlugin: unknown;
  DefiPlugin: unknown;
  bs58: { decode(value: string): Uint8Array };
}

// ============================================================================
// Singleton State
// ============================================================================

let _agentKit: SolanaAgentKitLike | null = null;
let _actions: Map<string, SolanaAction> | null = null;
let _runtimePromise: Promise<SolanaRuntime> | null = null;

// ============================================================================
// Runtime loading
// ============================================================================

function getDynamicImporter() {
  return new Function("specifier", "return import(specifier);") as (
    specifier: string,
  ) => Promise<Record<string, unknown>>;
}

async function loadSolanaRuntime(): Promise<SolanaRuntime> {
  if (_runtimePromise) {
    return _runtimePromise;
  }

  const dynamicImport = getDynamicImporter();
  _runtimePromise = (async () => {
    const [solanaAgentKit, tokenPlugin, defiPlugin, web3, bs58Module] = await Promise.all([
      dynamicImport("solana-agent-kit"),
      dynamicImport("@solana-agent-kit/plugin-token"),
      dynamicImport("@solana-agent-kit/plugin-defi"),
      dynamicImport("@solana/web3.js"),
      dynamicImport("bs58"),
    ]);

    return {
      SolanaAgentKit: solanaAgentKit.SolanaAgentKit as SolanaRuntime["SolanaAgentKit"],
      KeypairWallet: solanaAgentKit.KeypairWallet as SolanaRuntime["KeypairWallet"],
      Keypair: web3.Keypair as SolanaRuntime["Keypair"],
      TokenPlugin: (tokenPlugin.default ?? tokenPlugin) as unknown,
      DefiPlugin: (defiPlugin.default ?? defiPlugin) as unknown,
      bs58: (bs58Module.default ?? bs58Module) as SolanaRuntime["bs58"],
    };
  })();

  return _runtimePromise;
}

// ============================================================================
// Configuration Check
// ============================================================================

/**
 * Check if Solana Agent Kit is configured (required env vars present)
 */
export function isSolanaKitConfigured(): boolean {
  return Boolean(
    process.env[SOLANA_ENV_KEYS.PRIVATE_KEY] &&
    process.env[SOLANA_ENV_KEYS.RPC_URL],
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
export async function getSolanaKit(): Promise<SolanaAgentKitLike> {
  if (_agentKit) return _agentKit;

  if (!isSolanaKitConfigured()) {
    throw new Error(
      "Solana Agent Kit not configured. Set SOLANA_PRIVATE_KEY and SOLANA_RPC_URL environment variables. " +
      "Learn more at https://github.com/sendaifun/solana-agent-kit",
    );
  }

  let runtime: SolanaRuntime;
  try {
    runtime = await loadSolanaRuntime();
  } catch (error) {
    throw new Error(
      `Solana Agent Kit runtime is unavailable in this build: ${(error as Error).message}`,
    );
  }

  const privateKey = process.env[SOLANA_ENV_KEYS.PRIVATE_KEY]!;
  const rpcUrl = process.env[SOLANA_ENV_KEYS.RPC_URL]!;

  const keypair = runtime.Keypair.fromSecretKey(runtime.bs58.decode(privateKey));
  const wallet = new runtime.KeypairWallet(keypair, rpcUrl);

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

  _agentKit = new runtime.SolanaAgentKit(wallet, rpcUrl, config);
  _agentKit.use(runtime.TokenPlugin);
  _agentKit.use(runtime.DefiPlugin);

  _actions = new Map();
  for (const action of _agentKit.actions) {
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
export async function executeAction(
  actionName: string,
  args: Record<string, unknown> = {},
): Promise<string> {
  const agent = await getSolanaKit();
  const action = _actions?.get(actionName);
  if (!action) {
    throw new Error(
      `Solana Agent Kit action "${actionName}" not found. Available: ${getAvailableActionNames().join(", ")}`,
    );
  }

  const validatedInput = action.schema.parse(args);
  const result = await action.handler(agent, validatedInput);

  return typeof result === "string" ? result : JSON.stringify(result);
}

/**
 * Get all available action names (after initialization)
 */
export function getAvailableActionNames(): string[] {
  if (!_actions) return [];
  return Array.from(_actions.keys());
}
