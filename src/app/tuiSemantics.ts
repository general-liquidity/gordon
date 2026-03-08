import type { TaskTreeNode, TaskTreeNodeStatus } from "./taskTree.ts";
import { COLORS } from "./theme.ts";

export const GORDON_GLYPH_FRAMES = ["▁", "▃", "▅", "▇", "▅", "▃"] as const;

type LoaderTone = "discover" | "analyze" | "trade" | "run" | "rails" | "operate" | "neutral";

const LOADER_TONE_PATTERNS: Array<{ tone: LoaderTone; patterns: RegExp[] }> = [
  { tone: "discover", patterns: [/scan/i, /trend/i, /volume/i, /mover/i, /discovery/i] },
  { tone: "analyze", patterns: [/analy/i, /chart/i, /indicator/i, /regime/i, /pair/i, /liquidation/i] },
  { tone: "trade", patterns: [/trade/i, /plan/i, /order/i, /position/i, /portfolio/i, /account/i, /preview/i] },
  { tone: "run", patterns: [/backtest/i, /systematic/i, /dataset/i, /experiment/i, /validate/i, /runtime/i, /autonomous/i] },
  { tone: "rails", patterns: [/rail/i, /wallet/i, /payment/i, /moonpay/i, /polygon/i, /helius/i, /chainlink/i, /base/i, /solana/i, /dex/i, /protocol/i] },
  { tone: "operate", patterns: [/doctor/i, /setup/i, /config/i, /daemon/i, /scheduler/i, /health/i, /routing/i] },
];

const FAMILY_COLORS: Record<string, string> = {
  "market-analysis": COLORS.DISCOVER,
  "trading-execution": COLORS.TRADE,
  "systematic-research": COLORS.RUN,
  "automation-runtime": COLORS.OPERATE,
  "rails-payments": COLORS.RAILS,
  "onchain-protocols": COLORS.RAILS,
  "web-automation": COLORS.OPERATE,
  "general-request": COLORS.ACCENT,
};

function resolveLoaderTone(input?: string | null): LoaderTone {
  const value = input?.trim();
  if (!value) return "neutral";

  for (const entry of LOADER_TONE_PATTERNS) {
    if (entry.patterns.some((pattern) => pattern.test(value))) {
      return entry.tone;
    }
  }

  return "neutral";
}

export function getLoaderColor(options?: {
  currentTool?: string | null;
  activityStatus?: string | null;
  variant?: "startup" | "streaming" | "response";
}): string {
  if (options?.variant === "startup") {
    return COLORS.HIGHLIGHT;
  }

  const tone = resolveLoaderTone(options?.currentTool ?? options?.activityStatus);
  switch (tone) {
    case "discover":
      return COLORS.DISCOVER;
    case "analyze":
      return COLORS.ANALYZE;
    case "trade":
      return COLORS.TRADE;
    case "run":
      return COLORS.RUN;
    case "rails":
      return COLORS.RAILS;
    case "operate":
      return COLORS.OPERATE;
    case "neutral":
    default:
      return COLORS.HIGHLIGHT;
  }
}

export function getTaskStatusColor(status: TaskTreeNodeStatus): string {
  switch (status) {
    case "running":
      return COLORS.HIGHLIGHT;
    case "completed":
      return COLORS.SUCCESS;
    case "failed":
      return COLORS.ERROR;
    case "cancelled":
      return COLORS.WARNING;
    case "blocked":
      return COLORS.ERROR;
    case "queued":
      return COLORS.DISCOVER;
    case "pending":
    default:
      return COLORS.DIM;
  }
}

export function getTaskLabelColor(node: Pick<TaskTreeNode, "kind" | "meta">, isActiveLeaf: boolean): string {
  if (isActiveLeaf) {
    return COLORS.WHITE;
  }

  if (node.kind === "request") {
    return COLORS.ACCENT;
  }

  if (node.kind === "family") {
    const familyKey = node.meta?.familyKey;
    return familyKey ? (FAMILY_COLORS[familyKey] ?? COLORS.ACCENT_DIM) : COLORS.ACCENT_DIM;
  }

  if (node.kind === "queue") {
    return COLORS.OPERATE;
  }

  return COLORS.WHITE;
}
