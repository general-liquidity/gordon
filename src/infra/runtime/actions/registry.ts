import { z } from "zod";

import type {
  ActionDefinition,
  ActionTaskScope,
  SlashActionSurface,
  ActionToolSurface,
} from "./types.ts";

const scanInputSchema = z.object({
  topN: z.number().int().min(1).max(500).default(50),
  timeframes: z.array(z.string()).min(1).default(["1h", "4h"]),
});

const scanOutputSchema = z.object({
  timestamp: z.string(),
  coinsScanned: z.number(),
  opportunities: z.array(
    z.object({
      symbol: z.string(),
      price: z.number(),
      change24h: z.number(),
      setupConfidence: z.number(),
      bias: z.string(),
      risk: z.string(),
    }),
  ),
});

const analyzeInputSchema = z.object({
  symbol: z.string(),
  timeframes: z.array(z.string()).default(["1h", "4h"]),
});

const analyzeOutputSchema = z.object({
  symbol: z.string(),
  price: z.number(),
  trend: z.string(),
  setupDetected: z.boolean(),
  recommendation: z.string(),
});

const planInputSchema = z.object({
  symbol: z.string(),
});

const planOutputSchema = z.object({
  success: z.boolean(),
  summary: z.string().optional(),
  error: z.string().optional(),
});

const previewOrderInputSchema = z.object({
  symbol: z.string(),
  side: z.enum(["BUY", "SELL"]),
  quantity: z.number().positive().optional(),
  quoteOrderQty: z.number().positive().optional(),
});

const previewOrderOutputSchema = z.object({
  ready: z.boolean(),
  summary: z.string(),
  blockers: z.array(z.string()),
  preview: z.record(z.string(), z.unknown()).optional(),
});

const marketOrderInputSchema = previewOrderInputSchema;

const marketOrderOutputSchema = z.object({
  success: z.boolean().optional(),
  message: z.string().optional(),
  error: z.string().optional(),
});

const portfolioInputSchema = z.object({
  market: z.enum(["crypto", "stocks"]).default("stocks"),
});

const portfolioOutputSchema = z.object({
  summary: z.string().optional(),
});

const setPermissionModeInputSchema = z.object({
  mode: z.enum(["auto", "ask", "strict", "paper", "observe", "plan"]),
});

const setPermissionModeOutputSchema = z.object({
  success: z.boolean(),
  mode: z.enum(["auto", "ask", "strict", "paper", "observe", "plan"]),
});

function createSlash(
  surface: SlashActionSurface,
  tool?: ActionToolSurface,
): Pick<ActionDefinition, "slash" | "tool"> {
  return {
    slash: surface,
    ...(tool ? { tool } : {}),
  };
}

