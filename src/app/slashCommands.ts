/**
 * Slash Commands System
 * Defines all available slash commands for quick actions
 */

/**
 * Command levels for progressive disclosure
 * - Level 1 (essential): Core commands for daily use
 * - Level 2 (advanced): Power user features
 * - Level 3 (expert): Advanced/experimental features
 */
export type CommandLevel = 1 | 2 | 3;

export interface SlashCommand {
  name: string;
  aliases: string[];
  description: string;
  usage: string;
  category: "trading" | "market" | "account" | "system" | "strategy";
  /** Command complexity level for progressive disclosure */
  level: CommandLevel;
  // Maps to agent or direct action
  action: "agent" | "tool" | "menu";
  target?: string; // Agent name or tool name
  /** Estimated execution time (e.g., "~3-5s") */
  executionTime?: string;
  /** Guidance on when to use this command */
  whenToUse?: string;
}

export const SLASH_COMMANDS: SlashCommand[] = [
  // Market Discovery
  {
    name: "scan",
    aliases: ["s"],
    description: "Scan market for trading opportunities (~10-30s depending on coins)",
    usage: "/scan",
    category: "market",
    level: 1,
    action: "agent",
    target: "scanner",
    executionTime: "~10-30s",
    whenToUse: "Discover opportunities across multiple coins",
  },
  {
    name: "trending",
    aliases: ["t", "hot"],
    description: "Show trending tokens (biggest movers)",
    usage: "/trending [gainers|losers]",
    category: "market",
    level: 1,
    action: "tool",
    target: "get_trending_tokens",
  },
  {
    name: "volume",
    aliases: ["v", "liquid"],
    description: "Show highest volume markets",
    usage: "/volume",
    category: "market",
    level: 2,
    action: "tool",
    target: "get_high_volume_tokens",
  },
  {
    name: "analyze",
    aliases: ["a", "quick"],
    description: "Single comprehensive analysis (~3-5s)",
    usage: "/analyze <symbol>",
    category: "market",
    level: 1,
    action: "agent",
    target: "analyst",
    executionTime: "~3-5s",
    whenToUse: "Quick check on a single coin",
  },
  {
    name: "whales",
    aliases: ["w", "flow"],
    description: "Detect whale orders and market flow bias",
    usage: "/whales <symbol>",
    category: "market",
    level: 2,
    action: "tool",
    target: "analyze_whale_orders",
  },
  {
    name: "breakouts",
    aliases: ["bo"],
    description: "Scan for breakout/breakdown setups",
    usage: "/breakouts [symbol]",
    category: "market",
    level: 2,
    action: "tool",
    target: "scan_breakouts",
  },
  {
    name: "score",
    aliases: ["sc"],
    description: "Get market score and trading signal",
    usage: "/score <symbol>",
    category: "market",
    level: 2,
    action: "tool",
    target: "score_market",
  },
  {
    name: "chart",
    aliases: ["c", "graph"],
    description: "Display price chart with indicators",
    usage: "/chart <symbol> [timeframe]",
    category: "market",
    level: 2,
    action: "tool",
    target: "generate_chart",
  },
  {
    name: "ta",
    aliases: ["tech", "technical"],
    description: "Quick technical analysis with chart",
    usage: "/ta <symbol> [timeframe]",
    category: "market",
    level: 2,
    action: "tool",
    target: "quick_ta",
  },
  {
    name: "candlestick",
    aliases: ["candles", "ohlc"],
    description: "Display candlestick chart with volume",
    usage: "/candlestick <symbol> [timeframe]",
    category: "market",
    level: 2,
    action: "tool",
    target: "display_candlestick_chart",
  },

  // Trading
  {
    name: "plan",
    aliases: ["p"],
    description: "Create a trade plan for a coin",
    usage: "/plan <symbol>",
    category: "trading",
    level: 1,
    action: "agent",
    target: "planner",
  },
  {
    name: "grid",
    aliases: ["g"],
    description: "Create a grid entry plan with multiple buy levels",
    usage: "/grid <symbol> [allocation]",
    category: "trading",
    level: 2,
    action: "tool",
    target: "create_grid_plan",
  },
  {
    name: "positions",
    aliases: ["pos"],
    description: "Check active positions",
    usage: "/positions",
    category: "trading",
    level: 2,
    action: "tool",
    target: "check_positions",
  },
  {
    name: "orders",
    aliases: ["o"],
    description: "View open orders",
    usage: "/orders",
    category: "trading",
    level: 2,
    action: "tool",
    target: "get_order_status",
  },
  {
    name: "arm",
    aliases: [],
    description: "Enable live trading (ARMED mode)",
    usage: "/arm",
    category: "trading",
    level: 2,
    action: "tool",
    target: "arm_system",
  },
  {
    name: "disarm",
    aliases: ["safe"],
    description: "Return to SAFE mode",
    usage: "/disarm",
    category: "trading",
    level: 2,
    action: "tool",
    target: "arm_system",
  },

  // Account
  {
    name: "portfolio",
    aliases: ["pf", "balance"],
    description: "View portfolio and balances",
    usage: "/portfolio",
    category: "account",
    level: 1,
    action: "menu",
    target: "portfolio",
  },
  {
    name: "earn",
    aliases: ["e", "savings"],
    description: "Earn products — browse, subscribe, redeem, view positions",
    usage: "/earn [positions|products|subscribe|redeem|history]",
    category: "account",
    level: 2,
    action: "agent",
    target: "executor",
    whenToUse: "Browse flexible/locked earn products, subscribe, redeem, or view positions and history",
  },
  {
    name: "history",
    aliases: ["h", "trades"],
    description: "View recent trade history",
    usage: "/history [symbol]",
    category: "account",
    level: 2,
    action: "tool",
    target: "get_trade_history",
  },

  // Backtesting
  {
    name: "backtest",
    aliases: ["bt", "test"],
    description: "Backtest a strategy on historical data",
    usage: "/backtest <strategy> <symbol> [timeframe] [days]",
    category: "trading",
    level: 2,
    action: "agent",
    target: "backtester",
  },
  {
    name: "optimize",
    aliases: ["opt"],
    description: "Optimize strategy parameters",
    usage: "/optimize <strategy> <symbol> [timeframe]",
    category: "trading",
    level: 2,
    action: "tool",
    target: "optimize_strategy",
  },
  {
    name: "compare",
    aliases: ["cmp"],
    description: "Compare multiple strategy backtests",
    usage: "/compare <symbol> [strategies...]",
    category: "trading",
    level: 2,
    action: "tool",
    target: "compare_backtests",
  },

  // Strategies
  {
    name: "strategies",
    aliases: ["strategy", "strat", "strats"],
    description: "View and manage trading strategies",
    usage: "/strategies [list|info|generate|backtest|compare]",
    category: "trading",
    level: 1,
    action: "tool",
    target: "handle_strategy_command",
    executionTime: "~1-5s",
    whenToUse: "Browse strategies, view details, or generate new ones",
  },
  {
    name: "gen",
    aliases: [],
    description: "Quick alias: Generate strategy from natural language",
    usage: "/gen <description>",
    category: "trading",
    level: 1,
    action: "tool",
    target: "handle_gen_command",
    executionTime: "~30-60s",
    whenToUse: "Quickly create a strategy from a description",
  },

  // Strategy Runtime
  {
    name: "deploy",
    aliases: ["run"],
    description: "Deploy a playbook as a live strategy",
    usage: "/deploy <playbook-name> [--capital <percent>]",
    category: "strategy",
    level: 2,
    action: "agent",
    target: "planner",
    executionTime: "~2-3s",
    whenToUse: "Activate a playbook strategy with capital allocation",
  },
  {
    name: "strategies-live",
    aliases: ["sl", "running", "live"],
    description: "List running strategies and portfolio state",
    usage: "/strategies-live",
    category: "strategy",
    level: 1,
    action: "agent",
    target: "planner",
    executionTime: "~1-2s",
    whenToUse: "See what strategies are active and their performance",
  },
  {
    name: "pause",
    aliases: [],
    description: "Pause a running strategy slot",
    usage: "/pause <slot-id|playbook-name>",
    category: "strategy",
    level: 2,
    action: "agent",
    target: "planner",
  },
  {
    name: "resume-strategy",
    aliases: ["unpause"],
    description: "Resume a paused strategy slot",
    usage: "/resume-strategy <slot-id|playbook-name>",
    category: "strategy",
    level: 2,
    action: "agent",
    target: "planner",
  },
  {
    name: "stop",
    aliases: ["drain"],
    description: "Stop and drain a running strategy",
    usage: "/stop <slot-id|playbook-name>",
    category: "strategy",
    level: 2,
    action: "agent",
    target: "planner",
  },
  {
    name: "rebalance",
    aliases: ["rb"],
    description: "Rebalance portfolio capital allocation across strategies",
    usage: "/rebalance [equal_weight|risk_parity|performance]",
    category: "strategy",
    level: 2,
    action: "agent",
    target: "planner",
    executionTime: "~2-3s",
    whenToUse: "Optimize capital distribution across active strategies",
  },

  // Market Regime
  {
    name: "regime",
    aliases: ["market-regime", "mr"],
    description: "Detect current market regime (trending/ranging/volatile/quiet)",
    usage: "/regime [symbol]",
    category: "market",
    level: 1,
    action: "agent",
    target: "scanner",
    executionTime: "~3-5s",
    whenToUse: "Understand current market conditions and matching strategies",
  },
  {
    name: "regime-history",
    aliases: ["rh"],
    description: "View regime transition history for a symbol",
    usage: "/regime-history [symbol] [limit]",
    category: "market",
    level: 2,
    action: "agent",
    target: "scanner",
  },

  // Strategy Evolution (Genome)
  {
    name: "evolve",
    aliases: ["mutate"],
    description: "Fork and mutate a playbook to create a new variant",
    usage: "/evolve <playbook-name>",
    category: "strategy",
    level: 3,
    action: "agent",
    target: "backtester",
    executionTime: "~5-10s",
    whenToUse: "Create an evolved variant of a strategy for A/B testing",
  },
  {
    name: "experiment",
    aliases: ["ab"],
    description: "A/B strategy experiments — start, check, promote, rank, lineage",
    usage: "/experiment [status|list|start|check|promote|rank|lineage|evaluate]",
    category: "strategy",
    level: 3,
    action: "agent",
    target: "backtester",
    whenToUse: "Manage A/B experiments: start tests, check progress, promote winners, rank variants, view lineage",
  },

  // Audit
  {
    name: "audit",
    aliases: ["trail", "decisions"],
    description: "Agent decision audit trail — entries, paths, activity, stats",
    usage: "/audit [recent|agent <name>|position <id>|decision <id>|activity|stats]",
    category: "system",
    level: 2,
    action: "agent",
    target: "monitor",
    whenToUse: "Investigate decision reasoning, review agent activity summaries, or view audit statistics",
  },

  // Health
  {
    name: "health",
    aliases: ["portfolio-health", "ph"],
    description: "Portfolio health check with risk status",
    usage: "/health",
    category: "strategy",
    level: 1,
    action: "agent",
    target: "monitor",
    executionTime: "~2-3s",
    whenToUse: "Quick check on portfolio risk, strategy health, and warnings",
  },

  // System
  {
    name: "help",
    aliases: ["?"],
    description: "Get help and learn concepts",
    usage: "/help [topic|advanced|all|expert|trading|strategy|analysis|market|account|system|page N]",
    category: "system",
    level: 1,
    action: "agent",
    target: "teacher",
  },
  {
    name: "status",
    aliases: ["st"],
    description: "Check system and connection status",
    usage: "/status",
    category: "system",
    level: 1,
    action: "tool",
    target: "test_connection",
  },
  {
    name: "setup",
    aliases: [],
    description: "Configure API keys and settings",
    usage: "/setup",
    category: "system",
    level: 1,
    action: "menu",
    target: "setup",
  },
  {
    name: "config",
    aliases: ["settings", "prefs"],
    description: "View and quick-edit configuration settings",
    usage: "/config [set <key> <value>|reset]",
    category: "system",
    level: 1,
    action: "tool",
    target: "handle_config_command",
  },
  {
    name: "exchange",
    aliases: ["ex", "exchanges"],
    description: "Manage trading exchanges",
    usage: "/exchange [list|add|switch|remove|status|compare]",
    category: "account",
    level: 2,
    action: "tool",
    target: "handle_exchange_command",
    executionTime: "~1-3s",
    whenToUse: "Configure, switch, or check status of trading exchanges",
  },
  {
    name: "model",
    aliases: ["m", "provider"],
    description: "Select AI model and provider",
    usage: "/model",
    category: "system",
    level: 2,
    action: "menu",
    target: "model",
  },
  {
    name: "metrics",
    aliases: ["stats", "performance"],
    description: "Show trading performance metrics",
    usage: "/metrics",
    category: "account",
    level: 2,
    action: "tool",
    target: "get_performance_metrics",
  },

  // New SOTA Features
  {
    name: "ensemble",
    aliases: ["multi", "validate"],
    description: "Multi-strategy validation (~8-12s, 5 strategies)",
    usage: "/ensemble <symbol>",
    category: "market",
    level: 2,
    action: "tool",
    target: "run_strategy_ensemble",
    executionTime: "~8-12s",
    whenToUse: "Validate with multiple strategies before trading",
  },
  {
    name: "deep",
    aliases: ["full", "comprehensive", "full-analysis", "multi-analysis"],
    description: "Full market analysis with signals, whales, orderbook (~15-20s)",
    usage: "/deep <symbol>",
    category: "market",
    level: 2,
    action: "tool",
    target: "run_full_analysis",
    executionTime: "~15-20s",
    whenToUse: "Full due diligence before large position",
  },
  {
    name: "parallel",
    aliases: ["par", "fast", "quick-scan"],
    description: "Scan + analysis combined (~5-8s, parallel execution)",
    usage: "/parallel <symbol>",
    category: "market",
    level: 2,
    action: "tool",
    target: "parallel_scan_analyze",
    executionTime: "~5-8s",
    whenToUse: "Fast overview combining market scan and coin analysis",
  },
  {
    name: "compare-coins",
    aliases: ["coins", "multi-coin", "vs"],
    description: "Compare multiple coins side-by-side (~5-10s per 3 coins)",
    usage: "/compare-coins BTC ETH SOL",
    category: "market",
    level: 2,
    action: "tool",
    target: "parallel_multi_coin",
    executionTime: "~5-10s per 3 coins",
    whenToUse: "Deciding between multiple coins to trade",
  },
  {
    name: "fast-deep",
    aliases: ["fd", "quick-deep", "rapid"],
    description: "Deep analysis with parallel execution (~8-12s, optimized)",
    usage: "/fast-deep <symbol>",
    category: "market",
    level: 3,
    action: "tool",
    target: "parallel_deep_analysis",
    executionTime: "~8-12s",
    whenToUse: "Full analysis when time is critical (same depth as /deep, faster)",
  },
  {
    name: "mtf",
    aliases: ["timeframes", "multi-tf", "confluence"],
    description: "Multi-timeframe confluence analysis (~6-10s, 4 timeframes)",
    usage: "/mtf <symbol>",
    category: "market",
    level: 2,
    action: "tool",
    target: "parallel_timeframe",
    executionTime: "~6-10s",
    whenToUse: "Check trend alignment across 15m/1h/4h/1d timeframes",
  },
  {
    name: "risk",
    aliases: ["sharpe", "drawdown"],
    description: "Show risk-adjusted performance metrics",
    usage: "/risk",
    category: "account",
    level: 2,
    action: "tool",
    target: "get_risk_analysis",
  },
  {
    name: "shortcuts",
    aliases: ["keys", "hotkeys"],
    description: "Show keyboard shortcuts",
    usage: "/shortcuts",
    category: "system",
    level: 2,
    action: "menu",
    target: "shortcuts",
  },
  {
    name: "theme",
    aliases: ["th"],
    description: "Toggle or set color theme (dark/light)",
    usage: "/theme [dark|light]",
    category: "system",
    level: 2,
    action: "menu",
    target: "theme",
  },
  {
    name: "resume",
    aliases: ["continue", "r"],
    description: "Resume previous session with memory context",
    usage: "/resume",
    category: "system",
    level: 2,
    action: "menu",
    target: "resume",
  },
  {
    name: "new-session",
    aliases: ["fresh", "new"],
    description: "Start a fresh session (clear memory context)",
    usage: "/new-session",
    category: "system",
    level: 2,
    action: "menu",
    target: "new-session",
  },
  {
    name: "session",
    aliases: ["sess"],
    description: "Show current session info",
    usage: "/session",
    category: "system",
    level: 2,
    action: "menu",
    target: "session-info",
  },
  {
    name: "mcp",
    aliases: ["plugin", "plugins"],
    description: "Manage MCP plugins",
    usage: "/mcp <list|search|install|uninstall|configure|enable|disable|update|info|showcase|suggest>",
    category: "system",
    level: 2,
    action: "tool",
    target: "handle_mcp_command",
  },
  {
    name: "routing",
    aliases: ["route", "routes"],
    description: "Manage MCP tool-to-agent routing",
    usage: "/routing <list|search|install|uninstall|route|configure|enable|disable|info|help>",
    category: "system",
    level: 2,
    action: "tool",
    target: "handle_routing_command",
  },
  {
    name: "workflow",
    aliases: ["wf", "flow"],
    description: "Run predefined command workflows",
    usage: "/workflow [quick|dd|backtest-cycle|web-dd|web-monitor] <args>",
    category: "system",
    level: 2,
    action: "tool",
    target: "handle_workflow_command",
  },
  {
    name: "export",
    aliases: ["exp"],
    description: "Export data to file (csv, json, markdown)",
    usage: "/export <scan|analysis|backtest|session> [format] [filename]",
    category: "system",
    level: 2,
    action: "tool",
    target: "handle_export_command",
  },

  // Thread Management (for "what if" scenario branching) - Expert Level
  {
    name: "clone",
    aliases: ["branch", "fork"],
    description: "Clone current session for 'what if' testing",
    usage: "/clone [label]",
    category: "system",
    level: 3,
    action: "menu",
    target: "clone-thread",
  },
  {
    name: "threads",
    aliases: ["branches", "sessions"],
    description: "List available session threads",
    usage: "/threads",
    category: "system",
    level: 3,
    action: "menu",
    target: "list-threads",
  },
  {
    name: "switch",
    aliases: ["sw", "goto"],
    description: "Switch to a different thread",
    usage: "/switch <threadId>",
    category: "system",
    level: 3,
    action: "menu",
    target: "switch-thread",
  },
  {
    name: "thread-info",
    aliases: ["ti"],
    description: "Get info about a specific thread",
    usage: "/thread-info [threadId]",
    category: "system",
    level: 3,
    action: "menu",
    target: "thread-info",
  },
  {
    name: "delete-thread",
    aliases: ["dt", "remove-thread"],
    description: "Delete a thread (cannot delete active thread)",
    usage: "/delete-thread <threadId>",
    category: "system",
    level: 3,
    action: "menu",
    target: "delete-thread",
  },
  {
    name: "rename-thread",
    aliases: ["rt", "label-thread"],
    description: "Rename/label a thread",
    usage: "/rename-thread <threadId> <new-label>",
    category: "system",
    level: 3,
    action: "menu",
    target: "rename-thread",
  },
  {
    name: "cache",
    aliases: ["cachestats"],
    description: "Show tool cache statistics (debug)",
    usage: "/cache",
    category: "system",
    level: 3,
    action: "tool",
    target: "get_cache_stats",
  },

  // Cross-Pair Analysis
  {
    name: "pairs",
    aliases: ["pair", "correlation", "corr"],
    description: "Analyze correlation and spread between two trading pairs",
    usage: "/pairs <symbolA> <symbolB>",
    category: "market",
    level: 2,
    action: "agent",
    target: "analyst",
    executionTime: "~3-5s",
    whenToUse: "Compare how two coins move together, find pair trading opportunities",
  },

  // Autonomous Trading
  {
    name: "autonomous",
    aliases: ["auto", "mandate", "swing"],
    description: "Set up and control autonomous swing trading",
    usage: "/autonomous [start|stop|pause|resume|status]",
    category: "trading",
    level: 2,
    action: "agent",
    target: "gordon",
    executionTime: "~2-5s",
    whenToUse: "Automated trading with risk mandates over hours/days",
  },

  // Keyring
  {
    name: "keyring",
    aliases: ["kr", "vault"],
    description: "Manage OS keyring for secure API key storage",
    usage: "/keyring [status|enable|disable|store|clear]",
    category: "system",
    level: 2,
    action: "tool",
    target: "handle_keyring_command",
    whenToUse: "Store API keys in OS keyring instead of .env file",
  },

  // Withdrawal
  {
    name: "withdraw",
    aliases: ["wd", "send"],
    description: "Preview or execute external withdrawal (to Ledger/cold storage)",
    usage: "/withdraw <coin> <amount> <address>",
    category: "account",
    level: 2,
    action: "agent",
    target: "monitor",
    executionTime: "~2-3s",
    whenToUse: "Send crypto to hardware wallet or external address",
  },

  // Telemetry
  {
    name: "telemetry",
    aliases: ["analytics", "tracking"],
    description: "Manage anonymous telemetry and research data collection (opt-in)",
    usage: "/telemetry [status|enable|disable|research-enable|research-disable|research-status|research-upload|research-clear]",
    category: "system",
    level: 2,
    action: "menu",
    target: "telemetry",
    whenToUse: "Enable/disable anonymous usage analytics or trading data collection for AI training",
  },

  // Bug Report
  {
    name: "bugreport",
    aliases: ["bug", "report"],
    description: "Generate a bug report with system info",
    usage: "/bugreport [description]",
    category: "system",
    level: 2,
    action: "agent",
    target: "gordon",
    whenToUse: "Report a bug or unexpected behavior",
  },

  // What's New / Changelog
  {
    name: "whatsnew",
    aliases: ["changelog", "updates"],
    description: "Show recent changes and new features",
    usage: "/whatsnew",
    category: "system",
    level: 2,
    action: "agent",
    target: "gordon",
    whenToUse: "See latest features and bug fixes",
  },

  // Blockchain Networks
  {
    name: "chains",
    aliases: ["networks", "chain"],
    description: "Show configured blockchain networks and available tools",
    usage: "/chains",
    category: "system",
    level: 1,
    action: "agent",
    target: "gordon",
    whenToUse: "See which chain networks are configured and what tools are available",
  },
  {
    name: "bridge",
    aliases: ["ccip", "cross-chain"],
    description: "Bridge tokens cross-chain via Chainlink CCIP",
    usage: "/bridge [amount] [token] from [source] to [dest]",
    category: "trading",
    level: 1,
    action: "agent",
    target: "executor",
    executionTime: "~10-30s",
    whenToUse: "Transfer tokens between EVM chains (Ethereum, Arbitrum, Polygon, etc.)",
  },
  {
    name: "solana",
    aliases: ["sol"],
    description: "Solana DeFi actions (swap, stake, lend, launch)",
    usage: "/solana [swap|stake|lend|launch|balance]",
    category: "trading",
    level: 2,
    action: "agent",
    target: "executor",
    whenToUse: "Interact with Solana DeFi protocols",
  },
  {
    name: "polkadot",
    aliases: ["dot"],
    description: "Polkadot ecosystem actions (swap, stake, transfer)",
    usage: "/polkadot [swap|stake|transfer|balance]",
    category: "trading",
    level: 2,
    action: "agent",
    target: "executor",
    whenToUse: "Interact with Polkadot/HydraDX protocols",
  },
  {
    name: "prices",
    aliases: ["feeds", "cl-prices"],
    description: "Real-time Chainlink Data Streams prices",
    usage: "/prices [BTC ETH SOL ...]",
    category: "market",
    level: 1,
    action: "agent",
    target: "analyst",
    executionTime: "~1-2s",
    whenToUse: "Get sub-second institutional-grade price data from Chainlink",
  },
  {
    name: "base",
    aliases: ["base-l2"],
    description: "Base L2 chain — trending apps, signals, DEX analytics",
    usage: "/base [trending|signals|whales|dex]",
    category: "market",
    level: 2,
    action: "agent",
    target: "analyst",
    executionTime: "~2-5s",
    whenToUse: "Explore Base L2 ecosystem: trending dApps, whale movements, DEX activity",
  },

  // SynthData — AI Predictions
  {
    name: "synth",
    aliases: ["synthdata", "sd"],
    description: "SynthData AI predictions — price forecasts, volatility, options, LP ranges",
    usage: "/synth [predict|volatility|options|lp|liquidation|miners] <asset>",
    category: "market",
    level: 2,
    action: "agent",
    target: "analyst",
    executionTime: "~2-5s",
    whenToUse: "AI probabilistic predictions for BTC, ETH, SOL, XAU, SPYX, NVDAX, TSLAX, AAPLX, GOOGLX",
  },
  {
    name: "predict",
    aliases: ["forecast", "cone", "pred"],
    description: "AI price prediction — probability cone from 200+ competing models",
    usage: "/predict <asset> [days]",
    category: "market",
    level: 2,
    action: "agent",
    target: "analyst",
    executionTime: "~2-3s",
    whenToUse: "Forward-looking price forecast (BTC, ETH, SOL, XAU, SPYX, NVDAX, TSLAX, AAPLX, GOOGLX)",
  },

  // Risk & Simulation
  {
    name: "liquidation",
    aliases: ["liq", "cascade"],
    description: "Liquidation intelligence — cascade risk, pressure, crowding, squeezes",
    usage: "/liquidation [cascade|pressure|crowding|squeeze] [symbol]",
    category: "trading",
    level: 2,
    action: "agent",
    target: "analyst",
    executionTime: "~3-5s",
    whenToUse: "Analyze liquidation risks, crowded positions, and short/long squeeze candidates",
  },
  {
    name: "simulate",
    aliases: ["sim", "preview"],
    description: "Simulate order bundles before live execution",
    usage: "/simulate [orders|breaker]",
    category: "trading",
    level: 3,
    action: "agent",
    target: "planner",
    executionTime: "~2-5s",
    whenToUse: "Preview order execution, simulate fills, or verify circuit breaker state",
  },
];

