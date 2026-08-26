import type {
  RuntimePermissionScope,
  RuntimeRiskClass,
  RuntimeSideEffectLevel,
  RuntimeToolCategory,
  RuntimeToolSpec,
  RuntimeWorkerRole,
} from "../contracts/types.ts";

/**
 * An explicit, author-written capability declaration. Unlike the name-regex
 * inference below, a declaration is authority the tool carries: category and
 * permissionScope are mandatory, and the registry uses it verbatim instead of
 * guessing from the tool id.
 */
export type ToolCapabilityDeclaration =
  Pick<RuntimeToolSpec, "category" | "permissionScope"> & Partial<RuntimeToolSpec>;

/**
 * Tools whose authority is DECLARED rather than inferred. Name-regex inference
 * is skipped entirely for these ids, so adding a tool whose name happens to
 * miss every pattern cannot silently downgrade its permission scope.
 */
const DECLARED_TOOL_CAPABILITIES: Record<string, ToolCapabilityDeclaration> = {
  // Writes process.env and ~/.gordon/settings.local.json, and its settable set
  // includes GORDON_ALLOW_LIVE, GORDON_RISK_MODE and GORDON_RISK_MAX_LEVERAGE.
  // The orchestrator carries this tool, so an auto-approved manage_flags is a
  // path from a chat turn to live capital. Never auto-approved.
  manage_flags: {
    category: "system",
    permissionScope: "system.mode.write",
    riskClass: "critical",
    sideEffectLevel: "write",
    workerRole: "Gordon",
    requiresTradePermission: false,
    supportsStreaming: false,
    supportsBackground: false,
    idempotent: false,
  },
};

