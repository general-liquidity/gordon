import type { Mode } from "../types/index.ts";
import type { WorkspaceId } from "./state/AppStore.ts";

export type LegacyCommandCategory = "trading" | "market" | "account" | "system" | "strategy";
export type CommandLevel = 1 | 2 | 3;
export type WorkflowGroup = "discover" | "analyze" | "trade" | "run" | "accounts" | "operate";
export type CommandAudience = "core" | "advanced" | "operator";

export interface WorkflowConfigEntry {
  label: string;
  shortLabel: string;
  description: string;
  icon: string;
  order: number;
  helpAliases: string[];
}

export interface CommandUxShape {
  name: string;
  category: LegacyCommandCategory;
  level: CommandLevel;
}

export interface CommandUxMetadata {
  workflow: WorkflowGroup;
  audience: CommandAudience;
  workflowLabel: string;
  audienceLabel: string;
  workflowOrder: number;
  audienceOrder: number;
  hideAliasesByDefault: boolean;
}

export interface QuickActionContext {
  mode: Mode;
  workspace: WorkspaceId;
  setupComplete: boolean;
  hasExchange: boolean;
  hasBroker: boolean;
  hasWalletRails: boolean;
}

export interface QuickActionItem {
  label: string;
  command: string;
  workflow?: WorkflowGroup;
}

export const WORKFLOW_CONFIG: Record<WorkflowGroup, WorkflowConfigEntry> = {
  discover: {
    label: "Discover",
    shortLabel: "Discover",
    description: "Scan, movers, regime.",
    icon: "◆",
    order: 0,
    helpAliases: ["discover", "market", "markets", "scan"],
  },
  analyze: {
    label: "Analyze",
    shortLabel: "Analyze",
    description: "Inspect symbols and signals.",
    icon: "◈",
    order: 1,
    helpAliases: ["analyze", "analysis"],
  },
  trade: {
    label: "Trade",
    shortLabel: "Trade",
    description: "Plan, preview, fund, execute.",
    icon: "▲",
    order: 2,
    helpAliases: ["trade", "trading", "execution"],
  },
  run: {
    label: "Run",
    shortLabel: "Run",
    description: "Backtests, strategies, runtime.",
    icon: "◇",
    order: 3,
    helpAliases: ["run", "strategy", "strategies"],
  },
  accounts: {
    label: "Accounts",
    shortLabel: "Accounts",
    description: "Portfolio, venues, rails.",
    icon: "■",
    order: 4,
    helpAliases: ["accounts", "account", "portfolio", "wallet"],
  },
  operate: {
    label: "Operate",
    shortLabel: "Operate",
    description: "Setup, diagnostics, system control.",
    icon: "●",
    order: 5,
    helpAliases: ["operate", "ops", "system", "config", "configure"],
  },
};

const AUDIENCE_LABELS: Record<CommandAudience, string> = {
  core: "Core",
  advanced: "Advanced",
  operator: "Operator",
};

const AUDIENCE_ORDER: Record<CommandAudience, number> = {
  core: 0,
  advanced: 1,
  operator: 2,
};

const ANALYZE_COMMANDS = new Set([
  "analyze",
  "whales",
  "chart",
  "ta",
  "candlestick",
  "research",
  "ensemble",
  "deep",
  "parallel",
  "compare-coins",
  "fast-deep",
  "mtf",
  "pair-analysis",
  "chainlink",
  "base",
  "synthdata",
  "forecast",
  "liquidation",
]);

const RUN_COMMANDS = new Set([
  "backtest",
  "optimize",
  "compare",
  "strategies",
  "gen",
  "deploy",
  "strategies-live",
  "pause",
  "stop",
  "rebalance",
  "mutate",
  "autobacktest",
  "portfolio-health",
  "autonomous",
]);

const ACCOUNT_COMMANDS = new Set([
  "portfolio",
  "wallet",
  "earn",
  "history",
  "exchange",
  "broker",
  "stocks",
  "performance",
  "withdraw",
  "chains",
  "rails",
]);

const OPERATE_COMMANDS = new Set([
  "help",
  "status",
  "setup",
  "configure",
  "doctor",
  "preferences",
  "model",
  "shortcuts",
  "theme",
  "resume-thread",
  "new-thread",
  "threads",
  "switch-thread",
  "thread-info",
  "delete-thread",
  "rename-thread",
  "cache-stats",
  "mcp",
  "routing",
  "workflow",
  "export",
  "clone-thread",
  "keyring",
  "telemetry",
  "bugreport",
  "whatsnew",
  "arm",
  "disarm",
  "validate",
  "session",
  "log",
  "summary",
  "compact",
  "name",
]);

const CATEGORY_DEFAULT_WORKFLOW: Record<LegacyCommandCategory, WorkflowGroup> = {
  market: "discover",
  trading: "trade",
  strategy: "run",
  account: "accounts",
  system: "operate",
};

export function getAudienceFromLevel(level: CommandLevel): CommandAudience {
  if (level === 1) return "core";
  if (level === 2) return "advanced";
  return "operator";
}