export const CANONICAL_ACTIONS: ActionDefinition[] = [
  {
    id: "market.scan",
    title: "Scan Market",
    description: "Scan the active crypto venue universe for trading opportunities.",
    domain: "market",
    capability: "read",
    taskScope: "scan",
    sideEffectLevel: "none",
    approvalPolicy: "none",
    dryRunSupported: false,
    providerRequirements: [{ kind: "exchange" }],
    rateLimitBudget: "scanning",
    visibility: ["interactive", "json", "agent"],
    inputSchema: scanInputSchema,
    outputSchema: scanOutputSchema,
    ...createSlash(
      {
        name: "scan",
        aliases: ["s"],
        description: "Scan crypto markets for trading setups (~10-30s)",
        usage: "/scan",
        category: "market",
        level: 1,
        workflow: "discover",
        audience: "core",
        action: "agent",
        target: "scanner",
        executionTime: "~10-30s",
        whenToUse: "Discover crypto setups across multiple symbols",
      },
      {
        toolName: "scan_market",
        agentTarget: "Scanner",
        description: "Canonical market scan tool",
      },
    ),
    prompt: () =>
      "Scan crypto markets for trading opportunities across multiple symbols (~10-30s depending on market size)",
    tags: ["market", "scan", "discovery"],
  },
  {
    id: "market.analyze",
    title: "Analyze Market",
    description: "Run a single-symbol analysis on the active crypto venue or stock broker.",
    domain: "market",
    capability: "read",
    taskScope: "analysis",
    sideEffectLevel: "none",
    approvalPolicy: "none",
    dryRunSupported: false,
    providerRequirements: [
      { kind: "exchange", optional: true },
      { kind: "broker", optional: true },
    ],
    rateLimitBudget: "analysis",
    visibility: ["interactive", "json", "agent"],
    inputSchema: analyzeInputSchema,
    outputSchema: analyzeOutputSchema,
    ...createSlash(
      {
        name: "analyze",
        aliases: ["a", "quick"],
        description: "Single-symbol analysis (~3-5s) for crypto or stocks",
        usage: "/analyze <symbol>",
        category: "market",
        level: 1,
        workflow: "analyze",
        audience: "core",
        action: "agent",
        target: "analyst",
        executionTime: "~3-5s",
        whenToUse: "Quick check on a single crypto pair or stock ticker",
      },
      {
        toolName: "analyze_coin",
        agentTarget: "Analyst",
        description: "Canonical single-symbol analysis tool",
      },
    ),
    prompt: ({ args }) =>
      args
        ? `Run a quick single analysis on ${args} - get price action, key levels, and trading signal`
        : "What symbol should I analyze? (Crypto pair or stock ticker)",
    tags: ["market", "analysis"],
  },
  {
    id: "trading.plan",
    title: "Create Trade Plan",
    description: "Create a structured trading plan before execution.",
    domain: "trading",
    capability: "plan",
    taskScope: "planning",
    sideEffectLevel: "preview",
    approvalPolicy: "confirm",
    dryRunSupported: true,
    providerRequirements: [{ kind: "exchange" }],
    rateLimitBudget: "analysis",
    visibility: ["interactive", "json", "agent"],
    inputSchema: planInputSchema,
    outputSchema: planOutputSchema,
    ...createSlash(
      {
        name: "plan",
        aliases: ["p"],
        description: "Create a trade plan for a coin",
        usage: "/plan <symbol>",
        category: "trading",
        level: 1,
        workflow: "trade",
        audience: "core",
        action: "agent",
        target: "planner",
        whenToUse: "Create a structured trade plan before execution",
      },
      {
        toolName: "create_plan",
        agentTarget: "Planner",
        description: "Canonical plan creation tool",
      },
    ),
    prompt: ({ args }) =>
      args ? `Create a trade plan for ${args}` : "What coin should I plan a trade for?",
    tags: ["trading", "planning"],
  },
  {
    id: "trading.preview_market_order",
    title: "Preview Market Order",
    description: "Preview a crypto or stock market order without placing it.",
    domain: "trading",
    capability: "plan",
    taskScope: "execution",
    sideEffectLevel: "preview",
    approvalPolicy: "confirm",
    dryRunSupported: true,
    providerRequirements: [
      { kind: "exchange", optional: true },
      { kind: "broker", optional: true },
    ],
    rateLimitBudget: "execution",
    visibility: ["interactive", "json", "agent"],
    inputSchema: previewOrderInputSchema,
    outputSchema: previewOrderOutputSchema,
    ...createSlash(
      {
        name: "preview-order",
        aliases: ["order-preview"],
        description: "Preview a market order before execution across crypto or stocks",
        usage: "/preview-order <symbol> <buy|sell> <amount> [quote]",
        category: "trading",
        level: 2,
        workflow: "trade",
        audience: "advanced",
        action: "agent",
        target: "planner",
        executionTime: "~1-2s",
        whenToUse:
          "See readiness, estimated fills, policy blockers, and side effects before placing a market order",
      },
      {
        toolName: "preview_market_order",
        agentTarget: "Planner",
        description: "Canonical market-order preview tool",
      },
    ),
    prompt: ({ args }) =>
      args
        ? `Preview a market order before execution: ${args}. Show readiness, estimated fills, fees, and policy blockers.`
        : "What market order should I preview? Example: /preview-order BTC buy 100 quote or /preview-order AAPL buy 5",
    tags: ["trading", "preview", "dry-run"],
  },
  {
    id: "trading.market_order",
    title: "Place Market Order",
    description: "Place a live crypto or stock market order on the active execution venue.",
    domain: "trading",
    capability: "execute",
    taskScope: "execution",
    sideEffectLevel: "funds",
    approvalPolicy: "trade_permission",
    dryRunSupported: true,
    providerRequirements: [
      { kind: "exchange", optional: true },
      { kind: "broker", optional: true },
    ],
    rateLimitBudget: "execution",
    visibility: ["agent"],
    inputSchema: marketOrderInputSchema,
    outputSchema: marketOrderOutputSchema,
    tool: {
      toolName: "place_market_order",
      agentTarget: "Executor",
      description: "Canonical live market-order tool",
    },
    prompt: ({ args }) =>
      args ? `Place a live market order: ${args}` : "What market order should I place?",
    tags: ["trading", "execution", "armed"],
  },
  {
    id: "account.portfolio",
    title: "Show Portfolio",
    description: "Show portfolio or broker account balances.",
    domain: "account",
    capability: "read",
    taskScope: "ops",
    sideEffectLevel: "none",
    approvalPolicy: "none",
    dryRunSupported: false,
    providerRequirements: [
      { kind: "exchange", optional: true },
      { kind: "broker", optional: true },
    ],
    rateLimitBudget: "minimal",
    visibility: ["interactive", "json", "agent"],
    inputSchema: portfolioInputSchema,
    outputSchema: portfolioOutputSchema,
    ...createSlash({
      name: "portfolio",
      aliases: ["pf", "balance"],
      description: "View portfolio and balances",
      usage: "/portfolio",
      category: "account",
      level: 1,
      workflow: "accounts",
      audience: "core",
      action: "menu",
      target: "portfolio",
      whenToUse: "Inspect current balances and holdings",
    }),
    prompt: ({ args }) =>
      args.toLowerCase().includes("stock")
        ? "Show my stock broker account summary"
        : "Show my portfolio",
    tags: ["portfolio", "account"],
  },
  {
    id: "system.set_auto",
    title: "Set permissionMode=auto",
    description: "Auto-execute trades without per-action approval.",
    domain: "system",
    capability: "configure",
    taskScope: "system",
    sideEffectLevel: "state",
    approvalPolicy: "confirm",
    dryRunSupported: false,
    providerRequirements: [{ kind: "system" }],
    rateLimitBudget: "ops",
    visibility: ["interactive", "json", "agent"],
    inputSchema: setPermissionModeInputSchema,
    outputSchema: setPermissionModeOutputSchema,
    ...createSlash({
      name: "auto",
      aliases: [],
      description: "Auto-execute trades without per-action approval",
      usage: "/auto",
      category: "trading",
      level: 2,
      workflow: "monitor",
      audience: "advanced",
      action: "tool",
      target: "set_permission_mode",
    }),
    prompt: () => "Set permissionMode to 'auto' — trades execute without per-action approval",
    tags: ["system", "auto"],
  },
  {
    id: "system.set_ask",
    title: "Set permissionMode=ask",
    description: "Each trade requires approval via dialog (default).",
    domain: "system",
    capability: "configure",
    taskScope: "system",
    sideEffectLevel: "state",
    approvalPolicy: "none",
    dryRunSupported: false,
    providerRequirements: [{ kind: "system" }],
    rateLimitBudget: "ops",
    visibility: ["interactive", "json", "agent"],
    inputSchema: setPermissionModeInputSchema,
    outputSchema: setPermissionModeOutputSchema,
    ...createSlash({
      name: "ask",
      aliases: [],
      description: "Each trade requires approval via dialog (default)",
      usage: "/ask",
      category: "trading",
      level: 2,
      workflow: "monitor",
      audience: "advanced",
      action: "tool",
      target: "set_permission_mode",
    }),
    prompt: () => "Set permissionMode to 'ask' — each trade requires approval via ApprovalDialog",
    tags: ["system", "ask"],
  },
  {
    id: "system.set_strict",
    title: "Set permissionMode=strict",
    description: "Read-only — all trades blocked.",
    domain: "system",
    capability: "configure",
    taskScope: "system",
    sideEffectLevel: "state",
    approvalPolicy: "none",
    dryRunSupported: false,
    providerRequirements: [{ kind: "system" }],
    rateLimitBudget: "ops",
    visibility: ["interactive", "json", "agent"],
    inputSchema: setPermissionModeInputSchema,
    outputSchema: setPermissionModeOutputSchema,
    ...createSlash({
      name: "strict",
      aliases: ["readonly"],
      description: "Read-only — all trades blocked",
      usage: "/strict",
      category: "trading",
      level: 2,
      workflow: "monitor",
      audience: "advanced",
      action: "tool",
      target: "set_permission_mode",
    }),
    prompt: () => "Set permissionMode to 'strict' — read-only, all trades blocked",
    tags: ["system", "strict"],
  },
];

