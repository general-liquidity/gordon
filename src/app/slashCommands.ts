/**
 * Slash Commands System
 * Defines all available slash commands for quick actions
 */

export interface SlashCommand {
  name: string;
  aliases: string[];
  description: string;
  usage: string;
  category: "trading" | "market" | "account" | "system";
  // Maps to agent or direct action
  action: "agent" | "tool" | "menu";
  target?: string; // Agent name or tool name
}

export const SLASH_COMMANDS: SlashCommand[] = [
  // Market Discovery
  {
    name: "scan",
    aliases: ["s"],
    description: "Scan market for trading opportunities",
    usage: "/scan",
    category: "market",
    action: "agent",
    target: "scanner",
  },
  {
    name: "trending",
    aliases: ["t", "hot"],
    description: "Show trending tokens (biggest movers)",
    usage: "/trending [gainers|losers]",
    category: "market",
    action: "tool",
    target: "get_trending_tokens",
  },
  {
    name: "volume",
    aliases: ["v", "liquid"],
    description: "Show highest volume markets",
    usage: "/volume",
    category: "market",
    action: "tool",
    target: "get_high_volume_tokens",
  },
  {
    name: "analyze",
    aliases: ["a"],
    description: "Deep analysis on a specific coin",
    usage: "/analyze <symbol>",
    category: "market",
    action: "agent",
    target: "analyst",
  },
  {
    name: "whales",
    aliases: ["w", "flow"],
    description: "Detect whale orders and market flow bias",
    usage: "/whales <symbol>",
    category: "market",
    action: "tool",
    target: "analyze_whale_orders",
  },
  {
    name: "breakouts",
    aliases: ["bo"],
    description: "Scan for breakout/breakdown setups",
    usage: "/breakouts [symbol]",
    category: "market",
    action: "tool",
    target: "scan_breakouts",
  },
  {
    name: "score",
    aliases: ["sc"],
    description: "Get market score and trading signal",
    usage: "/score <symbol>",
    category: "market",
    action: "tool",
    target: "score_market",
  },

  // Trading
  {
    name: "plan",
    aliases: ["p"],
    description: "Create a trade plan for a coin",
    usage: "/plan <symbol>",
    category: "trading",
    action: "agent",
    target: "planner",
  },
  {
    name: "grid",
    aliases: ["g"],
    description: "Create a grid entry plan with multiple buy levels",
    usage: "/grid <symbol> [allocation]",
    category: "trading",
    action: "tool",
    target: "create_grid_plan",
  },
  {
    name: "positions",
    aliases: ["pos"],
    description: "Check active positions",
    usage: "/positions",
    category: "trading",
    action: "tool",
    target: "check_positions",
  },
  {
    name: "orders",
    aliases: ["o"],
    description: "View open orders",
    usage: "/orders",
    category: "trading",
    action: "tool",
    target: "get_order_status",
  },
  {
    name: "arm",
    aliases: [],
    description: "Enable live trading (ARMED mode)",
    usage: "/arm",
    category: "trading",
    action: "tool",
    target: "arm_system",
  },
  {
    name: "disarm",
    aliases: ["safe"],
    description: "Return to SAFE mode",
    usage: "/disarm",
    category: "trading",
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
    action: "menu",
    target: "portfolio",
  },
  {
    name: "earn",
    aliases: ["e", "savings"],
    description: "View earn/staking positions",
    usage: "/earn",
    category: "account",
    action: "tool",
    target: "get_all_earn_positions",
  },
  {
    name: "history",
    aliases: ["h", "trades"],
    description: "View recent trade history",
    usage: "/history [symbol]",
    category: "account",
    action: "tool",
    target: "get_trade_history",
  },

  // System
  {
    name: "help",
    aliases: ["?"],
    description: "Get help and learn concepts",
    usage: "/help [topic]",
    category: "system",
    action: "agent",
    target: "teacher",
  },
  {
    name: "status",
    aliases: ["st"],
    description: "Check system and connection status",
    usage: "/status",
    category: "system",
    action: "tool",
    target: "test_connection",
  },
  {
    name: "setup",
    aliases: ["config"],
    description: "Configure API keys and settings",
    usage: "/setup",
    category: "system",
    action: "menu",
    target: "setup",
  },
  {
    name: "model",
    aliases: ["m", "provider"],
    description: "Select AI model and provider",
    usage: "/model",
    category: "system",
    action: "menu",
    target: "model",
  },
];

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
 * @returns Array of matching commands
 */
export function getSlashCommandSuggestions(partial: string): SlashCommand[] {
  if (!partial.startsWith("/")) {
    return [];
  }

  const search = partial.slice(1).toLowerCase();

  if (search === "") {
    // Show all commands when just "/" is typed
    return SLASH_COMMANDS;
  }

  // Filter by name or alias prefix
  return SLASH_COMMANDS.filter(
    (cmd) =>
      cmd.name.startsWith(search) ||
      cmd.aliases.some((alias) => alias.startsWith(search))
  );
}

/**
 * Format command list for display
 */
export function formatCommandHelp(): string {
  const lines: string[] = ["**Available Commands:**\n"];

  const categories = {
    market: "Market Discovery",
    trading: "Trading",
    account: "Account",
    system: "System",
  };

  for (const [category, label] of Object.entries(categories)) {
    const cmds = SLASH_COMMANDS.filter((c) => c.category === category);
    if (cmds.length === 0) continue;

    lines.push(`\n**${label}**`);
    for (const cmd of cmds) {
      const aliases = cmd.aliases.length > 0 ? ` (${cmd.aliases.join(", ")})` : "";
      lines.push(`  /${cmd.name}${aliases} - ${cmd.description}`);
    }
  }

  lines.push("\n_Type a command or just chat naturally with Gordon._");
  return lines.join("\n");
}

/**
 * Convert slash command to natural language for the agent
 */
export function commandToPrompt(command: SlashCommand, args: string): string {
  switch (command.name) {
    case "scan":
      return "Scan the market for trading opportunities";
    case "trending":
      return args === "losers"
        ? "Show me the biggest losers today"
        : "Show me what's trending and pumping today";
    case "volume":
      return "Show me the highest volume tokens";
    case "analyze":
      return args ? `Analyze ${args} for me` : "What coin should I analyze?";
    case "whales":
      return args ? `Check whale orders and flow bias for ${args}` : "What symbol should I check for whale activity?";
    case "breakouts":
      return args ? `Scan ${args} for breakout or breakdown setups` : "Scan the market for breakout and breakdown setups";
    case "score":
      return args ? `Score ${args} and give me a trading signal` : "What symbol should I score?";
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
    case "earn":
      return "Show my earn positions";
    case "history":
      return args ? `Show my trade history for ${args}` : "Show my recent trade history";
    case "help":
      return args ? `Explain ${args} to me` : "Help me understand how to use Gordon";
    case "status":
      return "Check system status and connection";
    case "setup":
      return "I want to configure my settings";
    case "model":
      return "Show me the current AI model and available providers";
    default:
      return args || command.description;
  }
}
