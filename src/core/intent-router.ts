import { LLMClient, loadPrompt, buildMessages } from "../infra/llm/index.ts";
import { IntentSchema, type Intent } from "../types/index.ts";

/**
 * Context provided to the intent parser for better understanding
 */
export interface IntentContext {
  hasOpenTrades?: boolean;
  lastPlan?: string;
  mode?: "SAFE" | "ARMED";
}

/**
 * Common crypto symbol mappings
 */
const SYMBOL_ALIASES: Record<string, string> = {
  bitcoin: "BTCUSDT",
  btc: "BTCUSDT",
  ethereum: "ETHUSDT",
  eth: "ETHUSDT",
  solana: "SOLUSDT",
  sol: "SOLUSDT",
  polkadot: "DOTUSDT",
  dot: "DOTUSDT",
  chainlink: "LINKUSDT",
  link: "LINKUSDT",
  cardano: "ADAUSDT",
  ada: "ADAUSDT",
  avalanche: "AVAXUSDT",
  avax: "AVAXUSDT",
  polygon: "MATICUSDT",
  matic: "MATICUSDT",
  ripple: "XRPUSDT",
  xrp: "XRPUSDT",
  dogecoin: "DOGEUSDT",
  doge: "DOGEUSDT",
  litecoin: "LTCUSDT",
  ltc: "LTCUSDT",
  cosmos: "ATOMUSDT",
  atom: "ATOMUSDT",
  near: "NEARUSDT",
  arbitrum: "ARBUSDT",
  arb: "ARBUSDT",
  optimism: "OPUSDT",
  op: "OPUSDT",
};

/**
 * Normalize a coin name or symbol to a trading pair
 */
function normalizeSymbol(input: string): string {
  const lower = input.toLowerCase().trim();

  // Check aliases first
  if (SYMBOL_ALIASES[lower]) {
    return SYMBOL_ALIASES[lower];
  }

  // If already ends with USDT, uppercase it
  if (lower.endsWith("usdt")) {
    return input.toUpperCase();
  }

  // Otherwise append USDT
  return input.toUpperCase() + "USDT";
}

/**
 * Check if a message looks like a greeting
 */
function isGreeting(message: string): boolean {
  const greetings = [
    /^h(i|ey|ello|owdy)$/i,
    /^good\s*(morning|afternoon|evening)$/i,
    /^yo$/i,
    /^sup$/i,
    /^what'?s?\s*up$/i,
    /^greetings$/i,
  ];

  const trimmed = message.trim();
  return greetings.some((pattern) => pattern.test(trimmed));
}

/**
 * Check if a message is an execution confirmation
 */
