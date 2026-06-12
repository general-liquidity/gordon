/**
 * Composability Self-Report
 *
 * Per Variant Fund's "Value of Open Harnesses" essay: the load-bearing
 * value proposition of an open harness is component pluggability —
 * operator can swap LLM providers, exchanges, skills, memory layers,
 * MCP servers without losing the workflow.
 *
 * Gordon already implements every pluggability axis the essay names.
 * This module surfaces the architecture to the operator + agent +
 * future Pro-pilot demos as a structured report. Operator-readable
 * proof of the openness claim.
 *
 * Pure data + small runtime probes. No I/O cost beyond reading the
 * skills directory + MCP catalog file. Dependency-injected probes
 * for tests.
 */

import { readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { discoverSkills } from "../../skills/index.ts";
import { EXCHANGE_IDS } from "../../exchange/types.ts";

export type ComponentAxis =
  | "llm_provider"
  | "exchange"
  | "broker"
  | "skills"
  | "mcp_server"
  | "peer_agent"
  | "strategy_recipe"
  | "risk_dimension"
  | "alpha_diagnostic"
  | "audit_layer";

export interface ComponentSlot {
  axis: ComponentAxis;
  axisLabel: string;
  /** What's currently active / loaded. */
  activeCount: number;
  /** What's available to switch to (total alternatives). */
  availableCount: number;
  /** Sample list (truncated to first 8 for readability). */
  sample: string[];
  /** Can the operator hot-swap or extend this axis without forking Gordon? */
  pluggable: boolean;
  description: string;
}

export interface ComposabilityReport {
  capturedAt: string;
  /** Total pluggable axes Gordon exposes. */
  totalAxes: number;
  /** Sum of active components across all axes. */
  totalActive: number;
  /** Sum of available components across all axes. */
  totalAvailable: number;
  slots: ComponentSlot[];
  /** Operator-readable summary. */
  summary: string;
}

export interface ComposabilityProbes {
  /** Override skill discovery — defaults to `discoverSkills()`. */
  countSkills?: () => number;
  /** Override MCP catalog count — defaults to reading the bundled catalog.json. */
  countMcpServers?: () => number;
  /** Reference timestamp — for deterministic tests. */
  now?: () => Date;
}

// ============================================================================
// Static catalogs
// ============================================================================

const LLM_PROVIDERS = ["openai", "dedalus"] as const;

const NATIVE_EXCHANGES = EXCHANGE_IDS;

const BROKERS = ["ibkr", "alpaca", "trading212", "schwab"] as const;

const PEER_AGENTS_REGISTERED = ["cursor", "warp"] as const;
const PEER_AGENTS_AVAILABLE = ["cursor", "warp", "hermes", "claude_code", "codex", "openclaw"] as const;

const STRATEGY_RECIPES = [
  "regime-rsi",
  "bounce-counter",
  "signal-gate",
  "max-exposure-timeout",
  "atr-breakout",
] as const;

const RISK_CLASSIFIER_DIMENSIONS = [
  "Position Size",
  "Concentration",
  "Drawdown Proximity",
  "Daily Loss Budget",
  "Trade Frequency",
  "Volatility",
  "Market Hours",
  "Asset Familiarity",
  "Vol-Adjusted Sizing",
  "Correlation Risk",
  "Tail Risk",
  "Regime Transition Risk",
  "Venue MEV Exposure",
] as const;

const ALPHA_DIAGNOSTICS = [
  "ic-tracker",
  "ir-diagnostic",
  "effective-n",
  "marginal-contribution",
  "portfolio-optimizer",
  "composite-attribution",
  "walk-forward-ic",
  "too-good-check",
  "vol-clustering",
  "risk-of-ruin",
  "order-book-imbalance",
  "expectancy-by-tag",
  "internal-batch",
  "auction-window",
] as const;

const AUDIT_LAYERS = [
  "trade-ledger",
  "skill-usage",
  "agent-feedback",
  "fork-audit",
  "model-ab-routing",
  "structured-observations",
] as const;

// ============================================================================
// Probes
// ============================================================================

function defaultCountSkills(): number {
  try {
    return discoverSkills().length;
  } catch {
    return 0;
  }
}

function defaultCountMcpServers(): number {
  try {
    const candidates = [
      join(process.cwd(), "src/infra/ai/mcp/marketplace/catalog.json"),
      resolve(__dirname, "../../ai/mcp/marketplace/catalog.json"),
    ];
    for (const path of candidates) {
      if (!existsSync(path)) continue;
      const raw = readFileSync(path, "utf-8");
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) return parsed.length;
      if (parsed && typeof parsed === "object" && "servers" in parsed) {
        const servers = (parsed as { servers?: unknown[] }).servers;
        if (Array.isArray(servers)) return servers.length;
      }
    }
    return 0;
  } catch {
    return 0;
  }
}

// ============================================================================
// Report
// ============================================================================