const ACTIONS_BY_ID = new Map(CANONICAL_ACTIONS.map((action) => [action.id, action]));
const ACTIONS_BY_SLASH_NAME = new Map<string, ActionDefinition>();
const ACTIONS_BY_TOOL_NAME = new Map<string, ActionDefinition>();

for (const action of CANONICAL_ACTIONS) {
  if (action.slash) {
    ACTIONS_BY_SLASH_NAME.set(action.slash.name, action);
    for (const alias of action.slash.aliases) {
      ACTIONS_BY_SLASH_NAME.set(alias, action);
    }
  }
  if (action.tool) {
    ACTIONS_BY_TOOL_NAME.set(action.tool.toolName, action);
  }
}

export function getCanonicalActions(): ActionDefinition[] {
  return [...CANONICAL_ACTIONS];
}

export function getActionById(actionId: string): ActionDefinition | undefined {
  return ACTIONS_BY_ID.get(actionId);
}

export function getActionBySlashName(commandName: string): ActionDefinition | undefined {
  return ACTIONS_BY_SLASH_NAME.get(commandName.toLowerCase());
}

export function getActionByToolName(toolName: string): ActionDefinition | undefined {
  return ACTIONS_BY_TOOL_NAME.get(toolName);
}

export function getActionsForTaskScope(taskScope: ActionTaskScope): ActionDefinition[] {
  return CANONICAL_ACTIONS.filter((action) => action.taskScope === taskScope);
}