// ============================================================================
// Help System Types and Functions
// ============================================================================

/**
 * Help display modes for filtering commands by level
 */
export type HelpMode = "essential" | "advanced" | "all" | "expert";

/**
 * Help categories for filtering commands by topic
 */
export type HelpCategory = "trading" | "analysis" | "system" | "market" | "account" | "strategy";

/**
 * Get commands filtered by level
 * @param maxLevel - Maximum level to include (1, 2, or 3)
 */
export function getCommandsByLevel(maxLevel: CommandLevel): SlashCommand[] {
  return SLASH_COMMANDS.filter((cmd) => cmd.level <= maxLevel);
}

/**
 * Get commands filtered by category
 * @param category - Category to filter by
 */
export function getCommandsByCategory(category: HelpCategory): SlashCommand[] {
  // Map 'analysis' to 'market' for backward compatibility
  const mappedCategory = category === "analysis" ? "market" : category;
  return SLASH_COMMANDS.filter((cmd) => (cmd.category as string) === mappedCategory);
}

/**
 * Parse help mode from help command argument
 * @param arg - The argument passed to /help
 * @returns Parsed help mode and optional category
 */
export function parseHelpArg(arg: string): { mode: HelpMode; category?: HelpCategory } {
  const lowerArg = arg.toLowerCase().trim();

  // Check for level-based modes
  if (lowerArg === "advanced") return { mode: "advanced" };
  if (lowerArg === "all" || lowerArg === "expert") return { mode: "all" };

  // Check for category-based filtering
  if (lowerArg === "trading") return { mode: "all", category: "trading" };
  if (lowerArg === "analysis" || lowerArg === "market") return { mode: "all", category: "analysis" };
  if (lowerArg === "system") return { mode: "all", category: "system" };
  if (lowerArg === "account") return { mode: "all", category: "account" };
  if (lowerArg === "strategy" || lowerArg === "strategies") return { mode: "all", category: "strategy" };

  // Default to essential mode
  return { mode: "essential" };
}

