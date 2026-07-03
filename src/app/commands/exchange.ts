/**
 * Exchange Commands
 * CLI commands for managing trading exchanges
 *
 * Commands:
 * - /exchange list       - Show configured exchanges
 * - /exchange add <type> - Add new exchange (launches setup)
 * - /exchange switch <id> - Switch active exchange
 * - /exchange remove <id> - Remove an exchange
 * - /exchange status     - Show connection status for all
 * - /exchange compare <symbol> - Compare prices across exchanges
 */

import { loadConfig, saveConfig } from '../../infra/storage/config/config.ts';
import { ExchangeFactory } from '../../infra/exchange/factory.ts';
import type { ExchangeId, Exchange, NativeExchangeId, CcxtExchangeId } from '../../infra/exchange/types.ts';
import { isCcxtExchangeId, normalizeExchangeId, ccxtIdToNativeVenue } from '../../infra/exchange/types.ts';
import {
  ccxtExchangeRequiresPassphrase,
  ccxtExchangeRequiresWallet,
  getCcxtSetupInstructions,
  getCcxtHelpFragment,
} from '../../infra/exchange/ccxt-ux.ts';
import type { MultiExchangeConfig, GordonConfig } from '../../types/index.ts';
import { createModuleLogger } from '../../infra/logger/index.ts';
import { refreshRuntimeCredentials } from '../../infra/runtime/credentialRefresh.ts';

const logger = createModuleLogger('exchange-commands');

// ============================================================================
// Types
// ============================================================================

/**
 * Result of an exchange command execution
 */
export interface ExchangeCommandResult {
  /** Whether the command succeeded */
  success: boolean;
  /** Human-readable message */
  message: string;
  /** Additional data (command-specific) */
  data?: unknown;
}

// ============================================================================
// Command Implementations
// ============================================================================

/**
 * List all configured exchanges
 * Usage: /exchange list
 */
