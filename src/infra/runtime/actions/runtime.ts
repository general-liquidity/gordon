import type { MCPCategory } from "../../ai/mcp/types.ts";
import { pluginInstaller } from "../../ai/mcp/marketplace/installer.ts";
import type { GordonContext } from "../../agents/types.ts";
import { resolveInstrument } from "../../domain/markets/instruments.ts";
import { checkExplicitExecutionAccess, requiresArmedModeForTool } from "../../agents/middleware/access-control.ts";
import { getCredentialSummaryForKinds } from "./credentials.ts";
import { getActionById, getActionByToolName } from "./registry.ts";
import type {
  ActionDefinition,
  ActionExecutionPlan,
  ActionExecutionStep,
  ActionSideEffectLevel,
  ActionTaskScope,
} from "./types.ts";

export interface ToolRequestPolicyDecision {
  allowed: boolean;
  reason?: string;
  requiresArmedMode: boolean;
  actionId?: string;
  providerCategory?: string;
}

const REQUEST_ACTION_SUPPORT: Record<string, string[]> = {
  "market.scan": ["market.scan"],
  "market.analyze": ["market.analyze", "market.scan"],
  "trading.plan": ["trading.plan", "market.analyze", "market.scan", "account.portfolio"],
  "trading.preview_market_order": [
    "trading.preview_market_order",
    "market.analyze",
    "market.scan",
    "account.portfolio",
  ],
  "trading.market_order": [
    "trading.market_order",
    "trading.preview_market_order",
    "trading.plan",
    "market.analyze",
    "market.scan",
    "account.portfolio",
  ],
  "account.portfolio": ["account.portfolio"],
  "wallet.fund": ["wallet.fund", "account.portfolio"],
  "payments.intent": ["payments.intent"],
  "system.arm": ["system.arm"],
  "system.disarm": ["system.disarm"],
};

const REQUEST_SCOPE_MATRIX: Record<ActionTaskScope, ActionTaskScope[]> = {
  scan: ["scan"],
  analysis: ["analysis", "scan"],
  planning: ["planning", "analysis", "scan", "ops"],
  execution: ["execution", "planning", "analysis", "scan", "ops", "system"],
  funding: ["funding", "ops", "analysis", "system"],
  ops: ["ops", "analysis", "scan", "system"],
  setup: ["setup", "ops", "system"],
  system: ["system", "ops"],
};

const MCP_SCOPE_MATRIX: Record<MCPCategory, ActionTaskScope[]> = {
  "data-provider": ["scan", "analysis", "planning", "ops", "setup"],
  analytics: ["scan", "analysis", "planning", "ops"],
  execution: ["execution", "funding", "setup"],
  exchange: ["execution", "funding", "setup"],
  infrastructure: ["analysis", "ops", "setup", "system"],
  portfolio: ["analysis", "planning", "ops", "funding"],
  research: ["scan", "analysis", "planning", "ops"],
  utility: ["planning", "ops", "funding", "setup", "system"],
};

function isCompatibleTaskScope(requestedScope: ActionTaskScope, toolScope: ActionTaskScope): boolean {
  return REQUEST_SCOPE_MATRIX[requestedScope]?.includes(toolScope) ?? false;
}

function isRiskySideEffect(sideEffectLevel: ActionSideEffectLevel): boolean {
  return sideEffectLevel === "state" || sideEffectLevel === "funds";
}

function formatMissingProviders(missing: string[]): string {
  return missing.join(", ");
}

function buildCredentialStep(planTitle: string, ready: boolean, missing: string[]): ActionExecutionStep {
  if (ready) {
    return {
      id: "credentials",
      title: "Credential profile",
      status: "ready",
      detail: `${planTitle} has the required authenticated providers configured.`,
    };
  }

  return {
    id: "credentials",
    title: "Credential profile",
    status: "blocked",
    detail: `Missing required provider credentials: ${formatMissingProviders(missing)}`,
  };
}