/**
 * Get level label for display
 */
export function getLevelLabel(level: CommandLevel): string {
  switch (level) {
    case 1:
      return "Essential";
    case 2:
      return "Advanced";
    case 3:
      return "Expert";
    default:
      return "Unknown";
  }
}

// ============================================================================
// Command Parsing Functions
// ============================================================================

/**
 * Parse user input for slash commands
 * @returns parsed command info or null if not a slash command
 */
export function parseSlashCommand(input: string): {
  command: SlashCommand;
  args: string;
} | null {
  const trimmed = input.trim();

  // Must start with /
  if (!trimmed.startsWith("/")) {
    return null;
  }

  // Extract command and args
  const parts = trimmed.slice(1).split(/\s+/);
  const commandName = parts[0]?.toLowerCase() ?? "";
  const args = parts.slice(1).join(" ");

  // Find matching command
  const command = SLASH_COMMANDS.find(
    (cmd) => cmd.name === commandName || cmd.aliases.includes(commandName)
  );

  if (!command) {
    return null;
  }

  return { command, args };
}

/**
 * Get command suggestions for autocomplete
 * @param partial - The partial input (including /)
 * @param maxLevel - Maximum level to include in suggestions (default: show all)
 * @returns Array of matching commands sorted by level (essential first)
 */