export function getAudienceLabel(audience: CommandAudience): string {
  return AUDIENCE_LABELS[audience];
}

export function inferWorkflowGroup(command: Pick<CommandUxShape, "name" | "category">): WorkflowGroup {
  const name = command.name.toLowerCase();

  if (ANALYZE_COMMANDS.has(name)) return "analyze";
  if (RUN_COMMANDS.has(name)) return "run";
  if (ACCOUNT_COMMANDS.has(name)) return "accounts";
  if (OPERATE_COMMANDS.has(name)) return "operate";

  return CATEGORY_DEFAULT_WORKFLOW[command.category];
}

export function normalizeCommandUx<T extends CommandUxShape>(command: T): T & CommandUxMetadata {
  const workflow = inferWorkflowGroup(command);
  const audience = getAudienceFromLevel(command.level);
  const workflowConfig = WORKFLOW_CONFIG[workflow];

  return {
    ...command,
    workflow,
    audience,
    workflowLabel: workflowConfig.label,
    audienceLabel: getAudienceLabel(audience),
    workflowOrder: workflowConfig.order,
    audienceOrder: AUDIENCE_ORDER[audience],
    hideAliasesByDefault: true,
  };
}

export function sortCommandsForPresentation<T extends CommandUxMetadata & { name: string }>(commands: T[]): T[] {
  return [...commands].sort((left, right) => {
    const workflowDiff = left.workflowOrder - right.workflowOrder;
    if (workflowDiff !== 0) return workflowDiff;

    return left.name.localeCompare(right.name);
  });
}

export function resolveWorkflowTopic(arg: string): WorkflowGroup | undefined {
  const normalized = arg.trim().toLowerCase();
  if (!normalized) return undefined;

  for (const [workflow, config] of Object.entries(WORKFLOW_CONFIG) as Array<[WorkflowGroup, WorkflowConfigEntry]>) {
    if (config.helpAliases.includes(normalized)) {
      return workflow;
    }
  }

  return undefined;
}

export function getQuickActionItems(context: QuickActionContext): QuickActionItem[] {
  const hasVenue = context.hasExchange || context.hasBroker;

  if (!context.setupComplete || !hasVenue) {
    const setupActions: QuickActionItem[] = [
      { label: "Setup", command: "/setup", workflow: "operate" },
      { label: "Doctor", command: "/doctor", workflow: "operate" },
      { label: "Model", command: "/model", workflow: "operate" },
      { label: "Help", command: "/help", workflow: "operate" },
      { label: "Configure", command: "/configure advanced", workflow: "operate" },
    ];
    return setupActions.slice(0, 5);
  }

  switch (context.workspace) {
    case "market":
      return [
        { label: "Scan", command: "/scan", workflow: "discover" },
        { label: "Trending", command: "/trending", workflow: "discover" },
        { label: "Analyze", command: "/analyze BTC", workflow: "analyze" },
        { label: "Regime", command: "/regime", workflow: "discover" },
        { label: "DD", command: "/workflow dd BTC", workflow: "analyze" },
      ];
    case "plan":
      return [
        { label: "Plan", command: "/plan BTC", workflow: "trade" },
        { label: "Preview", command: "/preview-order", workflow: "trade" },
        { label: "Orders", command: "/orders", workflow: "accounts" },
        { label: "Positions", command: "/positions", workflow: "accounts" },
        context.hasWalletRails
          ? { label: "Fund", command: "/fund quote", workflow: "trade" }
          : { label: "Portfolio", command: "/portfolio", workflow: "accounts" },
      ];
    case "lab":
      return [
        { label: "Strategies", command: "/strategies", workflow: "run" },
        { label: "Generate", command: "/gen trend strategy for ETH", workflow: "run" },
        { label: "Playbooks", command: "/strategy playbooks", workflow: "run" },
        { label: "Backtest", command: "/workflow backtest-cycle sma_crossover BTCUSDT", workflow: "run" },
        { label: "Running", command: "/strategy running", workflow: "run" },
      ];
    case "monitor":
      return [
        { label: "Portfolio", command: "/portfolio", workflow: "accounts" },
        { label: "Positions", command: "/positions", workflow: "accounts" },
        { label: "Orders", command: "/orders", workflow: "accounts" },
        { label: "Runtime", command: "/runtime-state", workflow: "operate" },
        { label: "Health", command: "/health", workflow: "operate" },
      ];
    case "desk":
    default:
      break;
  }

  const actions: QuickActionItem[] = [
    { label: "Scan", command: "/scan", workflow: "discover" },
    { label: "Trending", command: "/trending", workflow: "discover" },
    { label: "Portfolio", command: "/portfolio", workflow: "accounts" },
    { label: "Preview", command: "/preview-order", workflow: "trade" },
  ];

  if (context.hasWalletRails) {
    actions.push({ label: "Fund", command: "/fund quote", workflow: "trade" });
  } else if (context.mode === "ARMED") {
    actions.push({ label: "Orders", command: "/orders", workflow: "accounts" });
  } else {
    actions.push({ label: "Doctor", command: "/doctor", workflow: "operate" });
  }

  return actions.slice(0, 5);
}