function isExecutionConfirmation(message: string): boolean {
  const confirmations = [
    /^(do\s*it|execute|yes|let'?s?\s*go|proceed|approved|confirm|go\s*ahead|ok|okay|sure|yep|yeah|yup)$/i,
    /^execute\s*(the\s*)?(plan|trade|it)?$/i,
    /^place\s*(the\s*)?orders?$/i,
    /^let'?s?\s*(do\s*it|go|proceed)$/i,
  ];

  const trimmed = message.trim();
  return confirmations.some((pattern) => pattern.test(trimmed));
}

/**
 * Parse common shortcuts that don't need AI
 * Returns null if no shortcut matches
 */
export function parseShortcut(message: string): Intent | null {
  const trimmed = message.trim().toLowerCase();

  // Slash commands
  if (trimmed === "/help") {
    return {
      type: "LEARN",
      params: { about: "help" },
    };
  }

  if (trimmed === "/scan") {
    return {
      type: "EXPLORE",
      params: { scope: "top50" },
    };
  }

  if (trimmed === "/portfolio") {
    return {
      type: "MONITOR",
      params: { scope: "all" },
    };
  }

  if (trimmed === "/arm") {
    return {
      type: "SETTINGS",
      params: { action: "arm" },
    };
  }

  if (trimmed === "/disarm") {
    return {
      type: "SETTINGS",
      params: { action: "disarm" },
    };
  }

  // Price command: "price BTC" or "price btc"
  const priceMatch = trimmed.match(/^price\s+([a-z]{2,10})$/i);
  if (priceMatch && priceMatch[1]) {
    return {
      type: "ANALYZE",
      params: { symbol: normalizeSymbol(priceMatch[1]) },
    };
  }

  return null;
}

/**
 * Parse user message into structured intent using AI
 */
export async function parseIntent(
  client: LLMClient,
  userMessage: string,
  context?: IntentContext
): Promise<Intent> {
  // Load the intent-router prompt
  const systemPrompt = await loadPrompt("intent-router");

  // Build context string for injection
  let contextInfo = "";
  if (context) {
    const contextParts: string[] = [];
    if (context.hasOpenTrades !== undefined) {
      contextParts.push(
        `User has open trades: ${context.hasOpenTrades ? "yes" : "no"}`
      );
    }
    if (context.lastPlan) {
      contextParts.push(`There is a pending plan: ${context.lastPlan}`);
    }
    if (context.mode) {
      contextParts.push(`Current mode: ${context.mode}`);
    }
    if (contextParts.length > 0) {
      contextInfo = `\n\n## Current Context\n${contextParts.join("\n")}`;
    }
  }

  // Build the messages for the LLM
  const messages = buildMessages(systemPrompt + contextInfo, userMessage);

  try {
    // Call LLM with JSON mode
    const response = await client.chat(messages);

    // Parse the JSON response
    const parsed = JSON.parse(response.content);

    // Map the LLM response to our Intent schema
    const intentData = mapLLMResponseToIntent(parsed, userMessage, context);

    // Validate with Zod
    const result = IntentSchema.safeParse(intentData);

    if (result.success) {
      return result.data;
    }

    // If Zod parsing fails, return UNCLEAR
    console.error("Intent parsing failed:", result.error);
    return {
      type: "UNCLEAR",
      params: { originalMessage: userMessage },
    };
  } catch (error) {
    // If anything fails, return UNCLEAR
    console.error("Intent parsing error:", error);
    return {
      type: "UNCLEAR",
      params: { originalMessage: userMessage },
    };
  }
}

/**
 * Map LLM response to our Intent schema format
 */
function mapLLMResponseToIntent(
  llmResponse: {
    type: string;
    params?: Record<string, unknown>;
    confidence?: number;
  },
  originalMessage: string,
  context?: IntentContext
): Intent {
  const type = llmResponse.type?.toUpperCase();
  const params = llmResponse.params || {};

  switch (type) {
    case "EXPLORE":
      return {
        type: "EXPLORE",
        params: {
          scope: (params.scope as "top50" | "watchlist" | "specific") || undefined,
          symbol: params.symbol as string | undefined,
        },
      };

    case "ANALYZE":
      return {
        type: "ANALYZE",
        params: {
          symbol: normalizeSymbol((params.symbol as string) || "BTCUSDT"),
        },
      };

    case "PLAN":
      return {
        type: "PLAN",
        params: {
          symbol: params.symbol
            ? normalizeSymbol(params.symbol as string)
            : undefined,
          amount: params.amount as number | undefined,
          riskLevel: params.riskLevel as "low" | "medium" | "high" | undefined,
        },
      };

    case "EXECUTE":
      return {
        type: "EXECUTE",
        params: {
          planId: (params.planId as string) || context?.lastPlan || "latest",
        },
      };

    case "MONITOR":
      return {
        type: "MONITOR",
        params: {
          scope: (params.scope as "all" | "specific") || "all",
          tradeId: params.tradeId as string | undefined,
        },
      };

    case "PROTECT":
      return {
        type: "PROTECT",
        params: {
          action:
            (params.action as "close_all" | "close_one" | "reduce") ||
            "close_all",
          tradeId: params.tradeId as string | undefined,
        },
      };

    case "LEARN":
      return {
        type: "LEARN",
        params: {
          about: (params.about as string) || (params.topic as string) || "general",
        },
      };

    case "SETTINGS":
      return {
        type: "SETTINGS",
        params: {
          action: mapSettingsAction(params),
        },
      };

    case "UNCLEAR":
    default:
      return {
        type: "UNCLEAR",
        params: { originalMessage },
      };
  }
}

/**
 * Map settings parameters to action string
 */
function mapSettingsAction(params: Record<string, unknown>): string {
  // Direct action
  if (params.action) {
    return params.action as string;
  }

  // Setting + value combination
  if (params.setting && params.value !== undefined) {
    const setting = params.setting as string;
    const value = params.value;

    if (setting === "mode") {
      return value === "ARMED" ? "arm" : "disarm";
    }

    return `set_${setting}_${value}`;
  }

  return "show";
}

/**
 * Handle edge cases that have clear mappings
 */
function handleEdgeCases(
  message: string,
  context?: IntentContext
): Intent | null {
  const trimmed = message.trim().toLowerCase();

  // "do it" / "execute" / "yes" when there's a lastPlan -> EXECUTE
  if (context?.lastPlan && isExecutionConfirmation(message)) {
    return {
      type: "EXECUTE",
      params: { planId: context.lastPlan },
    };
  }

  // "arm" / "arm trading" -> SETTINGS with action: "arm"
  if (/^arm(\s+trading)?$/i.test(trimmed)) {
    return {
      type: "SETTINGS",
      params: { action: "arm" },
    };
  }

  // "disarm" -> SETTINGS with action: "disarm"
  if (/^disarm$/i.test(trimmed)) {
    return {
      type: "SETTINGS",
      params: { action: "disarm" },
    };
  }

  // Greetings -> EXPLORE with default scope
  if (isGreeting(message)) {
    return {
      type: "EXPLORE",
      params: { scope: "top50" },
    };
  }

  return null;
}

/**
 * Main intent routing function
 * 1. Try parseShortcut first (no AI needed)
 * 2. Try edge case handlers (no AI needed)
 * 3. If no match, call parseIntent (AI)
 */
export async function routeIntent(
  client: LLMClient,
  userMessage: string,
  context?: IntentContext
): Promise<Intent> {
  // 1. Try shortcuts first (fastest, no AI)
  const shortcut = parseShortcut(userMessage);
  if (shortcut) {
    return shortcut;
  }

  // 2. Try edge case handlers (fast pattern matching)
  const edgeCase = handleEdgeCases(userMessage, context);
  if (edgeCase) {
    return edgeCase;
  }

  // 3. Fall back to AI parsing
  return parseIntent(client, userMessage, context);
}