export function getSlashCommandSuggestions(
  partial: string,
  maxLevel: CommandLevel = 3
): SlashCommand[] {
  if (!partial.startsWith("/")) {
    return [];
  }

  const search = partial.slice(1).toLowerCase();
  const categoryOrder: Record<SlashCommand["category"], number> = {
    market: 0,
    trading: 1,
    strategy: 2,
    account: 3,
    system: 4,
  };
  const sortByCategoryAndLevel = (a: SlashCommand, b: SlashCommand): number => {
    const catDiff = categoryOrder[a.category] - categoryOrder[b.category];
    if (catDiff !== 0) return catDiff;
    const levelDiff = a.level - b.level;
    if (levelDiff !== 0) return levelDiff;
    return a.name.localeCompare(b.name);
  };

  // Filter by level first
  const levelFiltered = SLASH_COMMANDS.filter((cmd) => cmd.level <= maxLevel);

  if (search === "") {
    // Show all commands when just "/" is typed, grouped by category
    return [...levelFiltered].sort(sortByCategoryAndLevel);
  }

  // Filter by name or alias prefix, then sort by category/level
  return levelFiltered
    .filter(
      (cmd) =>
        cmd.name.startsWith(search) ||
        cmd.aliases.some((alias) => alias.startsWith(search))
    )
    .sort(sortByCategoryAndLevel);
}

/**
 * Category display configuration for help formatting
 */
const CATEGORY_CONFIG: Record<string, { label: string; icon: string }> = {
  market: { label: "Market Discovery", icon: "M" },
  trading: { label: "Trading", icon: "T" },
  strategy: { label: "Strategy & Runtime", icon: "R" },
  account: { label: "Account", icon: "A" },
  system: { label: "System", icon: "S" },
};

/**
 * Format command list for display with level-based filtering
 * @param mode - Help display mode (essential, advanced, all/expert) - defaults to "essential"
 * @param category - Optional category filter
 */
export function formatCommandHelp(
  mode: HelpMode = "essential",
  category?: HelpCategory
): string {
  // Determine max level based on mode
  let maxLevel: CommandLevel = 1;
  if (mode === "advanced") maxLevel = 2;
  if (mode === "all" || mode === "expert") maxLevel = 3;

  // Filter commands
  let commands = getCommandsByLevel(maxLevel);
  if (category) {
    const mappedCategory = category === "analysis" ? "market" : category;
    commands = commands.filter((cmd) => (cmd.category as string) === mappedCategory);
  }

  // Build output
  const lines: string[] = [];

  // Header with mode indicator
  if (mode === "essential") {
    lines.push("**Essential Commands:**\n");
    lines.push("_Use `/help advanced` for more commands, `/help all` for everything._\n");
  } else if (mode === "advanced") {
    lines.push("**Commands (Essential + Advanced):**\n");
    lines.push("_Use `/help all` or `/help expert` to see expert-level commands._\n");
  } else {
    lines.push("**All Commands:**\n");
  }

  // Category filter indicator
  if (category) {
    lines.push(`_Filtered by: ${category}_\n`);
  }

  // Group by category
  const categories = ["market", "trading", "strategy", "account", "system"] as const;

  for (const cat of categories) {
    const config = CATEGORY_CONFIG[cat];
    if (!config) continue;
    const catCommands = commands.filter((c) => c.category === cat);
    if (catCommands.length === 0) continue;

    lines.push(`\n**[${config.icon}] ${config.label}**`);

    for (const cmd of catCommands) {
      const aliases = cmd.aliases.length > 0 ? ` (${cmd.aliases.slice(0, 2).join(", ")})` : "";
      const levelTag = cmd.level > 1 ? ` [L${cmd.level}]` : "";
      lines.push(`  /${cmd.name}${aliases}${levelTag} - ${cmd.description}`);
    }
  }

  // Footer with tips
  lines.push("\n_Type a command or just chat naturally with Gordon._");
  lines.push("\n**Help Options:**");
  lines.push("  `/help` - Show essential commands (Level 1)");
  lines.push("  `/help advanced` - Show Level 1 + Level 2");
  lines.push("  `/help all` or `/help expert` - Show everything");
  lines.push("  `/help trading` - Show trading commands only");
  lines.push("  `/help strategy` - Show strategy & runtime commands only");
  lines.push("  `/help analysis` - Show analysis commands only");
  lines.push("  `/help market` - Show market discovery commands only");
  lines.push("  `/help account` - Show account commands only");
  lines.push("  `/help system` - Show system commands only");
  lines.push("  `/help page 1` - Browse all commands in pages");

  return lines.join("\n");
}

/**
 * Format analysis commands with performance comparison
 * Useful for helping users choose the right analysis depth
 */
export function formatAnalysisCommandsHelp(): string {
  const analysisCommands = ["analyze", "ensemble", "deep", "fast-deep", "parallel", "mtf", "compare-coins", "scan"];
  const cmds = SLASH_COMMANDS.filter((c) => analysisCommands.includes(c.name));

  const lines: string[] = [
    "**Analysis Commands - Choose by Time & Depth:**\n",
    "| Command | Time | Use Case |",
    "|---------|------|----------|",
  ];

  for (const cmd of cmds) {
    const time = cmd.executionTime || "varies";
    const useCase = cmd.whenToUse || cmd.description;
    lines.push(`| /${cmd.name} | ${time} | ${useCase} |`);
  }

  lines.push("\n**Quick Guide:**");
  lines.push("- Quick check: `/analyze` (~3-5s)");
  lines.push("- Before trading: `/ensemble` (~8-12s)");
  lines.push("- Large position: `/deep` or `/fast-deep` (~15-20s or ~8-12s)");
  lines.push("- Multiple coins: `/compare-coins` (~5-10s per 3)");

  return lines.join("\n");
}

/**
 * Convert slash command to natural language for the agent
 */