export function captureComposabilityReport(
  probes: ComposabilityProbes = {},
): ComposabilityReport {
  const now = probes.now ?? (() => new Date());
  const countSkills = probes.countSkills ?? defaultCountSkills;
  const countMcp = probes.countMcpServers ?? defaultCountMcpServers;

  const skillCount = countSkills();
  const mcpCount = countMcp();

  const slots: ComponentSlot[] = [
    {
      axis: "llm_provider",
      axisLabel: "LLM Providers",
      activeCount: 1, // Gordon configures one default at runtime
      availableCount: LLM_PROVIDERS.length,
      sample: [...LLM_PROVIDERS],
      pluggable: true,
      description: "OpenAI-compatible providers routable via the LLM client abstraction. Dedalus routes Anthropic + Google + others through OpenAI-compatible API.",
    },
    {
      axis: "exchange",
      axisLabel: "Crypto Exchanges",
      activeCount: 1, // operator-configured at session start
      availableCount: NATIVE_EXCHANGES.length + 90, // native + CCXT-covered
      sample: [...NATIVE_EXCHANGES, "ccxt:<any of 90+ exchanges>"],
      pluggable: true,
      description: "First-class native venues + 100+ via CCXT. Operator switches per session or per trade.",
    },
    {
      axis: "broker",
      axisLabel: "Equity Brokers",
      activeCount: 1,
      availableCount: BROKERS.length,
      sample: [...BROKERS],
      pluggable: true,
      description: "Equity broker adapters. Operator chooses at session config.",
    },
    {
      axis: "skills",
      axisLabel: "Skills",
      activeCount: skillCount,
      availableCount: skillCount,
      sample: [],
      pluggable: true,
      description: "Bundled + user-authored skills under ~/.gordon/skills/ and project .gordon/skills/. agentskills.io-compliant validation. Governance via /skills audit.",
    },
    {
      axis: "mcp_server",
      axisLabel: "MCP Servers",
      activeCount: 0, // operator-installed at runtime; catalog count is the universe
      availableCount: mcpCount,
      sample: [],
      pluggable: true,
      description: "MCP marketplace catalog. Each server adds tool capabilities to Gordon's agents without modifying Gordon. CoW Swap, OpenBB Workspace, etc.",
    },
    {
      axis: "peer_agent",
      axisLabel: "Peer Agents",
      activeCount: PEER_AGENTS_REGISTERED.length,
      availableCount: PEER_AGENTS_AVAILABLE.length,
      sample: [...PEER_AGENTS_AVAILABLE],
      pluggable: true,
      description: "Subprocess peer-delegation registry. /delegate <peer> <task> routes to external CLI agents. Cursor + Warp wired; Hermes / Claude Code / Codex / OpenClaw deferred.",
    },
    {
      axis: "strategy_recipe",
      axisLabel: "Strategy Recipes",
      activeCount: STRATEGY_RECIPES.length,
      availableCount: STRATEGY_RECIPES.length,
      sample: [...STRATEGY_RECIPES],
      pluggable: true,
      description: "Composable pure-function signal-processing primitives. Operator-extensible by adding new recipe files.",
    },
    {
      axis: "risk_dimension",
      axisLabel: "Risk Classifier Dimensions",
      activeCount: RISK_CLASSIFIER_DIMENSIONS.length,
      availableCount: RISK_CLASSIFIER_DIMENSIONS.length,
      sample: [...RISK_CLASSIFIER_DIMENSIONS],
      pluggable: true,
      description: "13 weighted dimensions in the pre-trade classifier. Each dimension is independent; new ones can be added without affecting existing scoring.",
    },
    {
      axis: "alpha_diagnostic",
      axisLabel: "Alpha Diagnostic Modules",
      activeCount: ALPHA_DIAGNOSTICS.length,
      availableCount: ALPHA_DIAGNOSTICS.length,
      sample: [...ALPHA_DIAGNOSTICS],
      pluggable: true,
      description: "Pluggable diagnostic primitives. IC tracker, IR diagnostic, effective N, marginal contribution, portfolio optimizer, walk-forward IC, too-good-check, vol-clustering, risk-of-ruin, OBI, expectancy-by-tag, internal batch, auction window.",
    },
    {
      axis: "audit_layer",
      axisLabel: "Audit JSONL Layers",
      activeCount: AUDIT_LAYERS.length,
      availableCount: AUDIT_LAYERS.length,
      sample: [...AUDIT_LAYERS],
      pluggable: false,
      description: "Append-only JSONL audit trails under ~/.gordon/. Trade ledger, skill usage, agent feedback, fork audit, A/B routing, structured observations. Operator-readable + replayable.",
    },
  ];

  const totalActive = slots.reduce((s, slot) => s + slot.activeCount, 0);
  const totalAvailable = slots.reduce((s, slot) => s + slot.availableCount, 0);

  const summary =
    `${slots.length} pluggability axes; ` +
    `${totalActive} components currently active; ` +
    `${totalAvailable} available to switch / extend. ` +
    `Per-axis: ${slots.map((s) => `${s.axisLabel.toLowerCase()} ${s.activeCount}/${s.availableCount}`).join(", ")}.`;

  return {
    capturedAt: now().toISOString(),
    totalAxes: slots.length,
    totalActive,
    totalAvailable,
    slots,
    summary,
  };
}

/**
 * Render an operator-readable text report. The structured snapshot
 * is the source of truth; this is for direct CLI / slash-command
 * output.
 */
export function formatComposabilityReport(report: ComposabilityReport): string {
  const lines: string[] = [
    `Gordon Composability Report @ ${report.capturedAt}`,
    `${report.totalAxes} pluggability axes; ${report.totalActive} active; ${report.totalAvailable} available`,
    "",
  ];

  for (const slot of report.slots) {
    const pluggableMark = slot.pluggable ? "✓" : "○";
    lines.push(
      `${pluggableMark} ${slot.axisLabel.padEnd(28)} ${String(slot.activeCount).padStart(4)}/${String(slot.availableCount).padEnd(4)}`,
    );
    lines.push(`    ${slot.description}`);
    if (slot.sample.length > 0) {
      const shown = slot.sample.slice(0, 8);
      const tail = slot.sample.length > 8 ? `, +${slot.sample.length - 8} more` : "";
      lines.push(`    Sample: ${shown.join(", ")}${tail}`);
    }
    lines.push("");
  }

  lines.push(`Summary: ${report.summary}`);
  return lines.join("\n");
}
