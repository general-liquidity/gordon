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
  {
    id: "kraken",
    name: "Kraken CLI",
    description: "First open-source CLI built for AI agents — 134 commands for crypto, stocks, forex, and derivatives. Paper trading, WebSocket streaming, dead man's switch.",
    installCommand: "curl --proto '=https' --tlsv1.2 -LsSf https://github.com/krakenfx/kraken-cli/releases/latest/download/kraken-cli-installer.sh | sh",
    bin: "kraken",
    commands: [
      { command: "kraken buy", description: "Place a buy order", example: "kraken buy --pair BTC/USD --amount 0.01 --type market" },
      { command: "kraken sell", description: "Place a sell order", example: "kraken sell --pair ETH/USD --amount 1 --type limit --price 4000" },
      { command: "kraken balance", description: "Account balances" },
      { command: "kraken orders", description: "Open orders" },
      { command: "kraken positions", description: "Open positions" },
      { command: "kraken ticker", description: "Live ticker data", example: "kraken ticker --pair BTC/USD" },
      { command: "kraken ohlc", description: "OHLC candle data", example: "kraken ohlc --pair BTC/USD --interval 60" },
      { command: "kraken trades", description: "Recent trades" },
      { command: "kraken depth", description: "Order book depth" },
      { command: "kraken futures", description: "Futures trading" },
      { command: "kraken staking", description: "Staking operations" },
      { command: "kraken cancel-after", description: "Dead man's switch — auto-cancel orders if process halts", example: "kraken cancel-after --timeout 60" },
      { command: "kraken --validate", description: "Simulate execution without placing orders (dry run)" },
      { command: "kraken --paper", description: "Paper trading against live prices, no credentials needed" },
      { command: "kraken mcp", description: "Start MCP server mode — exposes all 134 commands via MCP" },
    ],
    nativeCoverage: "partial",
    nativeTools: [
      "get_price", "get_candles", "get_orderbook", "get_portfolio",
      "place_market_order", "place_limit_order", "cancel_order", "get_open_orders",
    ],
    credentials: [
      { env: "KRAKEN_API_KEY", required: false, description: "Not needed for market data or paper trading" },
      { env: "KRAKEN_API_SECRET", required: false, description: "Required only for live trading" },
    ],
    docsUrl: "https://www.kraken.com/kraken-cli",
    markets: ["crypto", "stocks", "forex", "derivatives"],
    hasMCP: true,
    pricing: "free",
    pricingNote: "Open source (MIT). Paper trading free, no credentials. Live trading requires Kraken account.",
  },
  {
    id: "openbb",
    name: "OpenBB CLI",
    description: "All-in-one investment research terminal — 40+ data providers, screening, fundamentals, economic data, charting. 62K+ GitHub stars.",
    installCommand: "pip install openbb",
    bin: "openbb",
    commands: [
      { command: "openbb", description: "Launch interactive research terminal" },
      { command: "openbb economy", description: "Macroeconomic data (GDP, CPI, rates)", example: "openbb economy gdp --country US" },
      { command: "openbb equity", description: "Stock fundamentals + technicals", example: "openbb equity price --symbol AAPL" },
      { command: "openbb crypto", description: "Crypto market data", example: "openbb crypto price --symbol BTC" },
      { command: "openbb forex", description: "Forex pairs and rates", example: "openbb forex quote --symbol EURUSD" },
      { command: "openbb options", description: "Options chains and Greeks", example: "openbb options chains --symbol AAPL" },
      { command: "openbb etf", description: "ETF screening and analysis" },
      { command: "openbb fixedincome", description: "Bonds, Treasury yields, FRED data" },
      { command: "openbb technical", description: "Technical indicators on any asset" },
      { command: "openbb quantitative", description: "Statistical analysis and risk metrics" },
    ],
    nativeCoverage: "partial",
    nativeTools: [
      "get_fundamentals", "get_price", "compute_indicators",
      "screen_stocks", "get_insider_trades",
    ],
    credentials: [
      { env: "OPENBB_TOKEN", required: false, description: "Optional — enhances some data providers" },
    ],
    docsUrl: "https://docs.openbb.co/",
    markets: ["stocks", "crypto", "forex", "options", "etfs", "bonds", "economy"],
    hasMCP: false,
    pricing: "free",
    pricingNote: "Open source. Some data providers require their own API keys.",
  },
  {
    id: "lean",
    name: "LEAN CLI (QuantConnect)",
    description: "Local algorithmic trading development — write strategies in Python/C#, backtest against QuantConnect's data library, optimize, deploy to live.",
    installCommand: "pip install lean",
    bin: "lean",
    commands: [
      { command: "lean init", description: "Initialize a new LEAN project" },
      { command: "lean backtest", description: "Run a local backtest", example: "lean backtest 'My Strategy'" },
      { command: "lean optimize", description: "Parameter optimization", example: "lean optimize 'My Strategy'" },
      { command: "lean live", description: "Deploy to live trading", example: "lean live 'My Strategy' --brokerage alpaca" },
      { command: "lean cloud backtest", description: "Run backtest on QuantConnect cloud" },
      { command: "lean research", description: "Launch Jupyter research notebook" },
      { command: "lean data download", description: "Download historical data" },
      { command: "lean report", description: "Generate strategy report" },
    ],
    nativeCoverage: "partial",
    nativeTools: [
      "backtest_strategy", "optimize_strategy", "compare_backtests",
    ],
    credentials: [
      { env: "QC_USER_ID", required: false, description: "QuantConnect user ID (for cloud features)" },
      { env: "QC_API_TOKEN", required: false, description: "QuantConnect API token" },
    ],
    docsUrl: "https://www.lean.io/docs/v2/lean-cli",
    markets: ["stocks", "crypto", "forex", "futures", "options"],
    hasMCP: false,
    pricing: "freemium",
    pricingNote: "Free for local backtesting. QuantConnect cloud: free tier + paid plans from $8/mo.",
  },
  {
    id: "jupiter",
    name: "Jupiter CLI",
    description: "Official Jupiter DEX CLI — spot swaps, perps (leveraged longs/shorts), lending, prediction markets, token verification. Dominant Solana DEX aggregator.",
    npmPackage: "@jup-ag/cli",
    bin: "jup",
    commands: [
      { command: "jup swap", description: "Swap tokens via Jupiter aggregator", example: "jup swap --from SOL --to USDC --amount 1" },
      { command: "jup portfolio", description: "View portfolio holdings" },
      { command: "jup perps open", description: "Open leveraged position", example: "jup perps open --long SOL --size 100 --leverage 3x" },
      { command: "jup perps close", description: "Close perpetual position" },
      { command: "jup lend deposit", description: "Deposit into lending pool", example: "jup lend deposit --token USDC --amount 1000" },
      { command: "jup lend withdraw", description: "Withdraw from lending" },
      { command: "jup predict", description: "Browse prediction markets" },
      { command: "jup predict buy", description: "Buy prediction market shares" },
      { command: "jup vrfd check", description: "Check token verification status" },
    ],
    nativeCoverage: "partial",
    nativeTools: [
      "solana_trade", "solana_fetch_price", "solana_get_token_data",
    ],
    credentials: [
      { env: "SOLANA_PRIVATE_KEY", required: true, description: "Solana wallet for execution" },
      { env: "RPC_URL", required: false, description: "Custom Solana RPC endpoint" },
    ],
    docsUrl: "https://github.com/jup-ag/cli",
    markets: ["crypto"],
    hasMCP: false,
    pricing: "free",
    pricingNote: "Free. Official Jupiter CLI. Pre-v1 alpha — may have breaking changes.",
  },
  {
    id: "visa-cli",
    name: "Visa CLI",
    description: "Agent payments — let Gordon pay for premium data feeds, APIs, and services on-demand via Visa.",
    installCommand: "npm i -g visa-cli",
    bin: "visa-cli",
    commands: [
      { command: "visa-cli init", description: "Initialize Visa CLI" },
      { command: "visa-cli enroll-card", description: "Enroll a Visa card for payments" },
      { command: "visa-cli cards", description: "List enrolled cards" },
      { command: "visa-cli pay", description: "Pay for a service", example: "visa-cli pay https://api.example.com/data" },
      { command: "visa-cli status", description: "Check payment status" },
      { command: "visa-cli install claude", description: "Configure for Claude Code / AI agents" },
    ],
    nativeCoverage: "none",
    credentials: [
      { env: "VISA_CLI_TOKEN", required: true, description: "GitHub OAuth enrollment required (closed beta)" },
    ],
    docsUrl: "https://visacli.sh/",
    markets: ["payments"],
    hasMCP: false,
    pricing: "freemium",
    pricingNote: "Closed beta. Spending limits apply. Visa card required.",
  },
  {
    id: "stripe-cli",
    name: "Stripe CLI",
    description: "Payment processing — create charges, manage subscriptions, send payouts, listen to webhooks from the terminal.",
    installCommand: "brew install stripe/stripe-cli/stripe",
    bin: "stripe",
    commands: [
      { command: "stripe login", description: "Authenticate with Stripe account" },
      { command: "stripe listen", description: "Listen for webhooks locally", example: "stripe listen --forward-to localhost:3000/webhook" },
      { command: "stripe trigger", description: "Trigger test events", example: "stripe trigger payment_intent.succeeded" },
      { command: "stripe charges create", description: "Create a charge", example: "stripe charges create --amount 1000 --currency usd" },
      { command: "stripe payouts create", description: "Send a payout" },
      { command: "stripe balance", description: "Check Stripe balance" },
      { command: "stripe customers list", description: "List customers" },
    ],
    nativeCoverage: "none",
    credentials: [
      { env: "STRIPE_API_KEY", required: true, description: "Stripe secret key (sk_live_ or sk_test_)" },
    ],
    docsUrl: "https://stripe.com/docs/cli",
    markets: ["payments"],
    hasMCP: false,
    pricing: "freemium",
    pricingNote: "Free CLI. Stripe charges 2.9% + 30¢ per transaction.",
  },
  {
    id: "skills",
    name: "Skills CLI (open agent skills ecosystem)",
    description: "Official agent-skill installer maintained by Vercel Labs (skills.sh). Hub-agnostic — pulls SKILL.md files from any Git URL (binance-skills-hub, vercel-labs/agent-skills, custom org repos) into the standard agent-skills directory so Gordon's skill-loader picks them up alongside its own. This is how Binance intends their Skills Hub to be consumed; we don't wrap it, we register the canonical installer.",
    npmPackage: "skills",
    bin: "skills",
    commands: [
      { command: "skills add <repo>", description: "Install a skill pack from a GitHub repo URL or org/name shortform", example: "npx skills add binance/binance-skills-hub" },
      { command: "skills add (alt)", description: "Full URL form for non-GitHub sources or community packs", example: "npx skills add https://github.com/vercel-labs/agent-skills" },
      { command: "skills list", description: "Show installed skill packs" },
      { command: "skills remove <id>", description: "Uninstall a skill pack" },
      { command: "skills update", description: "Pull latest version of installed packs" },
    ],
    nativeCoverage: "none",
    credentials: [],
    docsUrl: "https://skills.sh/docs",
    markets: ["agent-tooling"],
    hasMCP: false,
    pricing: "free",
    pricingNote: "Free, open-source (github.com/vercel-labs/skills, 16K+ stars). Skills installed via this tool inherit the underlying repo's license — Binance Skills Hub is MIT.",
  },
  {
    id: "binance-cli",
    name: "Binance CLI",
    description: "Official Binance CLI — full Spot, Futures (USDS-M / COIN-M), Options, Margin, Convert, Earn, Copy-Trading, Sub-Account, VIP Loan, Mining, Pay, Gift Card, Algo, Alpha, Dual Investment, and more. 25+ product groups, 200+ subcommands.",
    npmPackage: "@binance/binance-cli",
    bin: "binance-cli",
    commands: [
      { command: "binance-cli profile create", description: "Create an auth profile (one-time setup)", example: "binance-cli profile create --name main --api-key <KEY> --api-secret <SECRET> --env prod" },
      { command: "binance-cli profile select", description: "Switch active profile", example: "binance-cli profile select --name main" },
      { command: "binance-cli spot", description: "Spot trading (orders, balances, history, market data)", example: "binance-cli spot account-info" },
      { command: "binance-cli futures-usds", description: "USDS-margined perpetuals + delivery futures", example: "binance-cli futures-usds account-info" },
      { command: "binance-cli futures-coin", description: "COIN-margined futures" },
      { command: "binance-cli derivatives-options", description: "Options trading" },
      { command: "binance-cli margin-trading", description: "Cross/isolated margin" },
      { command: "binance-cli convert", description: "Instant convert between assets", example: "binance-cli convert quote --fromAsset USDT --toAsset BTC --fromAmount 100" },
      { command: "binance-cli simple-earn", description: "Flexible/locked savings, staking" },
      { command: "binance-cli wallet", description: "Wallet operations — deposits, withdrawals, transfers" },
      { command: "binance-cli copy-trading", description: "Copy-trading admin (lead/follower)" },
      { command: "binance-cli sub-account", description: "Sub-account management" },
      { command: "binance-cli alpha", description: "Binance Alpha (early-stage tokens)" },
      { command: "binance-cli pay", description: "Binance Pay payments" },
      { command: "binance-cli request", description: "Generic signed request — escape hatch for endpoints not in the dedicated subcommands", example: "binance-cli request GET /api/v3/account --signed" },
    ],
    nativeCoverage: "partial",
    nativeTools: [
      "place_market_order", "place_limit_order", "cancel_order",
      "get_portfolio", "get_open_orders", "get_trade_history",
      "get_price", "get_orderbook", "get_candles",
    ],
    credentials: [
      { env: "BINANCE_API_KEY", required: false, description: "Set via 'binance-cli profile create' or env var. Read-only queries can run unauthenticated." },
      { env: "BINANCE_SECRET_KEY", required: false, description: "Pair with BINANCE_API_KEY for authenticated calls." },
      { env: "BINANCE_API_ENV", required: false, description: "prod | demo | testnet (default: prod)" },
      { env: "BINANCE_SPOT_BASE_PATH", required: false, description: "Custom Spot base URL (testnet, regional, etc.)" },
    ],
    docsUrl: "https://github.com/binance/binance-cli",
    markets: ["crypto"],
    hasMCP: false,
    pricing: "free",
    pricingNote: "Free, MIT-licensed. Standard Binance trading fees apply.",
  },
  {
    id: "mpp",
    name: "Machine Payments Protocol",
    description: "HTTP 402 agent-to-agent payments — pay per API call, tool use, or data request. The open standard for the agentic economy.",
    npmPackage: "machine-payments-protocol",
    bin: "mpp",
    commands: [
      { command: "mpp init", description: "Initialize MPP in a project" },
      { command: "mpp pay", description: "Pay for a resource", example: "mpp pay https://api.data-provider.com/prices" },
      { command: "mpp serve", description: "Start an MPP-enabled server (charge for your API)" },
      { command: "mpp wallet", description: "Manage payment wallets" },
      { command: "mpp status", description: "Check payment status and receipts" },
      { command: "mpp config", description: "Configure payment methods (Stripe, stablecoins, Lightning)" },
    ],
    nativeCoverage: "none",
    credentials: [
      { env: "MPP_WALLET_KEY", required: true, description: "Wallet key for payments (Stripe, stablecoin, or Lightning)" },
    ],
    docsUrl: "https://mpp.dev/",
    markets: ["payments", "agentic-economy"],
    hasMCP: true,
    pricing: "free",
    pricingNote: "Open protocol. Transaction fees depend on payment rail (Stripe, stablecoins, Lightning).",
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
 * Check if a CLI binary is available on the system. Uses `where` on
 * Windows, `which` everywhere else — splitting by platform avoids the
 * mixed-syntax shell command that previously broke on pure Windows
 * (no bash) and pure POSIX (no `where`).
 */
export async function isCLIInstalled(bin: string): Promise<boolean> {
  try {
    const { execSync } = require("child_process") as typeof import("child_process");
    if (process.platform === "win32") {
      execSync(`where ${bin}`, { stdio: "ignore" });
    } else {
      execSync(`which ${bin}`, { stdio: "ignore" });
    }
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
