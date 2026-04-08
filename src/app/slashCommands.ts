/**
 * Slash Commands System
 * Defines all available slash commands for quick actions
 */

import {
  getGeneratedSlashCommands,
  mergeSlashCommands,
} from "../infra/runtime/actions/surfaces.ts";
import {
  type CommandAudience,
  type LegacyCommandCategory,
  type WorkflowGroup,
  getAudienceFromLevel,
  getAudienceLabel,
  normalizeCommandUx,
  resolveWorkflowTopic,
  sortCommandsForPresentation,
} from "./commandUx.ts";

export type CommandLevel = 1 | 2 | 3;

export interface SlashCommand {
  name: string;
  aliases: string[];
  description: string;
  usage: string;
  category: LegacyCommandCategory;
  level: CommandLevel;
  workflow: WorkflowGroup;
  workflowLabel: string;
  workflowOrder: number;
  audience: CommandAudience;
  audienceLabel: string;
  audienceOrder: number;
  hideAliasesByDefault: boolean;
  action: "agent" | "tool" | "menu";
  target?: string;
  executionTime?: string;
  whenToUse?: string;
  subcommands?: string[];
  subcommandDescriptions?: Record<string, string>;
  hideFromTypeahead?: boolean;
}

type SlashCommandSeed = Omit<
  SlashCommand,
  "workflow" | "workflowLabel" | "workflowOrder" | "audience" | "audienceLabel" | "audienceOrder" | "hideAliasesByDefault" | "subcommands" | "subcommandDescriptions" | "hideFromTypeahead"
> & {
  subcommands?: string[];
  subcommandDescriptions?: Record<string, string>;
  hideFromTypeahead?: boolean;
};

export const DIRECT_MENU_TARGETS = new Set([
  "setup",
  "menu",
  "chat",
  "workspace-market",
  "workspace-plan",
  "workspace-lab",
  "workspace-monitor",
  "configure",
  "doctor",
  "model",
  "shortcuts",
  "theme",
  "resume",
  "new-session",
  "session-info",
  "runtime-state",
  "runtime-plugins",
  "runtime-transcript",
  "runtime-scratchpad",
  "runtime-handoffs",
  "runtime-approvals",
  "runtime-approve",
  "runtime-deny",
  "runtime-bridge",
  "runtime-history",
  "clone-thread",
  "list-threads",
  "switch-thread",
  "thread-info",
  "delete-thread",
  "rename-thread",
  "action-log",
  "bookmark-entry",
  "list-bookmarks",
  "thread-summary",
  "compact-thread",
  "portfolio",
  "telemetry",
  "context",
  "watch-panel",
  "strategy-panel",
  "thread-panel",
  "log-panel",
]);

export const DIRECT_TOOL_TARGETS = new Set([
  "handle_config_command",
  "handle_exchange_command",
  "handle_broker_command",
  "handle_stocks_command",
  "check_positions",
  "get_open_orders",
  "set_permission_mode",
  "test_connection",
  "get_cache_stats",
  "handle_mcp_command",
  "handle_routing_command",
  "handle_workflow_command",
  "handle_export_command",
  "handle_keyring_command",
  "handle_telemetry_command",
  "cancel_order",
  "close_position",
  "set_stop_loss",
  "set_take_profit",
  "handle_alerts_command",
]);