export function commandToPrompt(command: SlashCommand, args: string): string {
  switch (command.name) {
    case "scan":
      return "Scan the market for trading opportunities across multiple coins (~10-30s depending on market size)";
    case "trending":
      return args === "losers"
        ? "Show me the biggest losers today"
        : "Show me what's trending and pumping today";
    case "volume":
      return "Show me the highest volume tokens";
    case "analyze":
      return args
        ? `Run a quick single analysis on ${args} - get price action, key levels, and trading signal`
        : "What coin should I analyze? (This is a quick ~3-5s analysis)";
    case "whales":
      return args ? `Check whale orders and flow bias for ${args}` : "What symbol should I check for whale activity?";
    case "breakouts":
      return args ? `Scan ${args} for breakout or breakdown setups` : "Scan the market for breakout and breakdown setups";
    case "score":
      return args ? `Score ${args} and give me a trading signal` : "What symbol should I score?";
    case "chart":
      if (args) {
        const parts = args.split(/\s+/);
        const symbol = parts[0];
        const timeframe = parts[1] || "4h";
        return `Generate a chart for ${symbol} on the ${timeframe} timeframe with indicators`;
      }
      return "What symbol should I chart?";
    case "ta":
      if (args) {
        const parts = args.split(/\s+/);
        const symbol = parts[0];
        const timeframe = parts[1] || "4h";
        return `Show me technical analysis for ${symbol} on the ${timeframe} timeframe`;
      }
      return "What symbol should I analyze technically?";
    case "candlestick":
      if (args) {
        const parts = args.split(/\s+/);
        const symbol = parts[0];
        const timeframe = parts[1] || "4h";
        return `Display a candlestick chart for ${symbol} on the ${timeframe} timeframe`;
      }
      return "What symbol should I show candlesticks for?";
    case "plan":
      return args ? `Create a trade plan for ${args}` : "What coin should I plan a trade for?";
    case "grid":
      return args ? `Create a grid entry plan for ${args}` : "What symbol should I create a grid plan for?";
    case "positions":
      return "Check my current positions";
    case "orders":
      return "Show my open orders";
    case "arm":
      return "Arm the system for live trading";
    case "disarm":
      return "Disarm the system and return to safe mode";
    case "portfolio":
      return "Show my portfolio";
    case "earn": {
      const earnSub = args?.trim().split(/\s+/)[0]?.toLowerCase();
      if (earnSub === "products" || earnSub === "browse") return "Show me available flexible and locked earn products with their APY rates and terms";
      if (earnSub === "flexible") return "Show me available flexible earn products I can subscribe to";
      if (earnSub === "locked") return "Show me available locked earn products with their lock periods and APY rates";
      if (earnSub === "subscribe") return "Help me subscribe to an earn product. Show me available options first.";
      if (earnSub === "redeem") return "Help me redeem from my earn positions. Show my current positions first.";
      if (earnSub === "history") return "Show my earn subscription and redemption history";
      if (earnSub === "positions") return "Show all my current earn/staking positions with current value and rewards";
      return "Show all my current earn/staking positions with current value and rewards";
    }
    case "history":
      return args ? `Show my trade history for ${args}` : "Show my recent trade history";
    case "help":
      return args ? `Explain ${args} to me` : "Help me understand how to use Gordon";
    case "status":
      return "Check system status and connection";
    case "setup":
      return "I want to configure my settings";
    case "config":
      if (!args) return "Show my current configuration settings";
      const configParts = args.split(/\s+/);
      const configSubcommand = configParts[0]?.toLowerCase();
      const configArgs = configParts.slice(1).join(" ");
      switch (configSubcommand) {
        case "set":
          return configArgs
            ? `Update configuration setting: ${configArgs}`
            : "What setting would you like to change?";
        case "reset":
          return "Reset my configuration to default values";
        case "view":
        case "show":
          return "Show my current configuration settings";
        case "help":
          return "Show help for config commands";
        default:
          return "Show my current configuration settings";
      }
    case "model":
      return "Show me the current AI model and available providers";
    case "exchange":
      if (!args) return "List my configured trading exchanges";
      const exParts = args.split(/\s+/);
      const exSubcmd = exParts[0]?.toLowerCase();
      const exArgs = exParts.slice(1).join(" ");
      switch (exSubcmd) {
        case "list":
        case "ls":
          return "List all my configured trading exchanges";
        case "add":
        case "new":
          return exArgs
            ? `Add a new ${exArgs} exchange configuration`
            : "What type of exchange would you like to add? (binance, coinbase, kraken, bybit, okx)";
        case "switch":
        case "use":
          return exArgs
            ? `Switch to using the "${exArgs}" exchange`
            : "Which exchange should I switch to?";
        case "remove":
        case "delete":
          return exArgs
            ? `Remove the "${exArgs}" exchange configuration`
            : "Which exchange should I remove?";
        case "status":
        case "check":
          return "Check the connection status for all configured exchanges";
        case "compare":
        case "prices":
          return exArgs
            ? `Compare ${exArgs} prices across all my exchanges`
            : "What symbol should I compare across exchanges?";
        case "help":
          return "Show help for exchange management commands";
        default:
          return "List my configured trading exchanges";
      }
    case "backtest":
      if (args) {
        const parts = args.split(/\s+/);
        const strategy = parts[0];
        const symbol = parts[1] || "BTCUSDT";
        const timeframe = parts[2] || "4h";
        const days = parts[3] || "90";
        return `Run a backtest for the ${strategy} strategy on ${symbol} using ${timeframe} candles for the last ${days} days`;
      }
      return "What strategy and symbol should I backtest?";
    case "optimize":
      if (args) {
        const parts = args.split(/\s+/);
        const strategy = parts[0];
        const symbol = parts[1] || "BTCUSDT";
        return `Optimize the ${strategy} strategy parameters on ${symbol}`;
      }
      return "What strategy should I optimize?";
    case "compare":
      return args
        ? `Compare backtest results for strategies on ${args}`
        : "What strategies and symbol should I compare?";
    case "strategies":
      if (!args) return "List all available trading strategies (built-in and generated)";
      const stratParts = args.split(/\s+/);
      const stratSubcmd = stratParts[0]?.toLowerCase();
      const stratArgs = stratParts.slice(1).join(" ");
      switch (stratSubcmd) {
        case "list":
        case "ls":
          return "List all available trading strategies";
        case "info":
        case "show":
          return stratArgs
            ? `Show detailed information about the "${stratArgs}" strategy`
            : "Which strategy would you like information about?";
        case "generate":
        case "gen":
          return stratArgs
            ? `Generate a new trading strategy based on: "${stratArgs}"`
            : "Describe the strategy you want to generate";
        case "backtest":
        case "bt":
          if (stratArgs) {
            const btParts = stratArgs.split(/\s+/);
            const stratId = btParts[0];
            const btSymbol = btParts[1] || "BTCUSDT";
            return `Run a quick backtest for the "${stratId}" strategy on ${btSymbol}`;
          }
          return "Which strategy should I backtest?";
        case "compare":
          if (stratArgs) {
            const cmpParts = stratArgs.split(/\s+/);
            return `Compare the "${cmpParts[0]}" and "${cmpParts[1]}" strategies`;
          }
          return "Which two strategies should I compare?";
        default:
          // Might be a strategy ID directly
          return `Show information about the "${stratSubcmd}" strategy`;
      }
    case "gen":
      return args
        ? `Generate a new trading strategy based on this description: "${args}"`
        : "Describe the trading strategy you want to generate (e.g., 'buy when RSI is oversold near support')";
    case "metrics":
      return "Show me my trading performance metrics and statistics";
    case "ensemble":
      return args
        ? `Run 5 different trading strategies on ${args} to validate the setup with multi-strategy consensus`
        : "What symbol should I validate with multiple strategies? (Runs 5 strategies in ~8-12s)";
    case "deep":
      return args
        ? `Run full due diligence on ${args} - comprehensive analysis including technical signals, RSI divergence, whale order detection, and orderbook depth analysis`
        : "What symbol should I analyze comprehensively? (Full analysis takes ~15-20s)";
    case "parallel":
      return args
        ? `Run combined market scan and analysis for ${args} using parallel execution for a fast comprehensive overview`
        : "What symbol should I analyze? (Combines scan + analysis in ~5-8s)";
    case "compare-coins":
      if (args) {
        const symbols = args.split(/\s+/).filter((s) => s);
        return `Analyze and compare these coins side-by-side: ${symbols.join(", ")} - help me decide which to trade`;
      }
      return "Which coins would you like to compare? (e.g., BTC ETH SOL - takes ~5-10s per 3 coins)";
    case "fast-deep":
      return args
        ? `Run optimized parallel deep analysis on ${args} - same comprehensive coverage as /deep but faster execution (~8-12s vs ~15-20s)`
        : "What symbol should I analyze? (Same depth as /deep but optimized for speed ~8-12s)";
    case "mtf":
      return args
        ? `Analyze ${args} across 15m/1h/4h/1d timeframes to find trend confluence and alignment`
        : "What symbol should I analyze across timeframes? (Checks 4 timeframes in ~6-10s)";
    case "risk":
      return "Show me my risk-adjusted performance metrics including Sharpe ratio and drawdown";
    case "cache":
      return "Show me the tool cache statistics";
    case "pairs":
      if (args) {
        const parts = args.split(/\s+/);
        const symA = parts[0]?.toUpperCase();
        const symB = parts[1]?.toUpperCase();
        if (symA && symB) {
          return `Analyze the correlation and spread between ${symA} and ${symB} — show me how they move together and any pair trading signals`;
        }
        return `Analyze the pair relationship for ${symA} — what's the second coin to compare?`;
      }
      return "Which two coins should I compare? (e.g., /pairs BTC ETH)";
    case "autonomous":
      if (!args) return "Show me the current autonomous trading status, or help me set up a new swing mandate";
      const autoParts = args.split(/\s+/);
      const autoSubcmd = autoParts[0]?.toLowerCase();
      switch (autoSubcmd) {
        case "start":
          return "Create a new swing trading mandate and start autonomous mode";
        case "stop":
          return "Stop the autonomous trading loop";
        case "pause":
          return "Pause the autonomous trading loop";
        case "resume":
          return "Resume the paused autonomous trading loop";
        case "status":
          return "Show me the current autonomous trading status and mandate details";
        default:
          return "Show me the current autonomous trading status";
      }
    case "withdraw":
      if (args) {
        const parts = args.split(/\s+/);
        const coin = parts[0]?.toUpperCase();
        const amount = parts[1];
        const address = parts[2];
        if (coin && amount && address) {
          return `Preview a withdrawal of ${amount} ${coin} to address ${address} — show me the fees and network options before confirming`;
        }
        if (coin && amount) {
          return `I want to withdraw ${amount} ${coin} — what address should I send to?`;
        }
        return `Preview withdrawal options for ${coin}`;
      }
      return "Which coin do you want to withdraw? (e.g., /withdraw BTC 0.1 bc1q...)";
    case "keyring":
      if (!args) return "Show keyring status — whether OS keyring is available and enabled";
      const krParts = args.split(/\s+/);
      const krSubcmd = krParts[0]?.toLowerCase();
      switch (krSubcmd) {
        case "status":
          return "Show keyring status — availability, enabled state, and stored keys";
        case "enable":
          return "Enable OS keyring and migrate existing .env keys into secure storage";
        case "disable":
          return "Disable OS keyring (fall back to .env, keys preserved in keyring)";
        case "store":
          return krParts[1]
            ? `Store ${krParts[1].toUpperCase()} in the OS keyring`
            : "Which key should I store in the keyring?";
        case "clear":
          return "Remove all Gordon keys from the OS keyring";
        default:
          return "Show keyring status";
      }
    case "shortcuts":
      return "Show keyboard shortcuts";
    case "theme":
      if (args === "dark") return "Switch to dark theme";
      if (args === "light") return "Switch to light theme";
      return "Toggle the color theme";
    case "resume":
      return "Resume my previous session with memory context";
    case "new-session":
      return "Start a fresh session and clear memory context";
    case "session":
      return "Show my current session information";
    // Thread management commands
    case "clone":
      return args
        ? `Clone the current conversation thread with label "${args}" for what-if testing`
        : "Clone the current conversation thread for what-if testing";
    case "threads":
      return "List all my conversation threads";
    case "switch":
      return args
        ? `Switch to thread ${args}`
        : "Which thread would you like to switch to? Use /threads to see available threads.";
    case "thread-info":
      return args
        ? `Show information about thread ${args}`
        : "Show information about the current thread";
    case "delete-thread":
      return args
        ? `Delete thread ${args}`
        : "Which thread would you like to delete? Use /threads to see available threads.";
    case "rename-thread":
      if (args) {
        const parts = args.split(/\s+/);
        const threadId = parts[0];
        const newLabel = parts.slice(1).join(" ");
        if (threadId && newLabel) {
          return `Rename thread ${threadId} to "${newLabel}"`;
        }
        return `Rename thread ${threadId}. What should the new label be?`;
      }
      return "Which thread would you like to rename? Use /threads to see available threads.";
    // MCP Plugin Management
    case "mcp":
      if (!args) return "Show my installed MCP plugins";
      const mcpParts = args.split(/\s+/);
      const mcpSubcommand = mcpParts[0]?.toLowerCase();
      const mcpArgs = mcpParts.slice(1).join(" ");
      switch (mcpSubcommand) {
        case "list":
        case "ls":
          return "List all installed MCP plugins";
        case "search":
        case "find":
          return mcpArgs
            ? `Search the MCP marketplace for plugins matching "${mcpArgs}"`
            : "Show all available plugins in the MCP marketplace";
        case "install":
        case "add":
          return mcpArgs
            ? `Install the MCP plugin "${mcpArgs}" from the marketplace`
            : "Which MCP plugin would you like to install?";
        case "uninstall":
        case "remove":
        case "rm":
          return mcpArgs
            ? `Uninstall the MCP plugin "${mcpArgs}"`
            : "Which MCP plugin would you like to uninstall?";
        case "configure":
        case "config":
          return mcpArgs
            ? `Configure credentials for the MCP plugin "${mcpArgs}"`
            : "Which MCP plugin would you like to configure?";
        case "enable":
          return mcpArgs
            ? `Enable the MCP plugin "${mcpArgs}"`
            : "Which MCP plugin would you like to enable?";
        case "disable":
          return mcpArgs
            ? `Disable the MCP plugin "${mcpArgs}"`
            : "Which MCP plugin would you like to disable?";
        case "update":
        case "upgrade":
          return "Update all installed MCP plugins to their latest versions";
        case "info":
        case "show":
          return mcpArgs
            ? `Show detailed information about the MCP plugin "${mcpArgs}"`
            : "Which MCP plugin would you like information about?";
        case "help":
          return "Show help for MCP plugin management commands";
        default:
          return "Show my installed MCP plugins";
      }
    // Routing command
    case "routing": {
      if (!args) return "List my installed plugins with routing info";
      const routingParts = args.split(/\s+/);
      const routingSub = routingParts[0]?.toLowerCase();
      const routingRest = routingParts.slice(1).join(" ");
      switch (routingSub) {
        case "list": case "ls":
          return "List my installed plugins with routing info";
        case "search": case "find":
          return routingRest ? `Search for plugins matching "${routingRest}"` : "Show the plugin marketplace";
        case "install": case "add":
          return routingRest ? `Install the plugin "${routingRest}"` : "Show available plugins";
        case "uninstall": case "remove": case "rm":
          return routingRest ? `Uninstall the plugin "${routingRest}"` : "Which plugin to uninstall?";
        case "route": case "assign":
          return `Route plugin tools: ${routingRest}`;
        case "configure": case "config":
          return routingRest ? `Configure credentials for plugin "${routingRest}"` : "Which plugin to configure?";
        case "enable":
          return routingRest ? `Enable the plugin "${routingRest}"` : "Which plugin to enable?";
        case "disable":
          return routingRest ? `Disable the plugin "${routingRest}"` : "Which plugin to disable?";
        case "info":
          return routingRest ? `Show info for plugin "${routingRest}"` : "Which plugin?";
        case "help":
          return "Show help for routing management commands";
        default:
          return "List my installed plugins with routing info";
      }
    }
    // Workflow command
    case "workflow":
      if (!args) return "Show available workflows. Use: /workflow quick <symbol>, /workflow dd <symbol>, /workflow backtest-cycle <strategy> <symbol>, /workflow web-dd <url> <goal...>, or /workflow web-monitor <monitorId> <schedule> <url> <goal...>";
      const wfParts = args.split(/\s+/);
      const wfType = wfParts[0]?.toLowerCase();
      const wfArgs = wfParts.slice(1);
      switch (wfType) {
        case "quick":
          return wfArgs[0]
            ? `Run quick analysis workflow on ${wfArgs[0].toUpperCase()}: scan -> analyze -> plan`
            : "Which symbol should I run the quick workflow on?";
        case "dd":
          return wfArgs[0]
            ? `Run due diligence workflow on ${wfArgs[0].toUpperCase()}: scan -> analyze -> portfolio check -> risk assessment`
            : "Which symbol should I run due diligence on?";
        case "backtest-cycle":
          if (wfArgs[0] && wfArgs[1]) {
            return `Run backtest cycle for ${wfArgs[0]} strategy on ${wfArgs[1].toUpperCase()}: backtest -> optimize -> compare`;
          }
          return "Usage: /workflow backtest-cycle <strategy> <symbol>";
        case "web-dd":
          return wfArgs[0] && wfArgs[1]
            ? `Run Tinyfish web due diligence on ${wfArgs[0]} with goal: ${wfArgs.slice(1).join(" ")}`
            : "Usage: /workflow web-dd <url> <goal...>";
        case "web-monitor":
          return wfArgs[0] && wfArgs[1] && wfArgs[2] && wfArgs[3]
            ? `Schedule Tinyfish web monitor ${wfArgs[0]} on ${wfArgs[2]} (${wfArgs[1]}) with goal: ${wfArgs.slice(3).join(" ")}`
            : "Usage: /workflow web-monitor <monitorId> <schedule> <url> <goal...>";
        default:
          return "Available workflows: quick, dd, backtest-cycle, web-dd, web-monitor";
      }
    // Export command
    case "export":
      if (!args) return "Export data. Usage: /export scan [csv|json|md], /export analysis <symbol> [format], /export backtest [format], /export session [md|json]";
      const expParts = args.split(/\s+/);
      const expType = expParts[0]?.toLowerCase();
      const expFormat = expParts[1]?.toLowerCase() || "csv";
      switch (expType) {
        case "scan":
          return `Export the latest scan results to ${expFormat} format`;
        case "analysis":
          const expSymbol = expParts[1];
          return expSymbol
            ? `Export analysis for ${expSymbol.toUpperCase()} to ${expParts[2] || "json"} format`
            : "Which symbol's analysis should I export?";
        case "backtest":
          return `Export the latest backtest results to ${expFormat} format`;
        case "session":
          return `Export the current session conversation to ${expFormat} format`;
        default:
          return "Export types: scan, analysis, backtest, session";
      }
    case "telemetry":
      if (!args || args === "status") return "Show my current telemetry status — whether anonymous usage analytics and research data collection are enabled or disabled";
      if (args === "enable") return "Enable anonymous telemetry to help improve Gordon. Only anonymous usage data is collected — no PII, no financial data, no API keys.";
      if (args === "disable") return "Disable anonymous telemetry and stop sending usage data";
      if (args === "research-enable" || args === "research enable") return "Enable anonymized trading data collection for AI model training. This collects: trade outcomes (% P&L, strategy, duration, exit reason), backtest results (metrics only), market context (indicators, trend, bias). NO absolute prices, balances, quantities, or wallet addresses are ever collected. Data is stored locally in ~/.gordon/research/ and uploaded only when you choose.";
      if (args === "research-disable" || args === "research disable") return "Disable anonymized trading data collection";
      if (args === "research-status" || args === "research status") return "Show research data collection status: how many records collected locally, file sizes, and whether upload is pending";
      if (args === "research-upload" || args === "research upload") return "Upload collected anonymized research data to help train AI trading models";
      if (args === "research-clear" || args === "research clear") return "Delete all locally collected research data files";
      return "Show my current telemetry status";
    case "bugreport":
      return args
        ? `Generate a bug report with this description: "${args}". Include system info: gordon version, Bun version, OS, active exchange, config directory, and mode. Format it as a pre-filled GitHub issue link for https://github.com/general-liquidity/gordon-cli/issues/new.`
        : "Help me create a bug report. Ask what went wrong, then generate a pre-filled GitHub issue link with system diagnostics for https://github.com/general-liquidity/gordon-cli/issues/new.";
    case "whatsnew":
      return "Show me the recent changes, new features, and improvements in the latest Gordon version. Summarize the changelog highlights.";
    // Strategy Runtime commands
    case "deploy":
      return args
        ? `Deploy the ${args.split(/\s+/)[0]} playbook as a live strategy. ${args.includes("--capital") ? `Use capital allocation from args: ${args}` : "Show me the allocation details."}`
        : "Which playbook should I deploy? List available playbooks.";
    case "strategies-live":
      return "Show me all running strategies, their performance, and portfolio state.";
    case "pause":
      return args
        ? `Pause the strategy slot "${args}". Confirm the pause and show updated status.`
        : "Which strategy slot should I pause? Show running strategies.";
    case "resume-strategy":
      return args
        ? `Resume the paused strategy slot "${args}". Confirm the resume and show updated status.`
        : "Which paused strategy slot should I resume? Show paused strategies.";
    case "stop":
      return args
        ? `Stop and drain the strategy slot "${args}". Show the wind-down plan and final state.`
        : "Which strategy slot should I stop? Show running strategies.";
    case "rebalance":
      if (args) {
        const method = args.split(/\s+/)[0]?.toLowerCase();
        return `Rebalance the portfolio capital allocation across running strategies using the ${method} method. Show before/after allocations.`;
      }
      return "Rebalance the portfolio capital allocation across running strategies. Show current allocations and recommended changes.";
    // Market Regime commands
    case "regime":
      return args
        ? `Detect the current market regime for ${args.toUpperCase()}. Show me the regime classification, confidence, and which playbooks match.`
        : "Detect the current overall market regime. Show me the regime classification, confidence, and which playbooks match.";
    case "regime-history":
      if (args) {
        const rhParts = args.split(/\s+/);
        const rhSymbol = rhParts[0]?.toUpperCase();
        const rhLimit = rhParts[1] || "10";
        return `Show the regime transition history for ${rhSymbol}, last ${rhLimit} transitions. Show timestamps and duration of each regime.`;
      }
      return "Show the regime transition history. Which symbol should I look at?";
    // Strategy Evolution commands
    case "evolve":
      return args
        ? `Fork the ${args} playbook with suggested mutations. Show me what changed and why, and prepare it for A/B testing.`
        : "Which playbook should I evolve? List available playbooks for mutation.";
    case "experiment": {
      if (!args) return "Show the status of all active A/B experiments.";
      const experimentParts = args.split(/\s+/);
      const experimentSubcmd = experimentParts[0]?.toLowerCase();
      switch (experimentSubcmd) {
        case "status":
          return "Show the status of all active A/B experiments with performance comparisons.";
        case "list":
          return "List all A/B experiments — active, completed, and pending.";
        case "start":
          return "Start a new A/B experiment between strategy variants.";
        case "evaluate":
          return "Evaluate active experiments and recommend winners based on statistical significance.";
        case "check":
          return experimentParts[1]
            ? `Check the status and progress of experiment ${experimentParts[1]}. Show performance metrics for each variant.`
            : "Check the status of the most recent active experiment.";
        case "promote":
          return experimentParts[1]
            ? `Promote the winning variant from experiment ${experimentParts[1]} to become the primary strategy.`
            : "Promote the winner from the most recent completed experiment.";
        case "rank":
          return "Rank all playbook variants by performance. Show win rate, Sharpe ratio, and recommendation.";
        case "lineage":
          return experimentParts[1]
            ? `Show the playbook family tree for ${experimentParts[1]} — all forks, mutations, and their performance.`
            : "Show the lineage/family tree of all playbook variants and their evolutionary history.";
        case "suggest":
          return experimentParts[1]
            ? `Suggest mutations for the ${experimentParts[1]} playbook based on recent backtest results.`
            : "Suggest mutations for the most recent playbook based on backtest performance.";
        default:
          return "Show the status of all active A/B experiments.";
      }
    }
    // Audit command
    case "audit":
      if (!args) return "Show me the most recent decisions from the audit trail.";
      const auditParts = args.split(/\s+/);
      const auditSubcmd = auditParts[0]?.toLowerCase();
      switch (auditSubcmd) {
        case "recent":
          return "Show me the most recent decisions from the audit trail.";
        case "agent":
          return auditParts[1]
            ? `Show audit trail entries for the ${auditParts[1]} agent.`
            : "Which agent's decisions should I look up?";
        case "position":
          return auditParts[1]
            ? `Show all decisions related to position ${auditParts[1]}.`
            : "Which position ID should I look up?";
        case "decision":
          return auditParts[1]
            ? `Get the full decision path for decision ${auditParts[1]}. Show the complete reasoning chain, inputs, and outcomes.`
            : "Which decision ID should I trace? Use /audit recent to find decision IDs.";
        case "activity":
          return auditParts[1]
            ? `Show agent activity summary for the ${auditParts[1]} agent — total decisions, success rate, common actions.`
            : "Show agent activity summary for all agents — total decisions, success rates, and common actions.";
        case "stats":
          return "Show audit statistics and trends — decision volume over time, success rates by agent, common failure reasons.";
        default:
          return "Show me the most recent decisions from the audit trail.";
      }
    // Health command
    case "health":
      return "Run a portfolio health check. Show risk status, strategy health, and any warnings.";
    // Blockchain Network commands
    case "chains":
      return "Show me which blockchain networks are configured and available. For each configured chain, show the available tools and capabilities. For unconfigured chains, show what keys are needed.";
    case "bridge":
      if (args) {
        return `Help me bridge tokens cross-chain using Chainlink CCIP: ${args}. Show me the fee estimate before executing.`;
      }
      return "Help me bridge tokens cross-chain using Chainlink CCIP. Show me supported chains and tokens.";
    case "solana": {
      if (!args) return "Show me Solana DeFi options — what can I do on Solana? Show my Solana balance if configured.";
      const solSubcmd = args.split(/\s+/)[0]?.toLowerCase();
      const solArgs = args.split(/\s+/).slice(1).join(" ");
      switch (solSubcmd) {
        case "swap": return solArgs ? `Swap tokens on Solana: ${solArgs}` : "Help me swap tokens on Solana. What pair?";
        case "stake": return solArgs ? `Stake SOL: ${solArgs}` : "Help me stake SOL. Show me staking options.";
        case "lend": return solArgs ? `Lend on Solana: ${solArgs}` : "Show me Solana lending options.";
        case "launch": return solArgs ? `Launch a token on Solana: ${solArgs}` : "Help me launch a token on Solana.";
        case "balance": return "Show my Solana wallet balance and token holdings.";
        default: return `Solana action: ${args}`;
      }
    }
    case "polkadot": {
      if (!args) return "Show me Polkadot ecosystem options — what can I do on Polkadot/HydraDX? Show my balance if configured.";
      const dotSubcmd = args.split(/\s+/)[0]?.toLowerCase();
      const dotArgs = args.split(/\s+/).slice(1).join(" ");
      switch (dotSubcmd) {
        case "swap": return dotArgs ? `Swap on HydraDX: ${dotArgs}` : "Help me swap on HydraDX.";
        case "stake": return dotArgs ? `Stake DOT: ${dotArgs}` : "Help me stake DOT. Show staking options.";
        case "transfer": return dotArgs ? `Transfer on Polkadot: ${dotArgs}` : "Help me transfer tokens on Polkadot.";
        case "balance": return "Show my Polkadot wallet balance.";
        default: return `Polkadot action: ${args}`;
      }
    }
    case "prices":
      if (args) {
        const pairs = args.split(/\s+/).map((s) => s.toUpperCase());
        return `Get real-time Chainlink Data Streams prices for: ${pairs.join(", ")}. Show bid, ask, and timestamp.`;
      }
      return "Get real-time Chainlink Data Streams prices for major crypto pairs (BTC, ETH, SOL, LINK, etc.)";
    case "base": {
      const sub = args?.trim().toLowerCase();
      if (sub === "trending") return "Show me trending dApps and featured projects on Base L2 from the Onchain Registry";
      if (sub === "signals") return "Detect trading signals on Base: whale transfers, volume spikes, new listings, and DEX pressure";
      if (sub === "whales") return "Show recent whale transfers on Base L2 using Basescan data";
      if (sub === "dex") return "Show Base DEX analytics: top pairs by volume, new token listings, and boosted tokens from DexScreener";
      if (sub) return `Explore Base L2: ${args}`;
      return "Show me an overview of the Base L2 ecosystem: trending apps, recent signals, and DEX activity";
    }
    // SynthData commands
    case "synth": {
      if (!args) return "Show me SynthData AI prediction capabilities. Supported assets: BTC, ETH, SOL, XAU, SPYX, NVDAX, TSLAX, AAPLX, GOOGLX";
      const synthParts = args.split(/\s+/);
      const synthSub = synthParts[0]?.toLowerCase();
      const synthAsset = synthParts[1]?.toUpperCase();
      switch (synthSub) {
        case "predict":
        case "prediction":
        case "forecast":
          return synthAsset
            ? `Get the AI price prediction percentiles for ${synthAsset} from SynthData. Show the probability cone with 5th to 95th percentile bands.`
            : "Which asset to predict? Supported: BTC, ETH, SOL, XAU, SPYX, NVDAX, TSLAX, AAPLX, GOOGLX";
        case "volatility":
        case "vol":
          return synthAsset
            ? `Get the AI volatility forecast for ${synthAsset} from SynthData. Compare predicted vs realized volatility.`
            : "Which asset? Supported: BTC, ETH, SOL, XAU, SPYX, NVDAX, TSLAX, AAPLX, GOOGLX";
        case "options":
        case "option":
          return synthAsset
            ? `Get AI-based option pricing for ${synthAsset} from SynthData. Show theoretical call/put values by strike.`
            : "Which asset? Supported: BTC, ETH, SOL, XAU, SPYX, NVDAX, TSLAX, AAPLX, GOOGLX";
        case "lp":
        case "lp-range":
          return synthAsset
            ? `Get optimal LP range for ${synthAsset} from SynthData. Show Uniswap V3 bounds, IL estimates, and probability distribution.`
            : "Which asset? Supported: BTC, ETH, SOL, XAU, SPYX, NVDAX, TSLAX, AAPLX, GOOGLX";
        case "liquidation":
        case "liq":
          return synthAsset
            ? `Get AI liquidation probability forecast for ${synthAsset} from SynthData. Show long/short liquidation risk over 24h.`
            : "Which asset? Supported: BTC, ETH, SOL, XAU, SPYX, NVDAX, TSLAX, AAPLX, GOOGLX";
        case "miners":
        case "leaderboard":
          return synthAsset
            ? `Show the top AI prediction miners for ${synthAsset} from SynthData.`
            : "Show the top AI prediction miners from SynthData.";
        default:
          // Treat first arg as asset for default predict action
          return `Get the AI price prediction percentiles for ${(synthSub ?? "BTC").toUpperCase()} from SynthData. Show the probability cone.`;
      }
    }
    case "predict": {
      if (!args) return "Which asset to predict? Supported: BTC, ETH, SOL, XAU, SPYX, NVDAX, TSLAX, AAPLX, GOOGLX";
      const predParts = args.split(/\s+/);
      const predAsset = predParts[0]?.toUpperCase();
      const predDays = predParts[1];
      return `Get the AI price prediction cone for ${predAsset} from SynthData${predDays ? ` over ${predDays} days` : ""}. Show the 5th to 95th percentile probability bands.`;
    }
    // Risk & Simulation commands
    case "liquidation": {
      if (!args) return "Analyze liquidation risks across my open positions. Show cascade risk, liquidation pressure, and any squeeze candidates.";
      const liqParts = args.split(/\s+/);
      const liqSub = liqParts[0]?.toLowerCase();
      const liqSymbol = liqParts[1]?.toUpperCase();
      switch (liqSub) {
        case "cascade":
          return liqSymbol
            ? `Analyze cascade liquidation risk for ${liqSymbol}. Show chain reaction scenarios and exposure.`
            : "Analyze cascade liquidation risk across the market. Show vulnerable positions and chain reaction scenarios.";
        case "pressure":
          return liqSymbol
            ? `Measure liquidation pressure on ${liqSymbol}. Show concentration of stop-losses and liquidation levels.`
            : "Measure liquidation pressure across my positions. Show which are most at risk.";
        case "crowding":
          return liqSymbol
            ? `Analyze crowding in ${liqSymbol} positions. Show how many traders are in similar positions.`
            : "Analyze crowding across positions. Show which trades are in overcrowded territory.";
        case "squeeze":
          return liqSymbol
            ? `Analyze squeeze potential for ${liqSymbol}. Is a short or long squeeze likely?`
            : "Find potential squeeze candidates across the market. Show short and long squeeze probabilities.";
        default:
          return `Analyze liquidation risks for ${args}`;
      }
    }
    case "simulate": {
      const simSub = args?.trim().toLowerCase();
      if (simSub === "orders" || simSub === "bundle") return "Simulate my pending order bundle. Show projected fills, slippage, and execution impact before going live.";
      if (simSub === "breaker" || simSub === "circuit") return "Generate a circuit breaker proof for the current state. Verify that safety mechanisms are properly configured.";
      if (simSub === "verify") return "Verify the integrity of a previously generated circuit breaker proof.";
      if (simSub === "regime") return "Query regime-scoped memory context. Show what the system remembers about current market conditions and how it affects decisions.";
      if (simSub) return `Simulate: ${args}. Show projected outcomes before executing.`;
      return "Simulate pending orders before execution. Show projected fills, slippage, and impact analysis.";
    }
    default:
      return args || command.description;
  }
}