const STATIC_TOOL_OVERRIDES: Record<string, Partial<RuntimeToolSpec>> = {
  quick_scan: {
    category: "market",
    permissionScope: "market.read",
    riskClass: "low",
    sideEffectLevel: "none",
    workerRole: "Scanner",
  },
  quick_check_positions: {
    category: "monitoring",
    permissionScope: "portfolio.read",
    riskClass: "low",
    sideEffectLevel: "read",
    workerRole: "Monitor",
  },
  runtime_query_stream: {
    category: "runtime",
    permissionScope: "analysis.run",
    riskClass: "low",
    sideEffectLevel: "read",
    workerRole: "Gordon",
    supportsStreaming: true,
    supportsBackground: false,
    requiresTradePermission: false,
  },
  runtime_query_message: {
    category: "runtime",
    permissionScope: "analysis.run",
    riskClass: "low",
    sideEffectLevel: "read",
    workerRole: "Gordon",
    requiresTradePermission: false,
  },
  runtime_query_structured: {
    category: "runtime",
    permissionScope: "analysis.run",
    riskClass: "low",
    sideEffectLevel: "read",
    workerRole: "Gordon",
    requiresTradePermission: false,
  },
  scan_market: {
    category: "market",
    permissionScope: "market.read",
    riskClass: "low",
    sideEffectLevel: "none",
    workerRole: "Scanner",
  },
  get_trending_tokens: {
    category: "market",
    permissionScope: "market.read",
    riskClass: "low",
    sideEffectLevel: "none",
    workerRole: "Scanner",
  },
  get_high_volume_tokens: {
    category: "market",
    permissionScope: "market.read",
    riskClass: "low",
    sideEffectLevel: "none",
    workerRole: "Scanner",
  },
  analyze_coin: {
    category: "analysis",
    permissionScope: "market.read",
    riskClass: "low",
    sideEffectLevel: "read",
    workerRole: "Analyst",
  },
  analyze_whale_orders: {
    category: "analysis",
    permissionScope: "market.read",
    riskClass: "low",
    sideEffectLevel: "read",
    workerRole: "Analyst",
  },
  scan_breakouts: {
    category: "analysis",
    permissionScope: "market.read",
    riskClass: "low",
    sideEffectLevel: "read",
    workerRole: "Scanner",
  },
  score_market: {
    category: "analysis",
    permissionScope: "analysis.run",
    riskClass: "medium",
    sideEffectLevel: "read",
    workerRole: "Analyst",
  },
  generate_chart: {
    category: "market",
    permissionScope: "market.read",
    riskClass: "low",
    sideEffectLevel: "read",
    workerRole: "Analyst",
  },
  quick_ta: {
    category: "analysis",
    permissionScope: "market.read",
    riskClass: "low",
    sideEffectLevel: "read",
    workerRole: "Analyst",
  },
  display_candlestick_chart: {
    category: "market",
    permissionScope: "market.read",
    riskClass: "low",
    sideEffectLevel: "read",
    workerRole: "Analyst",
  },
  create_plan: {
    category: "planning",
    permissionScope: "analysis.run",
    riskClass: "medium",
    sideEffectLevel: "read",
    workerRole: "Planner",
  },
  create_grid_plan: {
    category: "planning",
    permissionScope: "analysis.run",
    riskClass: "medium",
    sideEffectLevel: "read",
    workerRole: "Planner",
  },
  preview_market_order: {
    category: "planning",
    permissionScope: "analysis.run",
    riskClass: "medium",
    sideEffectLevel: "read",
    workerRole: "Planner",
    requiresTradePermission: false,
  },
  approve_plan: {
    category: "planning",
    permissionScope: "system.mode.write",
    riskClass: "medium",
    sideEffectLevel: "write",
    workerRole: "Planner",
  },
  check_positions: {
    category: "monitoring",
    permissionScope: "portfolio.read",
    riskClass: "low",
    sideEffectLevel: "read",
    workerRole: "Monitor",
  },
  get_open_orders: {
    category: "monitoring",
    permissionScope: "portfolio.read",
    riskClass: "low",
    sideEffectLevel: "read",
    workerRole: "Monitor",
  },
  execute_plan: {
    category: "execution",
    permissionScope: "livetrade.execute",
    riskClass: "high",
    sideEffectLevel: "execution",
    workerRole: "Executor",
    requiresTradePermission: true,
  },
  close_trade: {
    category: "execution",
    permissionScope: "livetrade.execute",
    riskClass: "high",
    sideEffectLevel: "execution",
    workerRole: "Executor",
    requiresTradePermission: true,
  },
  transfer_funds: {
    category: "wallet",
    permissionScope: "transfer.execute",
    riskClass: "critical",
    sideEffectLevel: "execution",
    workerRole: "Executor",
    requiresTradePermission: true,
  },
  withdraw_to_external: {
    category: "wallet",
    permissionScope: "transfer.execute",
    riskClass: "critical",
    sideEffectLevel: "execution",
    workerRole: "Executor",
    requiresTradePermission: true,
  },
  set_permission_mode: {
    category: "system",
    permissionScope: "system.mode.write",
    riskClass: "medium",
    sideEffectLevel: "write",
    workerRole: "Gordon",
  },
  handle_exchange_command: {
    category: "system",
    permissionScope: "system.mode.write",
    riskClass: "medium",
    sideEffectLevel: "write",
    workerRole: "Gordon",
  },
  handle_broker_command: {
    category: "system",
    permissionScope: "system.mode.write",
    riskClass: "medium",
    sideEffectLevel: "write",
    workerRole: "Gordon",
  },
  handle_stocks_command: {
    category: "monitoring",
    permissionScope: "portfolio.read",
    riskClass: "medium",
    sideEffectLevel: "read",
    workerRole: "Monitor",
    // buy/sell subcommands fall through to the agent in toolHandlers.ts
  },
  handle_config_command: {
    category: "system",
    permissionScope: "system.mode.write",
    riskClass: "medium",
    sideEffectLevel: "write",
    workerRole: "Gordon",
  },
  handle_keyring_command: {
    category: "system",
    permissionScope: "system.mode.write",
    riskClass: "medium",
    sideEffectLevel: "write",
    workerRole: "Gordon",
  },
  handle_mcp_command: {
    category: "system",
    permissionScope: "mcp.connect",
    riskClass: "high",
    sideEffectLevel: "write",
    workerRole: "Gordon",
  },
  handle_routing_command: {
    category: "system",
    permissionScope: "mcp.connect",
    riskClass: "high",
    sideEffectLevel: "write",
    workerRole: "Gordon",
  },
  handle_workflow_command: {
    category: "runtime",
    permissionScope: "runtime.background.write",
    riskClass: "high",
    sideEffectLevel: "write",
    workerRole: "Executor",
  },
  handle_export_command: {
    category: "analysis",
    permissionScope: "analysis.run",
    riskClass: "low",
    sideEffectLevel: "read",
    workerRole: "Gordon",
  },
  handle_telemetry_command: {
    category: "system",
    permissionScope: "system.mode.write",
    riskClass: "medium",
    sideEffectLevel: "write",
    workerRole: "Gordon",
  },
  get_cache_stats: {
    category: "system",
    permissionScope: "system.mode.write",
    riskClass: "low",
    sideEffectLevel: "read",
    workerRole: "Gordon",
  },
  test_connection: {
    category: "system",
    permissionScope: "system.mode.write",
    riskClass: "low",
    sideEffectLevel: "read",
    workerRole: "Gordon",
  },
  create_swing_mandate: {
    category: "planning",
    permissionScope: "papertrade.execute",
    riskClass: "medium",
    sideEffectLevel: "write",
    workerRole: "Planner",
  },
  start_autonomous_mode: {
    category: "system",
    permissionScope: "runtime.background.write",
    riskClass: "high",
    sideEffectLevel: "write",
    workerRole: "Executor",
  },
  stop_autonomous_mode: {
    category: "system",
    permissionScope: "runtime.background.write",
    riskClass: "medium",
    sideEffectLevel: "write",
    workerRole: "Executor",
  },
};