const LEGACY_SLASH_COMMANDS: SlashCommandSeed[] = [
  // Market Discovery
  {
    name: "scan",
    aliases: ["s"],
    description: "Scan crypto markets for trading setups (~10-30s)",
    usage: "/scan",
    category: "market",
    level: 1,
    action: "agent",
    target: "scanner",
    executionTime: "~10-30s",
    whenToUse: "Discover crypto setups across multiple symbols",
  },
  {
    name: "trending",
    aliases: ["t", "hot"],
    description: "Show trending crypto tokens (biggest movers)",
    usage: "/trending [gainers|losers]",
    category: "market",
    level: 1,
    action: "tool",
    target: "get_trending_tokens",
  },
  {
    name: "volume",
    aliases: ["v", "liquid"],
    description: "Show highest-volume crypto markets",
    usage: "/volume",
    category: "market",
    level: 2,
    action: "tool",
    target: "get_high_volume_tokens",
  },
  {
    name: "analyze",
    aliases: ["a", "quick"],
    description: "Single-symbol analysis (~3-5s)",
    usage: "/analyze <symbol>",
    category: "market",
    level: 1,
    action: "agent",
    target: "analyst",
    executionTime: "~3-5s",
    whenToUse: "Quick check on a symbol or ticker",
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
    description: "Create a trade plan for a symbol",
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
    description: "Check active positions across crypto or stocks",
    usage: "/positions",
    category: "trading",
    level: 2,
    action: "tool",
    target: "check_positions",
  },
  {
    name: "orders",
    aliases: ["o"],
    description: "View open orders across crypto or stocks",
    usage: "/orders",
    category: "trading",
    level: 2,
    action: "tool",
    target: "get_open_orders",
  },
  {
    name: "auto",
    aliases: [],
    description: "Auto-execute trades without per-action approval (highest trust)",
    usage: "/auto",
    category: "trading",
    level: 2,
    action: "tool",
    target: "set_permission_mode",
    whenToUse: "You want Gordon to execute trades without stopping for each approval",
  },
  {
    name: "ask",
    aliases: [],
    description: "Approve each trade via dialog (default, recommended)",
    usage: "/ask",
    category: "trading",
    level: 2,
    action: "tool",
    target: "set_permission_mode",
    whenToUse: "Default mode — plan→approve→execute for every trade",
  },
  {
    name: "strict",
    aliases: ["readonly"],
    description: "Read-only — block all trades, analysis + planning only",
    usage: "/strict",
    category: "trading",
    level: 2,
    action: "tool",
    target: "set_permission_mode",
    whenToUse: "You want Gordon to analyze and plan but never trade",
  },

  // New Trading Commands
  { name: "cancel", aliases: [], description: "Cancel open orders by ID or symbol", usage: "/cancel <symbol|orderId>", category: "trading", level: 1, action: "tool", target: "cancel_order", whenToUse: "Cancel pending orders" },
  { name: "close", aliases: [], description: "Close an open position", usage: "/close <symbol> [market|limit <price>]", category: "trading", level: 1, action: "tool", target: "close_position", whenToUse: "Close a position at market or limit price" },
  { name: "stop-loss", aliases: ["sl"], description: "Set stop-loss on a position", usage: "/stop-loss <symbol> <price>", category: "trading", level: 2, action: "tool", target: "set_stop_loss", whenToUse: "Protect position with stop-loss" },
  { name: "take-profit", aliases: ["tp"], description: "Set take-profit on a position", usage: "/take-profit <symbol> <price>", category: "trading", level: 2, action: "tool", target: "set_take_profit", whenToUse: "Set profit target" },
  { name: "watch", aliases: ["w"], description: "Watch symbol prices live", usage: "/watch <symbol> [interval]", category: "market", level: 1, action: "menu", target: "watch-panel", whenToUse: "Monitor price changes in real-time" },
  { name: "alerts", aliases: ["alert"], description: "Manage price alerts", usage: "/alerts [set|list|delete] <symbol> [price]", category: "market", level: 1, action: "tool", target: "handle_alerts_command", whenToUse: "Get notified when price hits target" },

  // Account
  {
    name: "portfolio",
    aliases: ["pf", "balance"],
    description: "View portfolio and balances across crypto or stocks",
    usage: "/portfolio",
    category: "account",
    level: 1,
    action: "menu",
    target: "portfolio",
  },
  {
    name: "wallet",
    aliases: ["funds", "wallets"],
    description: "Wallet rails status, funding, MoonPay history, and virtual-account workflows",
    usage: "/wallet [status|solana|fund|history|virtual]",
    category: "account",
    level: 1,
    action: "agent",
    target: "gordon",
    whenToUse: "Inspect Gordon wallet rails and connected wallet workflows",
  },
  {
    name: "fund",
    aliases: ["onramp", "offramp"],
    description: "Create MoonPay flows or fetch quotes and limits",
    usage: "/fund [buy|sell|swap|quote|limits|history] ...",
    category: "trading",
    level: 2,
    action: "agent",
    target: "executor",
    whenToUse: "Fund a wallet, off-ramp, create a hosted swap flow, or inspect live MoonPay pricing and limits",
  },
  {
    name: "pay",
    aliases: ["x402", "payments"],
    description: "Prepare Polygon x402 payment intents for paid APIs or agent payments",
    usage: "/pay <resource> <amount>",
    category: "trading",
    level: 2,
    action: "agent",
    target: "executor",
    whenToUse: "Prepare Gordon-native payment headers for external services",
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
    name: "strategy",
    aliases: ["strategies", "strat", "strats"],
    description: "View and manage trading strategies",
    usage: "/strategy [list|running|gen|deploy|pause|resume|stop|rebalance]",
    category: "strategy",
    level: 1,
    action: "menu",
    target: "strategy-panel",
    subcommands: ["list", "running", "gen", "deploy", "pause", "resume", "stop", "rebalance", "info", "compare"],
    subcommandDescriptions: { list: "List all strategies", running: "Show running strategies", gen: "Generate a new strategy", deploy: "Deploy to live", pause: "Pause a running strategy", resume: "Resume paused strategy", stop: "Stop a strategy", rebalance: "Rebalance allocations", info: "Strategy details", compare: "Compare strategies" },
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
  {
    name: "systematic",
    aliases: ["sys"],
    description: "Systematic research status — profile, datasets, experiments, portfolio, lifecycle",
    usage: "/systematic [status|portfolio|datasets|experiments|lifecycle] [strategy]",
    category: "strategy",
    level: 2,
    action: "agent",
    target: "backtester",
    whenToUse: "Inspect systematic research state and portfolio-level validation context",
  },
  {
    name: "dataset",
    aliases: ["datasets"],
    description: "Dataset and snapshot workflows for systematic research",
    usage: "/dataset [list|snapshots|show|export] [id|strategy]",
    category: "strategy",
    level: 2,
    action: "agent",
    target: "backtester",
    whenToUse: "Inspect reproducible datasets, snapshots, and export research artifacts",
  },
  {
    name: "decay",
    aliases: ["drift"],
    description: "Show strategy decay and degradation state",
    usage: "/decay <strategy>",
    category: "strategy",
    level: 2,
    action: "agent",
    target: "monitor",
    whenToUse: "Check whether a systematic strategy is degrading relative to prior validation",
  },
  {
    name: "validate",
    aliases: ["validation"],
    description: "Inspect validation gates and bias blockers for a strategy",
    usage: "/validate <strategy>",
    category: "strategy",
    level: 2,
    action: "agent",
    target: "backtester",
    whenToUse: "Review systematic validation and promotion blockers before paper/live deployment",
  },
  {
    name: "runtime",
    aliases: ["rt"],
    description: "Runtime health, slots, and live-vs-backtest diff",
    usage: "/runtime [health|slots|diff <strategy>]",
    category: "strategy",
    level: 2,
    action: "agent",
    target: "monitor",
    whenToUse: "Inspect active strategy slots and compare live runtime to validated backtests",
    subcommands: ["state", "plugins", "transcript", "scratchpad", "handoffs", "approvals", "approve", "deny", "bridge", "history", "health", "slots", "diff"],
    subcommandDescriptions: {
      state: "Inspect runtime state and scopes",
      plugins: "Plugin lifecycle and hot-reload",
      transcript: "In-memory transcript",
      scratchpad: "Worker scratchpad entries",
      handoffs: "Recorded worker handoffs",
      approvals: "Pending approval decisions",
      approve: "Approve a pending request",
      deny: "Deny a pending request",
      bridge: "Bridge ingress and remote sessions",
      history: "Search persisted history",
      health: "Strategy slot health",
      slots: "Running strategy slots",
      diff: "Live vs backtest comparison",
    },
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
    description: "Open Advanced setup and configuration",
    usage: "/setup",
    category: "system",
    level: 1,
    action: "menu",
    target: "setup",
  },
  {
    name: "menu",
    aliases: ["home"],
    description: "Open Quick Actions and workflow navigation",
    usage: "/menu",
    category: "system",
    level: 1,
    action: "menu",
    target: "menu",
  },
  {
    name: "chat",
    aliases: ["desk"],
    description: "Return to the chat workspace",
    usage: "/chat",
    category: "system",
    level: 1,
    action: "menu",
    target: "chat",
  },
  {
    name: "market",
    aliases: ["markets"],
    description: "Open the market discovery workspace",
    usage: "/market",
    category: "system",
    level: 1,
    action: "menu",
    target: "workspace-market",
  },
  {
    name: "plans",
    aliases: ["plan-board"],
    description: "Open the trade planning workspace",
    usage: "/plans",
    category: "system",
    level: 1,
    action: "menu",
    target: "workspace-plan",
  },
  {
    name: "lab",
    aliases: ["research-lab"],
    description: "Open the strategy and research workspace",
    usage: "/lab",
    category: "system",
    level: 1,
    action: "menu",
    target: "workspace-lab",
  },
  {
    name: "monitor",
    aliases: ["ops"],
    description: "Open the live monitoring workspace",
    usage: "/monitor",
    category: "system",
    level: 1,
    action: "menu",
    target: "workspace-monitor",
  },
  {
    name: "configure",
    aliases: ["cfg"],
    description: "Re-run setup for a specific area or the full advanced flow",
    usage: "/configure [exchange|broker|chains|rails|mcp|llm|preferences|advanced]",
    category: "system",
    level: 1,
    action: "menu",
    target: "configure",
  },
  {
    name: "doctor",
    aliases: ["diag", "diagnostics"],
    description: "Run Gordon diagnostics across config, credentials, and plugins",
    usage: "/doctor",
    category: "system",
    level: 1,
    action: "menu",
    target: "doctor",
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
    name: "broker",
    aliases: ["brokers", "br"],
    description: "Manage stock/options brokers",
    usage: "/broker [list|add|switch|remove|status]",
    category: "account",
    level: 2,
    action: "tool",
    target: "handle_broker_command",
    executionTime: "~1-3s",
    whenToUse: "Configure stock broker credentials and choose the active broker",
  },
  {
    name: "stocks",
    aliases: ["stock", "equities", "eq"],
    description: "Stock broker commands (account, quote, positions, orders, buy/sell)",
    usage: "/stocks [account|quote|positions|orders|buy|sell]",
    category: "account",
    level: 2,
    action: "tool",
    target: "handle_stocks_command",
    executionTime: "~1-3s",
    whenToUse: "Use stock market broker actions via the active broker",
  },
  {
    name: "model",
    aliases: ["m", "provider"],
    description: "View or change AI model and provider",
    usage: "/model [provider] [model]",
    category: "system",
    level: 1,
    action: "menu",
    target: "model",
    whenToUse: "Switch between AI providers (openai, anthropic, google, inception, dedalus) or specific models",
  },
  {
    name: "mcp",
    aliases: ["plugins"],
    description: "Manage MCP servers — list, add, remove, reconnect",
    usage: "/mcp",
    category: "system",
    level: 2,
    action: "menu",
    target: "mcp",
    whenToUse: "Manage connected MCP plugin servers",
  },
  {
    name: "marketplace",
    aliases: ["store"],
    description: "Browse and install trading MCP plugins from the curated catalog",
    usage: "/marketplace",
    category: "system",
    level: 1,
    action: "menu",
    target: "marketplace",
    whenToUse: "Find and install new data providers, exchanges, analytics tools",
  },
  {
    name: "cli",
    aliases: ["tools"],
    description: "Browse available trading CLI tools and check installation status",
    usage: "/cli",
    category: "system",
    level: 2,
    action: "menu",
    target: "cli",
    whenToUse: "View trading CLIs like Kraken, Boba, Jupiter, OpenBB",
  },
  {
    name: "compact",
    aliases: [],
    description: "Manually trigger context compaction to free up token budget",
    usage: "/compact",
    category: "system",
    level: 2,
    action: "menu",
    target: "compact",
    whenToUse: "When context feels bloated or you want to force a cleanup",
  },
  {
    name: "clear",
    aliases: ["reset"],
    description: "Clear conversation history within the current session",
    usage: "/clear",
    category: "system",
    level: 1,
    action: "menu",
    target: "clear",
  },
  {
    name: "cost",
    aliases: ["spending"],
    description: "Show detailed per-model cost breakdown for this session",
    usage: "/cost",
    category: "system",
    level: 2,
    action: "menu",
    target: "cost",
  },
  {
    name: "effort",
    aliases: [],
    description: "Set reasoning effort level (low/medium/high/max/auto)",
    usage: "/effort [level]",
    category: "system",
    level: 2,
    action: "menu",
    target: "effort",
    whenToUse: "Control how much reasoning the model does — low is fast, max is deep",
  },
  {
    name: "skills",
    aliases: [],
    description: "List available trading skills (builtin + user-defined)",
    usage: "/skills",
    category: "system",
    level: 2,
    action: "menu",
    target: "skills",
    whenToUse: "See what reusable trading workflows are available",
  },
  {
    name: "hooks",
    aliases: [],
    description: "View registered lifecycle hooks (PreToolUse, PostToolUse, etc.)",
    usage: "/hooks",
    category: "system",
    level: 3,
    action: "menu",
    target: "hooks",
    whenToUse: "Debug which hooks are active and at what priority",
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
    subcommands: ["info", "resume", "new", "browser"],
    subcommandDescriptions: { info: "Current session info", resume: "Resume previous session", new: "Start new session", browser: "Browse past sessions" },
  },
  {
    name: "runtime-state",
    aliases: ["rstate", "rs"],
    description: "Inspect runtime state, scopes, transcript stats, and recent worker activity",
    usage: "/runtime-state",
    category: "system",
    level: 3,
    action: "menu",
    target: "runtime-state",
  },
  {
    name: "runtime-plugins",
    aliases: ["rplugins"],
    description: "Inspect runtime plugin lifecycle, routing, and hot-reload state",
    usage: "/runtime-plugins",
    category: "system",
    level: 3,
    action: "menu",
    target: "runtime-plugins",
  },
  {
    name: "runtime-transcript",
    aliases: ["transcript", "rtranscript"],
    description: "Inspect the in-memory runtime transcript for the active session",
    usage: "/runtime-transcript [limit]",
    category: "system",
    level: 3,
    action: "menu",
    target: "runtime-transcript",
  },
  {
    name: "runtime-scratchpad",
    aliases: ["scratchpad", "notes"],
    description: "Inspect worker scratchpad entries for the active runtime",
    usage: "/runtime-scratchpad [worker]",
    category: "system",
    level: 3,
    action: "menu",
    target: "runtime-scratchpad",
  },
  {
    name: "runtime-handoffs",
    aliases: ["handoffs", "delegations"],
    description: "Inspect recorded worker handoffs for the active runtime",
    usage: "/runtime-handoffs",
    category: "system",
    level: 3,
    action: "menu",
    target: "runtime-handoffs",
  },
  {
    name: "runtime-approvals",
    aliases: ["approvals"],
    description: "Inspect pending and recent runtime approval decisions",
    usage: "/runtime-approvals",
    category: "system",
    level: 3,
    action: "menu",
    target: "runtime-approvals",
  },
  {
    name: "runtime-approve",
    aliases: [],
    description: "Approve a pending runtime approval request",
    usage: "/runtime-approve <request-id> [persist]",
    category: "system",
    level: 3,
    action: "menu",
    target: "runtime-approve",
  },
  {
    name: "runtime-deny",
    aliases: [],
    description: "Deny a pending runtime approval request",
    usage: "/runtime-deny <request-id> [persist] [reason]",
    category: "system",
    level: 3,
    action: "menu",
    target: "runtime-deny",
  },
  {
    name: "runtime-bridge",
    aliases: ["bridge"],
    description: "Inspect runtime bridge ingress and remote sessions",
    usage: "/runtime-bridge",
    category: "system",
    level: 3,
    action: "menu",
    target: "runtime-bridge",
  },
  {
    name: "runtime-history",
    aliases: ["rhistory"],
    description: "Search persisted runtime history or list recent runtime sessions",
    usage: "/runtime-history [query] [limit]",
    category: "system",
    level: 3,
    action: "menu",
    target: "runtime-history",
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
    usage: "/workflow [quick|dd|backtest-cycle] <args>",
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
    name: "thread",
    aliases: ["threads"],
    description: "Manage conversation threads",
    usage: "/thread [list|clone|switch|info|delete|rename|summary|compact]",
    category: "system",
    level: 2,
    action: "menu",
    target: "thread-panel",
    subcommands: ["list", "clone", "switch", "info", "delete", "rename", "summary", "compact"],
    subcommandDescriptions: { list: "List recent threads", clone: "Clone current thread", switch: "Switch to thread", info: "Thread details", delete: "Delete a thread", rename: "Rename a thread", summary: "Thread summary", compact: "Compact thread" },
  },
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
    aliases: ["rt", "label-thread", "name"],
    description: "Rename/label a thread",
    usage: "/rename-thread <threadId> <new-label>",
    category: "system",
    level: 3,
    action: "menu",
    target: "rename-thread",
  },
  {
    name: "log",
    aliases: [],
    description: "View action log and bookmarks",
    usage: "/log [actions|bookmark|bookmarks]",
    category: "system",
    level: 3,
    action: "menu",
    target: "log-panel",
    subcommands: ["actions", "bookmark", "bookmarks"],
    subcommandDescriptions: { actions: "Recent action log", bookmark: "Bookmark a message", bookmarks: "List bookmarks" },
  },
  {
    name: "action-log",
    aliases: ["alog", "events"],
    description: "Inspect typed action log entries for the current thread or daemon",
    usage: "/action-log [type|group|bookmarked|daemon|threadId] [limit]",
    category: "system",
    level: 3,
    action: "menu",
    target: "action-log",
  },
  {
    name: "bookmark",
    aliases: ["bm", "pin"],
    description: "Bookmark an action-log entry by ID or bookmark the latest entry",
    usage: "/bookmark [entryId|last] [label]",
    category: "system",
    level: 3,
    action: "menu",
    target: "bookmark-entry",
  },
  {
    name: "bookmarks",
    aliases: ["pins", "saved"],
    description: "List bookmarked action-log entries",
    usage: "/bookmarks [threadId|daemon] [limit]",
    category: "system",
    level: 3,
    action: "menu",
    target: "list-bookmarks",
  },
  {
    name: "thread-summary",
    aliases: ["tsummary", "branch-summary", "summary"],
    description: "Summarize a thread using the typed action log",
    usage: "/thread-summary [threadId]",
    category: "system",
    level: 3,
    action: "menu",
    target: "thread-summary",
  },
  {
    name: "compact-thread",
    aliases: ["compact", "summarize-thread"],
    description: "Persist a compact thread summary from recent typed action-log entries",
    usage: "/compact-thread [threadId] [note]",
    category: "system",
    level: 3,
    action: "menu",
    target: "compact-thread",
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
    aliases: ["mandate", "swing"],
    description: "Set up and control autonomous swing trading",
    usage: "/autonomous [start|stop|pause|resume|status]",
    category: "trading",
    level: 2,
    action: "menu",
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
    description: "Manage telemetry consent, Axiom export, and research data collection (opt-in)",
    usage: "/telemetry [status|enable|disable|research-enable|research-disable|research-status|research-upload|research-clear]",
    category: "system",
    level: 2,
    action: "menu",
    target: "telemetry",
    whenToUse: "Enable/disable anonymous usage analytics or trading data collection for AI training",
  },
  {
    name: "context",
    aliases: ["cost", "ctx"],
    description: "Show prompt grounding, context budget, and latest model usage",
    usage: "/context [threadId]",
    category: "system",
    level: 2,
    action: "menu",
    target: "context",
    whenToUse: "Inspect how Gordon grounded the last request and how much prompt budget it used",
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
    name: "rails",
    aliases: ["providers", "wallet-rails"],
    description: "Show native wallet, chain-data, and payment rails",
    usage: "/rails",
    category: "system",
    level: 1,
    action: "agent",
    target: "gordon",
    whenToUse: "Inspect Helius, MoonPay, and Polygon x402 availability",
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
    description: "SynthData advanced — volatility, options, LP ranges, liquidation, miners (use /predict for price forecasts)",
    usage: "/synth [volatility|options|lp|liquidation|miners] <asset>",
    category: "market",
    level: 2,
    action: "agent",
    target: "analyst",
    executionTime: "~2-5s",
    whenToUse: "SynthData features beyond price forecasting — for price forecasts use /predict",
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

  // Phase 15-18: Panel commands
  {
    name: "settings-panel",
    aliases: [],
    description: "Open the settings panel",
    usage: "/settings-panel",
    category: "system",
    level: 1,
    action: "menu",
    target: "settings-panel",
  },
  {
    name: "export-panel",
    aliases: [],
    description: "Open the export panel",
    usage: "/export-panel",
    category: "system",
    level: 1,
    action: "menu",
    target: "export-panel",
  },
  {
    name: "emergency",
    aliases: ["sos", "kill-all"],
    description: "Open emergency stop panel — halt all operations",
    usage: "/emergency",
    category: "system",
    level: 1,
    action: "menu",
    target: "emergency",
  },
  {
    name: "context-viz",
    aliases: [],
    description: "Open context visualization panel",
    usage: "/context-viz",
    category: "system",
    level: 2,
    action: "menu",
    target: "context-viz",
  },
  {
    name: "session-browser",
    aliases: ["sessions"],
    description: "Open session browser panel",
    usage: "/session-browser",
    category: "system",
    level: 1,
    action: "menu",
    target: "session-browser",
  },
  {
    name: "memory-panel",
    aliases: [],
    description: "Open memory selector panel",
    usage: "/memory-panel",
    category: "system",
    level: 2,
    action: "menu",
    target: "memory-panel",
  },
  {
    name: "privacy",
    aliases: ["private"],
    description: "Toggle privacy mode — redact sensitive data from display",
    usage: "/privacy",
    category: "system",
    level: 1,
    action: "menu",
    target: "privacy",
  },
  {
    name: "journal",
    aliases: ["trade-journal", "diary"],
    description: "Show recent trade journal entries from memory",
    usage: "/journal [count]",
    category: "trading",
    level: 1,
    action: "menu",
    target: "journal",
  },
];

function normalizeSlashCommandRuntime(command: SlashCommand): SlashCommand {
  if (command.action === "tool" && command.target && !DIRECT_TOOL_TARGETS.has(command.target)) {
    return { ...command, action: "agent" };
  }

  return command;
}

export const SLASH_COMMANDS: SlashCommand[] = sortCommandsForPresentation(
  mergeSlashCommands(
    getGeneratedSlashCommands() as SlashCommandSeed[],
    LEGACY_SLASH_COMMANDS,
  )
    .map((command) => normalizeCommandUx(command))
    .map((command) => normalizeSlashCommandRuntime(command))
);

export function isDeterministicSlashCommand(command: SlashCommand): boolean {
  return command.action === "menu" || command.action === "tool";
}

export function isRuntimeHandledSlashCommand(command: SlashCommand): boolean {
  if (!isDeterministicSlashCommand(command) || !command.target) {
    return command.action === "agent";
  }

  if (command.action === "menu") {
    return DIRECT_MENU_TARGETS.has(command.target);
  }

  return DIRECT_TOOL_TARGETS.has(command.target);
}

export function getSlashCommandRuntimeDrift(commands: SlashCommand[] = SLASH_COMMANDS): SlashCommand[] {
  return commands.filter((command) => isDeterministicSlashCommand(command) && !isRuntimeHandledSlashCommand(command));
}

// ============================================================================
// Help System Types and Functions
// ============================================================================

/**
 * Help display modes for filtering commands by audience
 */
export type HelpMode = "essential" | "advanced" | "all" | "expert";

/**
 * Help topics for filtering commands by workflow
 */
export type HelpCategory = WorkflowGroup;

/**
 * Get commands filtered by level
 * @param maxLevel - Maximum level to include (1, 2, or 3)
 */
export function getCommandsByLevel(maxLevel: CommandLevel): SlashCommand[] {
  return SLASH_COMMANDS.filter((cmd) => cmd.level <= maxLevel);
}

/**
 * Get commands filtered by workflow
 * @param workflow - Workflow to filter by
 */
export function getCommandsByCategory(workflow: HelpCategory): SlashCommand[] {
  return SLASH_COMMANDS.filter((cmd) => cmd.workflow === workflow);
}

/**
 * Parse help mode from help command argument
 * @param arg - The argument passed to /help
 * @returns Parsed help mode and optional workflow
 */
export function parseHelpArg(arg: string): { mode: HelpMode; category?: HelpCategory } {
  const lowerArg = arg.toLowerCase().trim();

  if (lowerArg === "advanced") return { mode: "advanced" };
  if (lowerArg === "all" || lowerArg === "expert") return { mode: "all" };

  const workflow = resolveWorkflowTopic(lowerArg);
  if (workflow) {
    return { mode: "all", category: workflow };
  }

  return { mode: "essential" };
}

/**
 * Get audience label for display
 */
export function getLevelLabel(level: CommandLevel): string {
  return getAudienceLabel(getAudienceFromLevel(level));
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
  subcommand: string | null;
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
  const restParts = parts.slice(1);

  // Find matching command
  const command = SLASH_COMMANDS.find(
    (cmd) => cmd.name === commandName || cmd.aliases.includes(commandName)
  );

  if (!command) {
    return null;
  }

  // Check if command has subcommands and the next word matches one
  let subcommand: string | null = null;
  let args: string;

  if (command.subcommands && restParts.length > 0) {
    const candidateSub = restParts[0]?.toLowerCase() ?? "";
    if (command.subcommands.includes(candidateSub)) {
      subcommand = candidateSub;
      args = restParts.slice(1).join(" ");
    } else {
      args = restParts.join(" ");
    }
  } else {
    args = restParts.join(" ");
  }

  return { command, subcommand, args };
}

/**
 * Get command suggestions for autocomplete
 * @param partial - The partial input (including /)
 * @param maxLevel - Maximum level to include in suggestions (default: show all)
 * @returns Array of matching commands sorted by workflow, then alphabetically
 */
export function getSlashCommandSuggestions(
  partial: string,
  maxLevel: CommandLevel = 3
): SlashCommand[] {
  if (!partial.startsWith("/")) {
    return [];
  }

  const search = partial.slice(1).toLowerCase();

  const levelFiltered = SLASH_COMMANDS.filter((cmd) => cmd.level <= maxLevel);

  if (search === "") {
    return levelFiltered;
  }

  return levelFiltered
    .filter(
      (cmd) =>
        cmd.name.startsWith(search) ||
        cmd.aliases.some((alias) => alias.startsWith(search))
    )
    .sort((left, right) => {
      const workflowDiff = left.workflowOrder - right.workflowOrder;
      if (workflowDiff !== 0) return workflowDiff;
      return left.name.localeCompare(right.name);
    });
}

// ============================================================================
// Re-exports from extracted modules
// ============================================================================

export { commandToPrompt } from "./commandPrompts.ts";
export { formatCommandHelp, formatAnalysisCommandsHelp, formatPaginatedCommandHelp } from "./commandHelp.ts";