export async function exchangeList(): Promise<ExchangeCommandResult> {
  try {
    const config = await loadConfig();
    const exchanges = config.exchanges || [];

    if (exchanges.length === 0) {
      return {
        success: true,
        message: 'No exchanges configured. Use "/exchange add <type>" to add one.',
        data: { exchanges: [], activeId: null },
      };
    }

    const exchangeList = exchanges.map((ex) => {
      const isWallet = ccxtExchangeRequiresWallet(ex.type);
      return {
        id: ex.id,
        type: ex.type,
        isDefault: ex.isDefault,
        isActive: ex.id === config.activeExchangeId,
        sandbox: ex.sandbox || false,
        isWalletAuth: isWallet,
        keyPrefix: isWallet
          ? (ex.walletPrivateKey ? ex.walletPrivateKey.substring(0, 10) + '...' : 'wallet')
          : ex.apiKey.substring(0, 8) + '...',
      };
    });

    const activeCount = exchanges.filter((ex) => ex.id === config.activeExchangeId).length;

    return {
      success: true,
      message: `${exchanges.length} exchange(s) configured${activeCount > 0 ? ` (1 active)` : ''}`,
      data: {
        exchanges: exchangeList,
        activeId: config.activeExchangeId,
        supportedTypes: ExchangeFactory.getSupportedExchanges(),
      },
    };
  } catch (error) {
    return {
      success: false,
      message: `Failed to list exchanges: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Add a new exchange configuration
 * Usage: /exchange add <type> [--sandbox]
 *
 * Returns the credentials needed and setup instructions.
 * The actual credential entry is done via /setup or the SetupWizard UI.
 */
export async function exchangeAdd(exchangeType: string, sandbox = false): Promise<ExchangeCommandResult> {
  try {
    // Validate exchange type
    if (!ExchangeFactory.isSupported(exchangeType)) {
      const supported = ExchangeFactory.getSupportedExchanges();
      return {
        success: false,
        message: `Unsupported exchange type: "${exchangeType}". Supported: ${supported.join(', ')}`,
        data: { supportedTypes: supported },
      };
    }

    const type = normalizeExchangeId(exchangeType);
    const config = await loadConfig();

    const baseId = sandbox ? `${type}-testnet` : type;
    let id = baseId;
    let counter = 1;
    while (config.exchanges.some((ex) => ex.id === id)) {
      id = `${baseId}-${counter}`;
      counter++;
    }

    const existingOfType = config.exchanges.filter((ex) => ex.type === type);
    const needsPassphrase = ccxtExchangeRequiresPassphrase(type);
    const needsWallet = ccxtExchangeRequiresWallet(type);

    const requiredFields = needsWallet
      ? ['walletPrivateKey']
      : ['apiKey', 'apiSecret', ...(needsPassphrase ? ['passphrase'] : [])];

    const label = sandbox ? `${type} (testnet/sandbox)` : type;
    const authMessage = needsWallet
      ? `Ready to add ${label}. Please provide wallet private key.`
      : `Ready to add ${label}. Please provide API credentials.`;

    return {
      success: true,
      message: authMessage,
      data: {
        exchangeType: type,
        sandbox,
        suggestedId: id,
        existingCount: existingOfType.length,
        needsPassphrase,
        needsWallet,
        requiredFields,
        optionalFields: needsWallet ? [] : (sandbox ? [] : ['sandbox']),
        instructions: getExchangeSetupInstructions(type, sandbox),
      },
    };
  } catch (error) {
    return {
      success: false,
      message: `Failed to prepare exchange add: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Switch the active exchange
 * Usage: /exchange switch <id>
 */
export async function exchangeSwitch(exchangeId: string): Promise<ExchangeCommandResult> {
  try {
    const config = await loadConfig();

    // Find the exchange
    const exchange = config.exchanges.find((ex) => ex.id === exchangeId);

    if (!exchange) {
      const available = config.exchanges.map((ex) => ex.id);
      return {
        success: false,
        message: `Exchange "${exchangeId}" not found. Available: ${available.length > 0 ? available.join(', ') : 'none'}`,
        data: { availableIds: available },
      };
    }

    // Update the active exchange
    const updatedConfig: GordonConfig = {
      ...config,
      activeExchangeId: exchangeId,
      exchanges: config.exchanges.map((ex) => ({
        ...ex,
        isDefault: ex.id === exchangeId,
      })),
    };

    await saveConfig(updatedConfig);

    // Force every cached client/context to rebuild against the new active
    // exchange — clears ExchangeFactory, BrokerFactory, providerRegistry, and
    // the TUI's GatewayContextResolver in one call.
    await refreshRuntimeCredentials();

    logger.info('Switched active exchange', { exchangeId, type: exchange.type });

    return {
      success: true,
      message: `Switched to exchange "${exchange.id}" (${exchange.type})`,
      data: {
        activeExchange: {
          id: exchange.id,
          type: exchange.type,
          sandbox: exchange.sandbox || false,
        },
      },
    };
  } catch (error) {
    return {
      success: false,
      message: `Failed to switch exchange: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Remove an exchange configuration
 * Usage: /exchange remove <id>
 */
export async function exchangeRemove(exchangeId: string): Promise<ExchangeCommandResult> {
  try {
    const config = await loadConfig();

    // Find the exchange
    const exchangeIndex = config.exchanges.findIndex((ex) => ex.id === exchangeId);

    if (exchangeIndex === -1) {
      return {
        success: false,
        message: `Exchange "${exchangeId}" not found`,
      };
    }

    const exchange = config.exchanges[exchangeIndex]!;

    // Don't allow removing the only/active exchange without confirmation
    if (config.exchanges.length === 1) {
      return {
        success: false,
        message: `Cannot remove the only configured exchange. Add another exchange first or use /setup to reconfigure.`,
      };
    }

    // Remove the exchange
    const updatedExchanges = config.exchanges.filter((ex) => ex.id !== exchangeId);

    // If removing the active exchange, switch to another one
    let newActiveId = config.activeExchangeId;
    if (config.activeExchangeId === exchangeId) {
      newActiveId = updatedExchanges[0]?.id;
      if (updatedExchanges[0]) {
        updatedExchanges[0] = { ...updatedExchanges[0], isDefault: true };
      }
    }

    const updatedConfig: GordonConfig = {
      ...config,
      exchanges: updatedExchanges,
      activeExchangeId: newActiveId,
    };

    await saveConfig(updatedConfig);

    // Clear the specific cached adapter for the removed exchange, then run
    // a full credential refresh so every other client/context rebuilds too.
    ExchangeFactory.removeFromCache(exchange.type, {
      apiKey: exchange.apiKey,
      apiSecret: exchange.apiSecret,
      walletPrivateKey: exchange.walletPrivateKey,
    });
    await refreshRuntimeCredentials();

    logger.info('Removed exchange', { exchangeId, type: exchange.type });

    return {
      success: true,
      message: `Removed exchange "${exchangeId}" (${exchange.type})`,
      data: {
        removedExchange: {
          id: exchange.id,
          type: exchange.type,
        },
        newActiveId,
      },
    };
  } catch (error) {
    return {
      success: false,
      message: `Failed to remove exchange: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Check connection status for all exchanges
 * Usage: /exchange status
 */
export async function exchangeStatus(): Promise<ExchangeCommandResult> {
  try {
    const config = await loadConfig();
    const exchanges = config.exchanges || [];

    if (exchanges.length === 0) {
      return {
        success: true,
        message: 'No exchanges configured',
        data: { statuses: [] },
      };
    }

    const statuses: Array<{
      id: string;
      type: ExchangeId;
      isActive: boolean;
      connected: boolean;
      error?: string;
      rateLimitStatus?: {
        usagePercent: number;
        isThrottling: boolean;
      };
    }> = [];

    for (const exchangeConfig of exchanges) {
      try {
        const exchange = ExchangeFactory.create(exchangeConfig.type, {
          apiKey: exchangeConfig.apiKey,
          apiSecret: exchangeConfig.apiSecret,
          passphrase: exchangeConfig.passphrase,
          walletPrivateKey: exchangeConfig.walletPrivateKey,
          sandbox: exchangeConfig.sandbox,
          live: exchangeConfig.live,
        });

        const connected = await exchange.testConnection();
        const rateLimitStatus = exchange.getRateLimitStatus();

        statuses.push({
          id: exchangeConfig.id,
          type: exchangeConfig.type,
          isActive: exchangeConfig.id === config.activeExchangeId,
          connected,
          rateLimitStatus: {
            usagePercent: Math.round(rateLimitStatus.usagePercent * 100),
            isThrottling: rateLimitStatus.isThrottling,
          },
        });
      } catch (error) {
        statuses.push({
          id: exchangeConfig.id,
          type: exchangeConfig.type,
          isActive: exchangeConfig.id === config.activeExchangeId,
          connected: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const connectedCount = statuses.filter((s) => s.connected).length;

    return {
      success: true,
      message: `${connectedCount}/${exchanges.length} exchange(s) connected`,
      data: { statuses },
    };
  } catch (error) {
    return {
      success: false,
      message: `Failed to check status: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Compare prices for a symbol across all configured exchanges
 * Usage: /exchange compare <symbol>
 */
export async function exchangeCompare(symbol: string): Promise<ExchangeCommandResult> {
  try {
    if (!symbol) {
      return {
        success: false,
        message: 'Usage: /exchange compare <symbol> (e.g., /exchange compare BTCUSDT)',
      };
    }

    const normalizedSymbol = symbol.toUpperCase();
    const config = await loadConfig();
    const exchanges = config.exchanges || [];

    if (exchanges.length === 0) {
      return {
        success: false,
        message: 'No exchanges configured. Use "/exchange add <type>" to add one.',
      };
    }

    const prices: Array<{
      exchangeId: string;
      exchangeType: ExchangeId;
      price: number | null;
      error?: string;
    }> = [];

    for (const exchangeConfig of exchanges) {
      try {
        const exchange = ExchangeFactory.create(exchangeConfig.type, {
          apiKey: exchangeConfig.apiKey,
          apiSecret: exchangeConfig.apiSecret,
          passphrase: exchangeConfig.passphrase,
          walletPrivateKey: exchangeConfig.walletPrivateKey,
          sandbox: exchangeConfig.sandbox,
          live: exchangeConfig.live,
        });

        const price = await exchange.getPrice(normalizedSymbol);

        prices.push({
          exchangeId: exchangeConfig.id,
          exchangeType: exchangeConfig.type,
          price,
        });
      } catch (error) {
        prices.push({
          exchangeId: exchangeConfig.id,
          exchangeType: exchangeConfig.type,
          price: null,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    // Calculate statistics
    const validPrices = prices.filter((p) => p.price !== null).map((p) => p.price!);

    let stats = null;
    if (validPrices.length > 1) {
      const minPrice = Math.min(...validPrices);
      const maxPrice = Math.max(...validPrices);
      const avgPrice = validPrices.reduce((a, b) => a + b, 0) / validPrices.length;
      const spreadPercent = ((maxPrice - minPrice) / avgPrice) * 100;

      stats = {
        minPrice,
        maxPrice,
        avgPrice,
        spreadPercent: Math.round(spreadPercent * 100) / 100,
        bestBuy: prices.find((p) => p.price === minPrice)?.exchangeId,
        bestSell: prices.find((p) => p.price === maxPrice)?.exchangeId,
      };
    }

    return {
      success: true,
      message: `Price comparison for ${normalizedSymbol}`,
      data: {
        symbol: normalizedSymbol,
        prices,
        stats,
        successCount: validPrices.length,
        totalExchanges: exchanges.length,
      },
    };
  } catch (error) {
    return {
      success: false,
      message: `Failed to compare prices: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Get setup instructions for an exchange type
 */
/**
 * Check if an exchange uses wallet-based authentication
 */
function getExchangeSetupInstructions(type: ExchangeId, sandbox = false): string {
  const native = ccxtIdToNativeVenue(type);
  if (!native) {
    return getCcxtSetupInstructions(type as CcxtExchangeId, sandbox);
  }
  const sandboxInstructions: Partial<Record<NativeExchangeId, string>> = {
    binance: `
BINANCE TESTNET (paper trading, no real money)
1. Go to testnet.binance.vision and register/log in
2. Under API Management, generate an API key — testnet keys are issued instantly
3. The testnet auto-funds your account with virtual BTC, ETH, BNB, etc.
4. Set sandbox: true in the exchange config; Gordon will route to testnet.binance.vision
5. Endpoint: https://testnet.binance.vision`,

    coinbase: `
COINBASE ADVANCED TRADE SANDBOX
Option A — Legacy REST (API Key + Secret + Passphrase):
  1. Register at sandbox.pro.coinbase.com (separate account from live)
  2. Go to Settings > API Keys and create a key with Trade permissions
  3. Save the API Key, Secret, and Passphrase (shown once)

Option B — CDP Advanced Trade (EC private key, recommended):
  1. Go to cdp.coinbase.com > API Keys > Create API Key
  2. Select "Advanced Trade" scope on the sandbox environment
  3. Download the JSON — apiKey = organizations/{org}/apiKeys/{key}, apiSecret = PEM private key`,

    okx: `
OKX DEMO ACCOUNT (paper trading)
1. Log in to OKX and go to API > Create V5 API Key
2. Enable "Read" + "Trade" permissions
3. In the Gordon config, set sandbox: true — Gordon sends x-simulated-trading: 1 header
4. Demo balance is auto-funded on first use`,

    gemini: `
GEMINI SANDBOX
1. Register at exchange.sandbox.gemini.com (separate from live)
2. Go to Settings > API and create a key with "Trader" scope
3. Use the sandbox API Key and Secret — same format as live
4. Endpoint: https://api.sandbox.gemini.com`,

    hyperliquid: `
HYPERLIQUID TESTNET
1. Generate a new Ethereum wallet (or use an existing test wallet)
2. Export the private key — same format as live (0x-prefixed hex)
3. Deposit test USDC from the Hyperliquid testnet faucet
4. Gordon routes to testnet.hyperliquid.xyz when sandbox: true
5. Endpoint: https://api.hyperliquid-testnet.xyz`,

    kraken: `
KRAKEN DEMO (Beta)
1. Register a separate demo account at demo.kraken.com
2. Go to Security > API and create an API key with "Query" + "Trade" permissions
3. Copy the API Key and Private Key
4. Note: Kraken demo is not available in all regions`,
  };

  const liveInstructions: Partial<Record<NativeExchangeId, string>> = {
    binance: `
1. Log in to Binance and go to API Management
2. Create a new API key with "Enable Reading" and optionally "Enable Spot Trading"
3. Copy the API Key and Secret Key (Secret is shown only once!)
4. Optional: Add your IP to the whitelist for extra security`,
    coinbase: `
1. Log in to Coinbase and go to API Keys (cdp.coinbase.com)
2. Create a new key with "Advanced Trade" scope
3. Download the JSON — apiKey is the organizations/.../apiKeys/... path, apiSecret is the EC private key (PEM)
4. For legacy REST: use API Key + Secret + Passphrase from exchange.coinbase.com > Settings > API`,
    kraken: `
1. Log in to Kraken and go to Settings > API
2. Create a new API key with desired permissions
3. Copy the API Key and Private Key`,
    bitfinex: `
1. Log in to Bitfinex and go to Account > API
2. Create a new API key
3. Enable "Account Read" and "Orders Read/Write" permissions
4. Copy the API Key and API Secret`,
    binance_us: `
1. Log in to Binance US (binance.us) and go to API Management
2. Create a new API key with "Enable Reading" and optionally "Enable Spot Trading"
3. Copy the API Key and Secret Key (Secret is shown only once!)
4. Optional: Add your IP to the whitelist for extra security
5. Note: Some features (earn, dust, transfers) are not available on Binance US`,
    hyperliquid: `
1. Generate a new Ethereum wallet or use an existing one
2. Export the private key from your wallet (MetaMask: Account Details > Export Private Key)
3. IMPORTANT: Use a DEDICATED trading wallet with limited funds
4. Fund your Hyperliquid account by depositing USDC on Arbitrum
5. Note: Hyperliquid uses wallet-based auth (no API key needed)`,
    robinhood: `
1. Open Robinhood Crypto API settings and create API credentials
2. Copy your API key and private signing key
3. Use /setup and enter:
   - API Key -> ROBINHOOD_API_KEY
   - API Secret -> ROBINHOOD_API_SECRET (private key)
4. Keep your private key encrypted and never commit it`,
    okx: `
1. Log in to OKX and go to API > Create V5 API Key
2. Enable "Read" + "Trade" permissions (no withdrawals)
3. Copy the API Key, Secret Key, and Passphrase — all three are required
4. Optional: restrict by IP allowlist`,
    gemini: `
OAuth 2.0 (preferred):
  /oauth connect gemini <clientId> <clientSecret>
  → browser login captures the access token automatically

Or HMAC API keys:
  1. Log in to Gemini and go to Settings > API
  2. Create a new key with "Auditor" or "Trader" scopes
  3. Copy the API Key and API Secret (Secret shown only once)`,
  };

  if (sandbox) {
    return sandboxInstructions[native] ?? `No dedicated testnet for ${type}. Check the exchange docs for a sandbox or demo environment.`;
  }
  return liveInstructions[native] ?? 'Follow the exchange documentation to create API keys.';
}

// ============================================================================
// Command Router
// ============================================================================

/**
 * Handle exchange command routing
 * @param args - Full arguments string (e.g., "list", "add binance", "switch binance_1")
 */
/** Known subcommands — anything else is treated as an exchange ID to switch to. */
const EXCHANGE_SUBCOMMANDS = new Set([
  'list', 'ls', 'add', 'new', 'switch', 'use', 'select',
  'remove', 'delete', 'rm', 'status', 'check', 'compare',
  'cmp', 'prices', 'help', 'setup', 'paper', 'sandbox',
]);

export async function handleExchangeCommand(args: string): Promise<string> {
  const parts = args.trim().split(/\s+/);
  const subcommand = parts[0]?.toLowerCase() ?? 'list';
  const subArgs = parts.slice(1);

  let result: ExchangeCommandResult;

  // If the first token doesn't match any known subcommand, treat it as a
  // direct exchange ID to switch to (e.g. "/exchange binance-testnet").
  if (subcommand && !EXCHANGE_SUBCOMMANDS.has(subcommand)) {
    result = await exchangeSwitch(subcommand);
    return formatExchangeResult(result);
  }

  switch (subcommand) {
    case 'list':
    case 'ls':
    case '':
      result = await exchangeList();
      break;

    case 'add':
    case 'new':
      if (subArgs.length === 0 || !subArgs[0]) {
        result = {
          success: false,
          message: `Usage: /exchange add <type> [--sandbox]\nNative types: ${ExchangeFactory.getSupportedExchanges().join(', ')}\n\nCCXT-routed (107 exchanges): ccxt:bybit, ccxt:kucoin, ccxt:mexc, ccxt:crypto_com, ccxt:<any-ccxt-sub-id>\n\nFor testnet/paper setups: /exchange add binance --sandbox`,
        };
      } else {
        const isSandbox = subArgs.includes('--sandbox') || subArgs.includes('--paper') || subArgs.includes('--testnet');
        result = await exchangeAdd(subArgs[0], isSandbox);
      }
      break;

    case 'switch':
    case 'use':
    case 'select':
      if (subArgs.length === 0 || !subArgs[0]) {
        result = {
          success: false,
          message: 'Usage: /exchange switch <id>',
        };
      } else {
        result = await exchangeSwitch(subArgs[0]);
      }
      break;

    case 'remove':
    case 'delete':
    case 'rm':
      if (subArgs.length === 0 || !subArgs[0]) {
        result = {
          success: false,
          message: 'Usage: /exchange remove <id>',
        };
      } else {
        result = await exchangeRemove(subArgs[0]);
      }
      break;

    case 'status':
    case 'check':
      result = await exchangeStatus();
      break;

    case 'compare':
    case 'cmp':
    case 'prices':
      result = await exchangeCompare(subArgs.join(' '));
      break;

    case 'setup':
    case 'paper':
    case 'sandbox': {
      // /exchange setup <type>  or  /exchange paper <type>
      const sandboxType = subArgs[0]?.toLowerCase();
      if (!sandboxType) {
        result = {
          success: true,
          message: `Paper/Testnet Setup — which exchange?\n\nSupported sandbox venues:\n  ccxt:binance     → Binance Testnet (testnet.binance.vision)\n  ccxt:coinbase    → Coinbase Advanced Trade Sandbox\n  ccxt:okx         → OKX Demo Account\n  ccxt:gemini      → Gemini Sandbox\n  ccxt:hyperliquid → Hyperliquid Testnet\n  ccxt:kraken      → Kraken Demo\n  ccxt:<sub-id>    → CCXT setSandboxMode(true) — ~30 of 107 exchanges; others no-op\n\nUsage: /exchange setup <type>\nExample: /exchange setup ccxt:binance  OR  /exchange setup ccxt:bybit\n(Bare ids like "binance" are accepted as aliases and saved as ccxt:*)`,
        };
      } else {
        result = await exchangeAdd(sandboxType, true);
      }
      break;
    }

    case 'help':
      result = {
        success: true,
        message: `Exchange Management Commands:
  /exchange list                - List configured exchanges
  /exchange add <type>          - Add a live exchange
  /exchange add <type> --sandbox  - Add sandbox/testnet (paper trading)
  /exchange setup <type>        - Setup guide for testnet/paper exchanges
  /exchange switch <id>         - Switch active exchange
  /exchange <id>                - Shortcut: switch directly by ID
  /exchange remove <id>         - Remove an exchange
  /exchange status              - Check connection status
  /exchange compare <symbol>    - Compare prices across exchanges

Native exchange types: ${ExchangeFactory.getSupportedExchanges().join(', ')}

Paper trading venues: binance (testnet), coinbase (sandbox), okx (demo), gemini (sandbox), hyperliquid (testnet), kraken (demo)

${getCcxtHelpFragment()}

Aliases: /ex, /exchanges`,
      };
      break;

    default:
      result = {
        success: false,
        message: `Unknown subcommand: ${subcommand}. Use "/exchange help" for available commands.`,
      };
  }

  // Format the result as a string for display
  return formatExchangeResult(result);
}

/**
 * Format an exchange command result for display
 */
function formatExchangeResult(result: ExchangeCommandResult): string {
  const lines: string[] = [];

  if (!result.success) {
    lines.push(`Error: ${result.message}`);
  } else {
    lines.push(result.message);
  }

  // Format additional data based on type
  if (result.data) {
    const data = result.data as Record<string, unknown>;

    // Exchange list
    if (Array.isArray(data.exchanges)) {
      const exchanges = data.exchanges as Array<{
        id: string;
        type: string;
        isActive: boolean;
        sandbox: boolean;
        apiKeyPrefix?: string;
      }>;

      if (exchanges.length > 0) {
        lines.push('');
        for (const ex of exchanges) {
          const status = ex.isActive ? '[ACTIVE]' : '';
          const sandbox = ex.sandbox ? '[SANDBOX]' : '';
          lines.push(`  ${ex.id} (${ex.type}) ${status} ${sandbox}`.trim());
        }
      }
    }

    // Status list
    if (Array.isArray(data.statuses)) {
      const statuses = data.statuses as Array<{
        id: string;
        type: string;
        isActive: boolean;
        connected: boolean;
        error?: string;
        rateLimitStatus?: { usagePercent: number; isThrottling: boolean };
      }>;

      if (statuses.length > 0) {
        lines.push('');
        for (const status of statuses) {
          const connIcon = status.connected ? '[OK]' : '[DISCONNECTED]';
          const activeLabel = status.isActive ? ' (active)' : '';
          const throttle = status.rateLimitStatus?.isThrottling ? ' [THROTTLED]' : '';
          lines.push(`  ${status.id}${activeLabel}: ${connIcon}${throttle}`);
          if (status.error) {
            lines.push(`    Error: ${status.error}`);
          }
        }
      }
    }

    // Price comparison
    if (Array.isArray(data.prices)) {
      const prices = data.prices as Array<{
        exchangeId: string;
        exchangeType: string;
        price: number | null;
        error?: string;
      }>;

      if (prices.length > 0) {
        lines.push('');
        for (const p of prices) {
          if (p.price !== null) {
            lines.push(`  ${p.exchangeId}: $${p.price.toLocaleString()}`);
          } else {
            lines.push(`  ${p.exchangeId}: N/A (${p.error || 'unknown error'})`);
          }
        }

        const stats = data.stats as {
          minPrice: number;
          maxPrice: number;
          avgPrice: number;
          spreadPercent: number;
          bestBuy?: string;
          bestSell?: string;
        } | null;

        if (stats) {
          lines.push('');
          lines.push(`  Spread: ${stats.spreadPercent}%`);
          lines.push(`  Best buy: ${stats.bestBuy} ($${stats.minPrice.toLocaleString()})`);
          lines.push(`  Best sell: ${stats.bestSell} ($${stats.maxPrice.toLocaleString()})`);
        }
      }
    }

    // Setup instructions
    if (data.instructions) {
      lines.push('');
      lines.push('Setup Instructions:');
      lines.push(data.instructions as string);
    }
  }

  return lines.join('\n');
}
