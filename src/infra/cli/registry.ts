/**
 * CLI Registry — Known Trading CLIs
 *
 * Catalog of trading-relevant CLI tools that Gordon can invoke via shell.
 * Unlike MCP servers (protocol-based), CLIs are called via Bash execution.
 * Gordon needs to know the command syntax and available subcommands.
 *
 * Each entry describes: what it is, how to install it, key commands,
 * and whether Gordon also has native tool coverage for the same features.
 */

// ============================================================================
// Types
// ============================================================================

export interface CLIEntry {
  id: string;
  name: string;
  description: string;
  /** npm package name for `npm install -g`. */
  npmPackage?: string;
  /** Install command (if not npm). */
  installCommand?: string;
  /** Binary name (what to type in terminal). */
  bin: string;
  /** Key subcommands Gordon should know about. */
  commands: CLICommand[];
  /** Does Gordon already have native tools covering this? */
  nativeCoverage: "full" | "partial" | "none";
  /** If native coverage exists, which Gordon tools overlap. */
  nativeTools?: string[];
  /** Required env vars or credentials. */
  credentials: Array<{ env: string; required: boolean; description?: string }>;
  /** Docs URL. */
  docsUrl: string;
  /** Supported chains/markets. */
  markets?: string[];
  /** Whether it also has an MCP server. */
  hasMCP: boolean;
  /** Pricing. */
  pricing: "free" | "freemium" | "paid";
  pricingNote?: string;
}

export interface CLICommand {
  command: string;
  description: string;
  /** Example invocation. */
  example?: string;
}

// ============================================================================
// Registry
// ============================================================================

export const CLI_REGISTRY: CLIEntry[] = [
  {
    id: "moonpay",
    name: "MoonPay CLI",
    description: "Wallet funding, onramp/offramp, swaps, bridges, DCA, limit orders. Agent-native crypto payments.",
    npmPackage: "@moonpay/cli",
    bin: "mp",
    commands: [
      { command: "mp buy", description: "Buy crypto with fiat", example: "mp buy --currency eth --amount 100 --fiat usd" },
      { command: "mp sell", description: "Sell crypto to fiat", example: "mp sell --currency eth --amount 0.1" },
      { command: "mp swap", description: "Swap tokens", example: "mp swap --from eth --to usdc --amount 0.5" },
      { command: "mp bridge", description: "Cross-chain bridge", example: "mp bridge --from ethereum --to base --token usdc --amount 100" },
      { command: "mp wallet", description: "Wallet management", example: "mp wallet create" },
      { command: "mp quote", description: "Get live quote", example: "mp quote --mode buy --currency eth --amount 100" },
      { command: "mp limits", description: "Check currency limits", example: "mp limits --currency eth" },
      { command: "mp history", description: "Transaction history", example: "mp history --limit 10" },
      { command: "mp mcp", description: "Start MCP server mode", example: "mp mcp" },
    ],
    nativeCoverage: "full",
    nativeTools: [
      "moonpay_funding_link", "moonpay_swap_link", "moonpay_quote",
      "moonpay_currency_limits", "moonpay_transactions", "moonpay_customer_limits",
      "moonpay_swap_pairs", "moonpay_virtual_accounts",
    ],
    credentials: [
      { env: "MOONPAY_API_KEY", required: true },
      { env: "MOONPAY_SECRET_KEY", required: false, description: "For server-side signing" },
    ],
    docsUrl: "https://www.moonpay.com/agents",
    markets: ["crypto"],
    hasMCP: true,
    pricing: "free",
    pricingNote: "Zero-fee stablecoin onramp. Standard fees for other assets.",
  },
  {
    id: "boba",
    name: "Boba CLI",
    description: "AI agent trading toolkit — DEX swaps, limit orders, DCA, TWAP, perps, prediction markets, portfolio tracking, copy trading, honeypot detection.",
    npmPackage: "@tradeboba/cli",
    bin: "boba",
    commands: [
      { command: "boba swap", description: "DEX token swap", example: "boba swap --from ETH --to USDC --amount 0.5 --chain base" },
      { command: "boba limit", description: "Place limit order", example: "boba limit --buy ETH --at 3000 --spend 500 --chain ethereum" },
      { command: "boba dca", description: "Dollar-cost average", example: "boba dca --buy ETH --amount 100 --every week --for 12" },
      { command: "boba twap", description: "Time-weighted average price order", example: "boba twap --sell ETH --amount 10 --over 24h" },
      { command: "boba perps", description: "Perpetual futures (Hyperliquid)", example: "boba perps --long BTC --size 1000 --leverage 5x" },
      { command: "boba predict", description: "Prediction markets (Polymarket)", example: "boba predict --market 'BTC 100k' --position yes --amount 50" },
      { command: "boba portfolio", description: "Portfolio overview", example: "boba portfolio --chain all" },
      { command: "boba track", description: "Track KOL/whale wallets", example: "boba track --wallet 0x... --alerts on" },
      { command: "boba copy", description: "Copy trading", example: "boba copy --wallet 0x... --max-size 100" },
      { command: "boba scan", description: "Token scanner + honeypot detection", example: "boba scan --token 0x... --chain base" },
      { command: "boba launch", description: "Token launch tools", example: "boba launch --name MyToken --chain base" },
      { command: "boba mcp", description: "Start MCP server mode", example: "boba mcp" },
    ],
    nativeCoverage: "partial",
    nativeTools: [
      "solana_trade", "place_market_order", "place_limit_order",
      "get_portfolio", "scan_market",
    ],
    credentials: [
      { env: "BOBA_API_KEY", required: false, description: "Optional — some features work without" },
      { env: "WALLET_PRIVATE_KEY", required: true, description: "For on-chain execution" },
    ],
    docsUrl: "https://agents.boba.xyz",
    markets: ["crypto"],
    hasMCP: true,
    pricing: "freemium",
    pricingNote: "Free for basic features. Premium for copy trading, KOL tracking.",
  },
  {
    id: "hummingbot",
    name: "Hummingbot",
    description: "Open-source market making and trading bot framework. Runs strategies locally.",
    installCommand: "docker pull hummingbot/hummingbot",
    bin: "hummingbot",
    commands: [
      { command: "hummingbot start", description: "Start a strategy", example: "hummingbot start --strategy pure_market_making" },
      { command: "hummingbot status", description: "Check running strategies" },
      { command: "hummingbot stop", description: "Stop active strategy" },
      { command: "hummingbot balance", description: "Check exchange balances" },
      { command: "hummingbot history", description: "Trade history" },
    ],
    nativeCoverage: "none",
    credentials: [
      { env: "HUMMINGBOT_API_URL", required: true },
      { env: "HUMMINGBOT_USERNAME", required: true },
      { env: "HUMMINGBOT_PASSWORD", required: true },
    ],
    docsUrl: "https://hummingbot.org/",
    markets: ["crypto"],
    hasMCP: true,
    pricing: "free",
    pricingNote: "Open source (Apache 2.0). Self-hosted.",
  },
  {
    id: "alpaca-cli",
    name: "Alpaca CLI",
    description: "Commission-free stock, ETF, options, and crypto trading from the terminal.",
    installCommand: "pip install alpaca-py",
    bin: "alpaca",
    commands: [
      { command: "alpaca orders list", description: "List open orders" },
      { command: "alpaca positions", description: "Current positions" },
      { command: "alpaca account", description: "Account info + buying power" },
      { command: "alpaca bars", description: "Historical price bars" },
    ],
    nativeCoverage: "full",
    nativeTools: [
      "place_market_order", "place_limit_order", "cancel_order",
      "get_portfolio", "get_open_orders", "get_trade_history",
    ],
    credentials: [
      { env: "ALPACA_API_KEY", required: true },
      { env: "ALPACA_SECRET_KEY", required: true },
    ],
    docsUrl: "https://docs.alpaca.markets/",
    markets: ["stocks", "crypto"],
    hasMCP: true,
    pricing: "free",
    pricingNote: "Commission-free trading.",
  },
];