// ============================================================================
// ACCESSIBILITY: Paginated Help Functions
// Shows 15 commands per page instead of overwhelming users with 50+ at once
// ============================================================================

const PAGINATED_HELP_CATEGORIES: Record<string, string> = {
  market: "Market Discovery",
  trading: "Trading",
  strategy: "Strategy & Runtime",
  account: "Account",
  system: "System",
};

/**
 * Format paginated command help for accessibility
 * @param args - "page N" for pagination, category name, or empty for summary
 */
export function formatPaginatedCommandHelp(args?: string): string {
  const PAGE_SIZE = 15;
  const parsedArgs = args?.toLowerCase().trim() || "";

  // Handle page request
  const pageMatch = parsedArgs.match(/^page\s*(\d+)$/);
  if (pageMatch && pageMatch[1]) {
    return formatHelpPageView(parseInt(pageMatch[1], 10), PAGE_SIZE);
  }

  // Handle category filter (with aliases)
  const categoryAlias = parsedArgs === "strategies" ? "strategy" : parsedArgs;
  if (categoryAlias in PAGINATED_HELP_CATEGORIES) {
    return formatHelpCategoryView(categoryAlias);
  }

  // Handle "all"
  if (parsedArgs === "all") return formatHelpPageView(1, PAGE_SIZE);

  // Default: accessible summary
  return formatHelpSummaryView();
}

