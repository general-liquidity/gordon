/**
 * Command-to-Prompt Conversion
 * Converts slash commands into natural language prompts for the agent
 */

import { buildGeneratedPrompt } from "../infra/runtime/actions/surfaces.ts";
import { BrokerFactory } from "../infra/broker/index.ts";
import type { SlashCommand } from "./slashCommands.ts";

const BROKER_TOKENS = BrokerFactory.getSupportedBrokers();
const STOCK_MARKET_TOKENS = ["stock", "stocks", "equity", "equities", ...BROKER_TOKENS];
const STOCK_MARKET_PATTERN = new RegExp(`^\\s*(${STOCK_MARKET_TOKENS.join("|")})\\b`, "i");
const BROKER_TYPES_HINT = BROKER_TOKENS.join(", ");

/**
 * Convert slash command to natural language for the agent
 */
export function commandToPrompt(command: SlashCommand, args: string): string {
  const generatedPrompt = buildGeneratedPrompt(command.name, args);
  if (generatedPrompt) {
    return generatedPrompt;
  }

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
      if (STOCK_MARKET_PATTERN.test(args || "")) return "Show my current stock positions";
      return "Check my current positions";
    case "orders":
      if (STOCK_MARKET_PATTERN.test(args || "")) return "Show my open stock broker orders";
      return "Show my open orders";
    case "arm":
      return "Arm the system for live trading";
    case "disarm":
      return "Disarm the system and return to safe mode";
    case "portfolio":
      if (STOCK_MARKET_PATTERN.test(args || "")) return "Show my stock broker account summary";
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
    case "configure":
      return args ? `Open Gordon configure flow for ${args}` : "Open the Gordon configure flow";
    case "doctor":
      return "Run Gordon diagnostics and show me configuration issues";
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
          return "List all my configured crypto execution venues";
        case "add":
        case "new":
          return exArgs
            ? `Add a new ${exArgs} crypto venue configuration`
            : "Which crypto execution venue would you like to add? (binance, coinbase, kraken, bitfinex, hyperliquid, uniswap, robinhood, okx, gemini)";
        case "switch":
        case "use":
          return exArgs
            ? `Switch to using the "${exArgs}" crypto venue`
            : "Which crypto execution venue should I switch to?";
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
    case "broker":
      if (!args) return "List my configured stock brokers";
      const brokerParts = args.split(/\s+/);
      const brokerSubcmd = brokerParts[0]?.toLowerCase();
      const brokerArgs = brokerParts.slice(1).join(" ");
      switch (brokerSubcmd) {
        case "list":
        case "ls":
          return "List all my configured stock brokers";
        case "add":
        case "new":
          return brokerArgs
            ? `Add a new ${brokerArgs} broker configuration`
            : `What type of broker would you like to add? (${BROKER_TYPES_HINT})`;
        case "switch":
        case "use":
          return brokerArgs
            ? `Switch to using the "${brokerArgs}" broker`
            : "Which broker should I switch to?";
        case "remove":
        case "delete":
          return brokerArgs
            ? `Remove the "${brokerArgs}" broker configuration`
            : "Which broker should I remove?";
        case "status":
        case "check":
          return "Check the connection status for all configured brokers";
        case "help":
          return "Show help for broker management commands";
        default:
          return "List my configured stock brokers";
      }
    case "stocks":
      if (!args) return "Show stock broker command help";
      const stockParts = args.split(/\s+/);
      const stockSubcmd = stockParts[0]?.toLowerCase();
      const stockArgs = stockParts.slice(1).join(" ");
      switch (stockSubcmd) {
        case "account":
        case "portfolio":
        case "summary":
          return "Show my stock broker account summary";
        case "quote":
          return stockArgs ? `Get a stock quote for ${stockArgs.toUpperCase()}` : "Which stock symbol should I quote?";
        case "positions":
          return "Show my current stock positions";
        case "orders":
          return "Show my stock broker orders";
        case "buy":
          return stockArgs ? `Place a stock buy order: ${stockArgs}` : "Provide a buy order like: /stocks buy AAPL 5";
        case "sell":
          return stockArgs ? `Place a stock sell order: ${stockArgs}` : "Provide a sell order like: /stocks sell AAPL 5";
        case "help":
          return "Show help for stocks commands";
        default:
          return "Show stock broker command help";
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
    case "cancel":
      return args ? `Cancel open orders matching: ${args}` : "Which orders should I cancel?";
    case "close":
      return args ? `Close position: ${args}` : "Which position should I close?";
    case "stop-loss":
      return args ? `Set stop-loss: ${args}` : "Which position needs a stop-loss?";
    case "take-profit":
      return args ? `Set take-profit: ${args}` : "Which position needs a take-profit?";
    case "watch":
      return args ? `Watch prices for ${args}` : "What symbol should I watch?";
    case "alerts":
      return args ? `Manage alerts: ${args}` : "What alert action? (set, list, delete)";
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
      if (!args) return "Show available workflows. Use: /workflow quick <symbol>, /workflow dd <symbol>, or /workflow backtest-cycle <strategy> <symbol>";
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
        default:
          return "Available workflows: quick, dd, backtest-cycle";
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
      if (!args || args === "status") return "Show my current telemetry status — anonymous telemetry, structured Axiom export, OTEL tracing, and research data collection";
      if (args === "enable") return "Enable telemetry consent. This allows anonymous telemetry and also unlocks structured Axiom export or reviewed OTEL tracing if the operator configured them.";
      if (args === "disable") return "Disable telemetry consent and stop anonymous telemetry, structured Axiom export, and reviewed OTEL tracing";
      if (args === "research-enable" || args === "research enable") return "Enable anonymized trading data collection for AI model training. This collects: trade outcomes (% P&L, strategy, duration, exit reason), backtest results (metrics only), market context (indicators, trend, bias). NO absolute prices, balances, quantities, or wallet addresses are ever collected. Data is stored locally in ~/.gordon/research/ and uploaded only when you choose.";
      if (args === "research-disable" || args === "research disable") return "Disable anonymized trading data collection";
      if (args === "research-status" || args === "research status") return "Show research data collection status: how many records collected locally, file sizes, and whether upload is pending";
      if (args === "research-upload" || args === "research upload") return "Upload collected anonymized research data to help train AI trading models";
      if (args === "research-clear" || args === "research clear") return "Delete all locally collected research data files";
      return "Show my current telemetry status";
    case "context":
      return args
        ? `Show the latest prompt context and token budget report for thread ${args}`
        : "Show the latest prompt grounding, context budget, and model-usage report for this thread";
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
    case "systematic": {
      if (!args) {
        return "Show the overall systematic research state. Include validation health, portfolio diversification, recent experiments, and current promotion posture.";
      }
      const systematicParts = args.split(/\s+/);
      const systematicSubcmd = systematicParts[0]?.toLowerCase();
      const systematicArg = systematicParts.slice(1).join(" ");
      switch (systematicSubcmd) {
        case "status":
          return systematicArg
            ? `Show the full systematic status for ${systematicArg}. Include profile, latest validation, experiments, lifecycle events, and promotion eligibility.`
            : "Which strategy should I inspect? Show the systematic status for a specific strategy.";
        case "portfolio":
          return "Analyze the systematic portfolio across stocks and crypto. Show diversification, correlation heuristics, allocation concentration, and operator recommendations.";
        case "datasets":
          return systematicArg
            ? `List systematic datasets for ${systematicArg}. Include quality score, provenance, candle coverage, and recent snapshots.`
            : "List all available systematic datasets with quality, provenance, and snapshot coverage.";
        case "experiments":
          return systematicArg
            ? `List systematic research experiments for ${systematicArg}. Show hypothesis, status, and latest validation linkage.`
            : "List recent systematic research experiments and their current status.";
        case "lifecycle":
          return systematicArg
            ? `Show systematic lifecycle events for ${systematicArg}. Include promotions, degradations, overrides, and validation recordings.`
            : "Which strategy lifecycle should I inspect?";
        default:
          return `Run a systematic workflow for: ${args}`;
      }
    }
    case "dataset": {
      if (!args) {
        return "Show dataset workflows for systematic research. Support listing datasets, listing snapshots, showing a snapshot, or exporting a notebook-friendly artifact.";
      }
      const datasetParts = args.split(/\s+/);
      const datasetSubcmd = datasetParts[0]?.toLowerCase();
      const datasetArg = datasetParts.slice(1).join(" ");
      switch (datasetSubcmd) {
        case "list":
          return datasetArg
            ? `List systematic datasets matching ${datasetArg}. Include market family, timeframe, quality, provenance, and candle coverage.`
            : "List all systematic datasets and summarize quality and provenance.";
        case "snapshots":
          return datasetArg
            ? `List reproducible dataset snapshots for ${datasetArg}. Include date window, candle count, and creation time.`
            : "List recent reproducible dataset snapshots across all datasets.";
        case "show":
          return datasetArg
            ? `Show dataset snapshot ${datasetArg}. Include the time window, candle count, metadata, and sample candles.`
            : "Which dataset snapshot should I show?";
        case "export":
          return datasetArg
            ? `Export a systematic dataset or research artifact with this request: ${datasetArg}. Prefer notebook-friendly JSON, CSV, or Markdown output.`
            : "What systematic artifact should I export? You can export dataset snapshots, validations, experiments, or backtests.";
        default:
          return `Run a dataset workflow for: ${args}`;
      }
    }
    case "decay":
      return args
        ? `Show the systematic decay report for ${args}. Include validation drift, lifecycle events, degradation risk, and next actions.`
        : "Which strategy should I inspect for decay?";
    case "validate":
      return args
        ? `Inspect validation gates and bias diagnostics for ${args}. Show blockers, warnings, promotion eligibility, and required next steps.`
        : "Which strategy should I validate?";
    case "runtime": {
      if (!args || args === "health") {
        return "Show runtime health for all active strategy slots. Include slot status, allocation, drawdown, warnings, and operator actions.";
      }
      const runtimeParts = args.split(/\s+/);
      const runtimeSubcmd = runtimeParts[0]?.toLowerCase();
      const runtimeArg = runtimeParts.slice(1).join(" ");
      switch (runtimeSubcmd) {
        case "health":
          return "Show runtime health for all active strategy slots. Include slot status, allocation, drawdown, warnings, and operator actions.";
        case "slots":
          return "List running strategy slots with their current allocation, PnL, drawdown, and trade counts.";
        case "diff":
          return runtimeArg
            ? `Compare live runtime performance against the latest systematic backtest for ${runtimeArg}. Include win rate, drawdown, trade count, and decay context.`
            : "Which strategy should I compare live versus backtest for?";
        default:
          return `Run a runtime workflow for: ${args}`;
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
    case "wallet": {
      if (!args || args === "status") {
        return "Show Gordon wallet rails status. Include native providers, MCP fast paths, active wallet provider, and any configuration gaps.";
      }
      const walletSubcmd = args.split(/\s+/)[0]?.toLowerCase();
      const walletArgs = args.split(/\s+/).slice(1).join(" ");
      switch (walletSubcmd) {
        case "solana":
          return walletArgs
            ? `Inspect this Solana wallet using the native Helius provider: ${walletArgs}`
            : "Inspect my configured Solana wallet and show balances, assets, and recent activity.";
        case "fund":
          return walletArgs
            ? `Help me fund a wallet using Gordon's wallet rails: ${walletArgs}`
            : "Show my wallet funding options, including MoonPay buy, sell, swap, quote, and limit flows.";
        case "history":
          return walletArgs
            ? `Show recent wallet activity for ${walletArgs}, including MoonPay transaction history if relevant.`
            : "Show recent wallet activity for my configured wallets, including MoonPay transaction history if available.";
        case "virtual":
          return walletArgs
            ? `Show MoonPay virtual account state and transactions for ${walletArgs}`
            : "Show MoonPay virtual account state, account details, and recent virtual-account transactions.";
        default:
          return `Wallet workflow: ${args}`;
      }
    }
    case "fund": {
      if (!args) {
        return "Show MoonPay funding flows for buy, sell, swap, live quotes, limits, and history. Ask which asset, amount, and wallet should be used.";
      }
      const fundSubcmd = args.split(/\s+/)[0]?.toLowerCase();
      const fundArgs = args.split(/\s+/).slice(1).join(" ");
      switch (fundSubcmd) {
        case "buy":
          return fundArgs ? `Create a MoonPay buy link: ${fundArgs}` : "Create a MoonPay buy link. Which fiat currency, crypto asset, and wallet address?";
        case "sell":
          return fundArgs ? `Create a MoonPay sell link: ${fundArgs}` : "Create a MoonPay sell link. Which crypto asset, payout currency, and refund wallet?";
        case "swap":
          return fundArgs ? `Create a MoonPay swap link: ${fundArgs}` : "Create a MoonPay swap link. Which asset pair and wallet address?";
        case "quote":
          return fundArgs
            ? `Get a live MoonPay quote for this request: ${fundArgs}`
            : "Get a live MoonPay quote. Which mode (buy, sell, or swap), asset, amount, and fiat currency should be used?";
        case "limits":
          return fundArgs
            ? `Get MoonPay currency limits for: ${fundArgs}`
            : "Get MoonPay currency limits. Which crypto asset and optional payment method should be checked?";
        case "history":
          return fundArgs
            ? `Show MoonPay transaction history for: ${fundArgs}`
            : "Show MoonPay transaction history. Which customer, transaction id, or external transaction id should be used?";
        default:
          return `Wallet funding workflow: ${args}`;
      }
    }
    case "pay":
      return args
        ? `Prepare a Polygon x402 payment intent for this request: ${args}. Show the headers and require approval before signing.`
        : "Prepare a Polygon x402 payment intent for a paid API or agent-to-agent request. Ask which resource and amount should be used.";
    // Blockchain Network commands
    case "chains":
      return "Show me which blockchain networks are configured and available. For each configured chain, show the available tools and capabilities. For unconfigured chains, show what keys are needed.";
    case "rails":
      return "Show Gordon's native wallet, chain-data, and payment rails. Include Helius, MoonPay, and Polygon x402 status, active providers, auth modes, MCP fast paths, and any missing credentials.";
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