function inferCategory(toolId: string): RuntimeToolCategory {
  const normalized = toolId.toLowerCase();
  if (/order|trade|swap|execute|buy|sell|cancel|autonomous|liquidate|bridge/.test(normalized)) return "execution";
  if (/scan|market|price|orderbook|liquidation|pair|chart/.test(normalized)) return "market";
  if (/analy|signal|score|regime|research|detect/.test(normalized)) return "analysis";
  if (/plan|strategy|playbook|kelly|risk|mandate/.test(normalized)) return "planning";
  if (/monitor|position|portfolio|account|history|status|balance/.test(normalized)) return "monitoring";
  if (/wallet|transfer|withdraw|deposit/.test(normalized)) return "wallet";
  if (/arm|disarm|config|scheduler|runtime|system|daemon/.test(normalized)) return "system";
  if (/explain|lesson|teach/.test(normalized)) return "education";
  if (/backtest|monte|walk_forward|optimization|dataset/.test(normalized)) return "backtest";
  return "unknown";
}

/**
 * Returns `undefined` when neither a name pattern nor the category places the
 * tool. An unplaced tool must not fall back to `analysis.run`: that scope
 * carries approvalClass "none", which the permission classifier auto-allows.
 */
function inferPermissionScope(toolId: string, category: RuntimeToolCategory): RuntimePermissionScope | undefined {
  const normalized = toolId.toLowerCase();
  if (/plugin|install/.test(normalized)) return "plugin.install";
  if (/mcp|reload_mcp/.test(normalized)) return "mcp.connect";
  if (/arm|disarm|mode|config|scheduler|runtime|daemon/.test(normalized)) return "system.mode.write";
  if (/background|autonomous|run_cycle/.test(normalized)) return "runtime.background.write";
  if (/transfer|withdraw|bridge/.test(normalized)) return "transfer.execute";
  if (/wallet|send|stake|unstake/.test(normalized)) return "wallet.write";
  if (/order|trade|swap|execute|buy|sell|cancel|liquidate/.test(normalized)) return "livetrade.execute";
  if (category === "planning") return "analysis.run";
  if (category === "monitoring") return "portfolio.read";
  if (category === "market" || category === "analysis") return "market.read";
  if (category === "education" || category === "backtest") return "analysis.run";
  return undefined;
}