async function buildMarketOrderPlan(
  action: ActionDefinition,
  input: {
    symbol: string;
    side: "BUY" | "SELL";
    quantity?: number;
    quoteOrderQty?: number;
  },
  context: GordonContext,
): Promise<ActionExecutionPlan> {
  const instrument = await resolveInstrument(context, input.symbol);
  const normalizedSymbol = instrument.normalizedSymbol;
  const providerKinds = action.providerRequirements.filter((entry) => !entry.optional).map((entry) => entry.kind);
  const credentialSummary = providerKinds.length > 0
    ? await getCredentialSummaryForKinds(context.config, providerKinds)
    : { ready: true, providers: [], missing: [], statuses: [] };

  const steps: ActionExecutionStep[] = [];
  const blockers: string[] = [];
  const preview: Record<string, unknown> = {
    symbol: normalizedSymbol,
    side: input.side,
    marketFamily: instrument.marketFamily,
    venueRoute: instrument.route,
    resolutionSource: instrument.resolutionSource,
    quoteAsset: instrument.quoteAsset,
    capabilities: instrument.capabilities,
  };

  if (instrument.route === "exchange" && !context.exchange) {
    blockers.push("No active crypto execution venue is available.");
    steps.push({
      id: "venue",
      title: "Execution venue",
      status: "blocked",
      detail: "Connect and select an active crypto venue before planning or executing this order.",
    });
  } else if (instrument.route === "broker" && !context.broker) {
    blockers.push("No active stock broker is available.");
    steps.push({
      id: "venue",
      title: "Execution venue",
      status: "blocked",
      detail: "Connect and select an active stock broker before planning or executing this order.",
    });
  } else if (instrument.route === "exchange" && context.exchange) {
    steps.push({
      id: "venue",
      title: "Execution venue",
      status: "ready",
      detail: `Active crypto venue: ${context.exchange.displayName}.`,
    });
    preview.venue = context.exchange.exchangeId;
  } else if (instrument.route === "broker" && context.broker) {
    steps.push({
      id: "venue",
      title: "Execution venue",
      status: "ready",
      detail: `Active stock broker: ${context.broker.displayName}.`,
    });
    preview.venue = context.broker.brokerId;
  }

  steps.push(buildCredentialStep(action.title, credentialSummary.ready, credentialSummary.missing));
  if (!credentialSummary.ready) {
    blockers.push(`Missing credentials: ${formatMissingProviders(credentialSummary.missing)}`);
  }

  if (!input.quantity && !input.quoteOrderQty) {
    blockers.push("Provide either quantity or quoteOrderQty.");
    steps.push({
      id: "size",
      title: "Order sizing",
      status: "blocked",
      detail: "Either quantity or quoteOrderQty is required.",
    });
  } else if (input.quantity && input.quoteOrderQty) {
    blockers.push("Provide either quantity or quoteOrderQty, not both.");
    steps.push({
      id: "size",
      title: "Order sizing",
      status: "blocked",
      detail: "Quantity and quoteOrderQty are mutually exclusive for market orders.",
    });
  } else {
    steps.push({
      id: "size",
      title: "Order sizing",
      status: "ready",
      detail: input.quantity
        ? `Base quantity set to ${input.quantity}.`
        : `Quote spend set to ${input.quoteOrderQty}.`,
    });
  }

  const liveExecutionReady = action.id === "trading.market_order";
  if (context.config.mode !== "ARMED") {
    const detail = action.id === "trading.preview_market_order"
      ? "Preview is available, but live execution is blocked until Gordon is ARMED."
      : "Live execution requires ARMED mode.";
    steps.push({
      id: "mode",
      title: "Execution mode",
      status: liveExecutionReady ? "blocked" : "informational",
      detail,
    });
    blockers.push("System is in SAFE mode.");
  } else {
    steps.push({
      id: "mode",
      title: "Execution mode",
      status: "ready",
      detail: "System is ARMED for live execution.",
    });
  }

  if (instrument.route === "exchange" && context.exchange) {
    try {
      const price = await context.exchange.getPrice(normalizedSymbol);
      preview.estimatedPrice = price;

      if (input.quantity) {
        preview.estimatedNotional = Number((input.quantity * price).toFixed(8));
      }
      if (input.quoteOrderQty) {
        preview.estimatedBaseQty = Number((input.quoteOrderQty / price).toFixed(8));
      }

      if (input.side === "BUY" && typeof preview.estimatedNotional === "number" && preview.estimatedNotional > context.availableCash && context.availableCash > 0) {
        blockers.push(`Estimated notional ${preview.estimatedNotional} exceeds available cash ${context.availableCash}.`);
      }

      steps.push({
        id: "price",
        title: "Price estimate",
        status: "ready",
        detail: `Estimated market price for ${normalizedSymbol}: ${price}.`,
      });
    } catch (error) {
      blockers.push(`Unable to fetch live price for ${normalizedSymbol}.`);
      steps.push({
        id: "price",
        title: "Price estimate",
        status: "blocked",
        detail: `Failed to fetch price: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  } else if (instrument.route === "broker" && context.broker) {
    try {
      const [quote, account] = await Promise.all([
        context.broker.getLatestQuote(normalizedSymbol),
        context.broker.getAccount(),
      ]);
      const price = quote.askPrice || quote.bidPrice;
      preview.estimatedPrice = price;
      preview.bidPrice = quote.bidPrice;
      preview.askPrice = quote.askPrice;
      preview.availableBuyingPower = account.buyingPower;

      if (input.quantity) {
        preview.estimatedNotional = Number((input.quantity * price).toFixed(2));
      }
      if (input.quoteOrderQty) {
        preview.estimatedBaseQty = Number((input.quoteOrderQty / price).toFixed(6));
        preview.estimatedNotional = Number(input.quoteOrderQty.toFixed(2));
      }

      if (input.side === "BUY" && typeof preview.estimatedNotional === "number" && preview.estimatedNotional > account.buyingPower) {
        blockers.push(`Estimated notional ${preview.estimatedNotional} exceeds available buying power ${account.buyingPower}.`);
      }

      steps.push({
        id: "price",
        title: "Price estimate",
        status: "ready",
        detail: `Estimated market price for ${normalizedSymbol}: ${price}.`,
      });
    } catch (error) {
      blockers.push(`Unable to fetch live quote for ${normalizedSymbol}.`);
      steps.push({
        id: "price",
        title: "Price estimate",
        status: "blocked",
        detail: `Failed to fetch quote: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }

  const ready = blockers.length === 0;
  const summary = ready
    ? `${action.title} is ready.`
    : `${action.title} has ${blockers.length} blocker${blockers.length === 1 ? "" : "s"}.`;

  return {
    actionId: action.id,
    title: action.title,
    taskScope: action.taskScope,
    dryRun: action.id === "trading.preview_market_order",
    ready,
    summary,
    blockers,
    steps,
    approvalPolicy: action.approvalPolicy,
    sideEffectLevel: action.sideEffectLevel,
    preview,
    credentialSummary: {
      ready: credentialSummary.ready,
      providers: credentialSummary.providers,
      missing: credentialSummary.missing,
    },
  };
}

function buildGenericPlan(action: ActionDefinition): ActionExecutionPlan {
  return {
    actionId: action.id,
    title: action.title,
    taskScope: action.taskScope,
    dryRun: action.dryRunSupported,
    ready: true,
    summary: `${action.title} is available.`,
    blockers: [],
    steps: [{
      id: "action",
      title: "Action availability",
      status: "ready",
      detail: action.description,
    }],
    approvalPolicy: action.approvalPolicy,
    sideEffectLevel: action.sideEffectLevel,
  };
}

async function getMcpToolCategory(toolName: string): Promise<MCPCategory | null> {
  const separatorIndex = toolName.indexOf("_");
  if (separatorIndex <= 0) {
    return null;
  }

  const serverId = toolName.slice(0, separatorIndex);

  try {
    await pluginInstaller.initialize();
    const plugin = pluginInstaller.getInstalled().find((entry) => entry.id === serverId);
    return plugin?.manifest.category ?? null;
  } catch {
    return null;
  }
}

export async function evaluateToolRequestPolicy(
  toolName: string,
  context: GordonContext,
): Promise<ToolRequestPolicyDecision> {
  const requestedAction = context.requestedActionId ? getActionById(context.requestedActionId) : undefined;
  const requestedScope = context.requestedTaskScope ?? requestedAction?.taskScope;

  const toolAction = getActionByToolName(toolName);
  if (toolAction) {
    const supportedActions = requestedAction ? REQUEST_ACTION_SUPPORT[requestedAction.id] ?? [] : [];

    if (requestedAction) {
      if (requestedAction.id === toolAction.id || supportedActions.includes(toolAction.id)) {
        return {
          allowed: true,
          requiresArmedMode: toolAction.approvalPolicy === "armed_mode",
          actionId: toolAction.id,
        };
      }

      if (isRiskySideEffect(toolAction.sideEffectLevel) && !isRiskySideEffect(requestedAction.sideEffectLevel)) {
        return {
          allowed: false,
          requiresArmedMode: toolAction.approvalPolicy === "armed_mode",
          actionId: toolAction.id,
          reason: `Requested action '${requestedAction.title}' only allows preview/read behavior, but ${toolName} mutates state or funds.`,
        };
      }
    }

    if (requestedScope && !isCompatibleTaskScope(requestedScope, toolAction.taskScope)) {
      return {
        allowed: false,
        requiresArmedMode: toolAction.approvalPolicy === "armed_mode",
        actionId: toolAction.id,
        reason: `Tool ${toolName} is scoped to '${toolAction.taskScope}', which is outside the current '${requestedScope}' request.`,
      };
    }

    return {
      allowed: true,
      requiresArmedMode: toolAction.approvalPolicy === "armed_mode",
      actionId: toolAction.id,
    };
  }

  const requiresArmedMode = requiresArmedModeForTool(toolName);
  if (requestedAction && requiresArmedMode && !isRiskySideEffect(requestedAction.sideEffectLevel)) {
    return {
      allowed: false,
      requiresArmedMode: true,
      reason: `Tool ${toolName} is execution-grade and is blocked during '${requestedAction.title}'.`,
    };
  }

  const mcpCategory = await getMcpToolCategory(toolName);
  if (!mcpCategory) {
    return { allowed: true, requiresArmedMode };
  }

  const categoryScopes = MCP_SCOPE_MATRIX[mcpCategory] ?? [];
  const executionLike = mcpCategory === "execution" || mcpCategory === "exchange";

  if (requestedScope && !categoryScopes.includes(requestedScope)) {
    return {
      allowed: false,
      requiresArmedMode: executionLike,
      providerCategory: mcpCategory,
      reason: `MCP tool ${toolName} (${mcpCategory}) is outside the current '${requestedScope}' request scope.`,
    };
  }

  if (requestedAction && executionLike && !isRiskySideEffect(requestedAction.sideEffectLevel)) {
    return {
      allowed: false,
      requiresArmedMode: true,
      providerCategory: mcpCategory,
      reason: `Execution-class MCP tool ${toolName} is blocked during '${requestedAction.title}'.`,
    };
  }

  return {
    allowed: true,
    requiresArmedMode: executionLike || requiresArmedMode,
    providerCategory: mcpCategory,
  };
}

export async function enforceExecutionPolicy(toolName: string, context: GordonContext): Promise<{
  allowed: boolean;
  reason?: string;
}> {
  const userId = context.userId || "unknown";
  const policy = await evaluateToolRequestPolicy(toolName, context);
  if (!policy.allowed) {
    return { allowed: false, reason: policy.reason };
  }

  if (!policy.requiresArmedMode || requiresArmedModeForTool(toolName)) {
    return { allowed: true };
  }

  const access = await checkExplicitExecutionAccess(toolName, context.config, userId);
  if (!access.allowed) {
    return { allowed: false, reason: access.reason };
  }

  return { allowed: true };
}

export async function planActionExecution(
  actionId: string,
  rawInput: unknown,
  context: GordonContext,
): Promise<ActionExecutionPlan> {
  const action = getActionById(actionId);
  if (!action) {
    throw new Error(`Unknown action: ${actionId}`);
  }

  const input = action.inputSchema.parse(rawInput);

  switch (action.id) {
    case "trading.preview_market_order":
    case "trading.market_order":
      return buildMarketOrderPlan(
        action,
        input as {
          symbol: string;
          side: "BUY" | "SELL";
          quantity?: number;
          quoteOrderQty?: number;
        },
        context,
      );
    default:
      return buildGenericPlan(action);
  }
}

export function formatActionPlanMarkdown(plan: ActionExecutionPlan): string {
  const lines: string[] = [
    `**${plan.title}**`,
    "",
    plan.summary,
  ];

  if (plan.blockers.length > 0) {
    lines.push("", "**Blockers**");
    for (const blocker of plan.blockers) {
      lines.push(`- ${blocker}`);
    }
  }

  if (plan.steps.length > 0) {
    lines.push("", "**Steps**");
    for (const step of plan.steps) {
      const prefix = step.status === "ready"
        ? "[ready]"
        : step.status === "blocked"
        ? "[blocked]"
        : "[info]";
      lines.push(`- ${prefix} ${step.title}: ${step.detail}`);
    }
  }

  if (plan.preview && Object.keys(plan.preview).length > 0) {
    lines.push("", "**Preview**");
    for (const [key, value] of Object.entries(plan.preview)) {
      lines.push(`- ${key}: ${String(value)}`);
    }
  }

  return lines.join("\n");
}