function formatHelpSummaryView(): string {
  const total = SLASH_COMMANDS.length;
  const lines: string[] = [
    "**Gordon Help** - Command Reference\n",
    `Gordon has **${total} commands** in these categories:\n`,
  ];

  for (const [cat, label] of Object.entries(PAGINATED_HELP_CATEGORIES)) {
    const cmds = SLASH_COMMANDS.filter((c) => c.category === cat);
    const icon = cat === "market" ? "◆" : cat === "trading" ? "▲" : cat === "strategy" ? "◇" : cat === "account" ? "■" : "●";
    lines.push(`  ${icon} **${label}** (${cmds.length}) - \`/help ${cat}\``);
  }

  lines.push("\n**Essential Commands:**");
  const essentialCmds = SLASH_COMMANDS.filter((c) => c.level === 1).slice(0, 11);
  for (const cmd of essentialCmds) {
    lines.push(`  /${cmd.name} - ${cmd.description}`);
  }

  lines.push("\n---");
  lines.push("**Browse:** `/help <category>` | `/help page 1` | `/help <topic>`");
  return lines.join("\n");
}

function formatHelpPageView(page: number, pageSize: number): string {
  const total = SLASH_COMMANDS.length;
  const totalPages = Math.ceil(total / pageSize);
  const currentPage = Math.max(1, Math.min(page, totalPages));
  const start = (currentPage - 1) * pageSize;
  const end = Math.min(start + pageSize, total);
  const pageCommands = SLASH_COMMANDS.slice(start, end);

  const lines: string[] = [
    `**All Commands** - Page ${currentPage} of ${totalPages} (${start + 1}-${end} of ${total})\n`,
  ];

  let lastCat = "";
  for (const cmd of pageCommands) {
    if (cmd.category !== lastCat) {
      if (lastCat !== "") lines.push("");
      const catLabel = PAGINATED_HELP_CATEGORIES[cmd.category] || cmd.category;
      lines.push(`**${catLabel}**`);
      lastCat = cmd.category;
    }
    lines.push(`  /${cmd.name} - ${cmd.description}`);
  }

  lines.push("\n---");
  const nav: string[] = [];
  if (currentPage > 1) nav.push(`\`/help page ${currentPage - 1}\``);
  if (currentPage < totalPages) nav.push(`\`/help page ${currentPage + 1}\``);
  nav.push("`/help`");
  lines.push("Navigate: " + nav.join(" | "));
  return lines.join("\n");
}

function formatHelpCategoryView(category: string): string {
  const cmds = SLASH_COMMANDS.filter((c) => c.category === category);
  const label = PAGINATED_HELP_CATEGORIES[category] || category;

  const lines: string[] = [`**${label} Commands** (${cmds.length})\n`];
  for (const cmd of cmds) {
    const aliases = cmd.aliases.length > 0 ? ` (${cmd.aliases[0]})` : "";
    lines.push(`  /${cmd.name}${aliases} - ${cmd.description}`);
  }

  lines.push("\n---");
  const otherCats = Object.entries(PAGINATED_HELP_CATEGORIES)
    .filter(([cat]) => cat !== category)
    .map(([cat]) => `\`/help ${cat}\``)
    .join(" | ");
  lines.push("Other: " + otherCats + " | `/help`");
  return lines.join("\n");
}