/**
 * Scope handed to a tool that is neither declared nor placed by any pattern.
 * `system.mode.write` is the narrowest existing scope whose approvalClass
 * ("per_tool") keeps the default classifier from auto-allowing, so an unknown
 * tool reaches a human instead of running unattended.
 */
const UNCLASSIFIED_PERMISSION_SCOPE: RuntimePermissionScope = "system.mode.write";

function inferRiskClass(scope: RuntimePermissionScope, category: RuntimeToolCategory): RuntimeRiskClass {
  switch (scope) {
    case "transfer.execute":
      return "critical";
    case "livetrade.execute":
    case "wallet.write":
      return "high";
    case "system.mode.write":
    case "runtime.background.write":
      return "medium";
    case "plugin.install":
    case "mcp.connect":
      return "high";
    case "portfolio.read":
      return "low";
    case "market.read":
    case "analysis.run":
      return category === "planning" ? "medium" : "low";
    case "papertrade.execute":
      return "medium";
    default:
      return "medium";
  }
}

function inferSideEffectLevel(scope: RuntimePermissionScope): RuntimeSideEffectLevel {
  switch (scope) {
    case "market.read":
      return "none";
    case "analysis.run":
    case "portfolio.read":
      return "read";
    case "system.mode.write":
    case "runtime.background.write":
    case "plugin.install":
    case "mcp.connect":
    case "wallet.write":
      return "write";
    case "papertrade.execute":
    case "livetrade.execute":
    case "transfer.execute":
      return "execution";
    default:
      return "read";
  }
}

function inferWorkerRole(toolId: string, category: RuntimeToolCategory, scope: RuntimePermissionScope): RuntimeWorkerRole {
  const normalized = toolId.toLowerCase();
  if (category === "education") return "Teacher";
  if (category === "backtest") return "Backtester";
  if (scope === "livetrade.execute" || scope === "transfer.execute" || /autonomous|execute/.test(normalized)) return "Executor";
  if (category === "planning") return "Planner";
  if (category === "analysis") return "Analyst";
  if (category === "market") return /scan/.test(normalized) ? "Scanner" : "Analyst";
  if (category === "monitoring" || /position|portfolio|account/.test(normalized)) return "Monitor";
  return "Gordon";
}

export class CapabilityRegistry {
  private readonly overrides = new Map<string, Partial<RuntimeToolSpec>>();

  registerOverride(toolId: string, override: Partial<RuntimeToolSpec>): void {
    this.overrides.set(toolId, override);
  }

  resolveToolSpec(toolId: string): RuntimeToolSpec {
    const declaration = DECLARED_TOOL_CAPABILITIES[toolId];
    const category = declaration?.category ?? inferCategory(toolId);
    const inferredScope = declaration?.permissionScope ?? inferPermissionScope(toolId, category);
    const unclassified = inferredScope === undefined;
    const permissionScope = inferredScope ?? UNCLASSIFIED_PERMISSION_SCOPE;
    const riskClass = inferRiskClass(permissionScope, category);
    const sideEffectLevel = inferSideEffectLevel(permissionScope);
    const requiresTradePermission = permissionScope === "livetrade.execute" || permissionScope === "transfer.execute";
    const workerRole = inferWorkerRole(toolId, category, permissionScope);

    const base: RuntimeToolSpec = {
      id: toolId,
      category,
      riskClass: unclassified ? "high" : riskClass,
      permissionScope,
      sideEffectLevel,
      requiresTradePermission,
      supportsStreaming: category === "analysis" || category === "planning",
      supportsBackground: category === "system" || category === "monitoring" || category === "market",
      idempotent: sideEffectLevel !== "execution",
      workerRole,
      auditEventType: `${category}.${toolId}`,
    };

    const staticOverride = STATIC_TOOL_OVERRIDES[toolId];
    const override = this.overrides.get(toolId);
    return {
      ...base,
      ...(staticOverride ?? {}),
      ...(override ?? {}),
      // An explicit declaration is the authority for the tool and outranks both
      // the inferred base and any registered override.
      ...(declaration ?? {}),
    };
  }
}