// ============================================================================
// Query API
// ============================================================================

/**
 * Get all registered CLIs.
 */
export function getAllCLIs(): CLIEntry[] {
  return CLI_REGISTRY;
}

/**
 * Get a CLI by ID.
 */
export function getCLI(id: string): CLIEntry | undefined {
  return CLI_REGISTRY.find((c) => c.id === id);
}

/**
 * Get CLIs that Gordon doesn't have native coverage for (most useful to install).
 */
export function getUncoveredCLIs(): CLIEntry[] {
  return CLI_REGISTRY.filter((c) => c.nativeCoverage !== "full");
}

/**
 * Check if a CLI binary is available on the system.
 */
export async function isCLIInstalled(bin: string): Promise<boolean> {
  try {
    const { execSync } = require("child_process") as typeof import("child_process");
    execSync(`which ${bin} 2>/dev/null || where ${bin} 2>NUL`, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/**
 * Format CLI registry for agent prompt injection.
 */
export function formatCLIRegistryForPrompt(): string {
  const lines = ["[GORDON_AVAILABLE_CLIS]"];
  for (const cli of CLI_REGISTRY) {
    const coverage = cli.nativeCoverage === "full" ? "(also native)" : cli.nativeCoverage === "partial" ? "(partial native)" : "";
    lines.push(`- ${cli.bin}: ${cli.description} ${coverage}`);
    for (const cmd of cli.commands.slice(0, 3)) {
      lines.push(`    ${cmd.command} — ${cmd.description}`);
    }
    if (cli.commands.length > 3) lines.push(`    ... +${cli.commands.length - 3} more commands`);
  }
  return lines.join("\n") + "\n";
}
