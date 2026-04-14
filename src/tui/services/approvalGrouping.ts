// Approval Grouping
//
// Instead of showing 5 separate approval dialogs for a multi-step agent task,
// group them into one logical approval. E.g., "Execute trading workflow: scan,
// analyze, generate plan" becomes a single approval request.

export interface ApprovalStep {
  id: string;
  toolName: string;
  description: string;
  riskLevel: "low" | "medium" | "high" | "critical";
}

export interface ApprovalGroup {
  id: string;
  title: string;
  description: string;
  steps: ApprovalStep[];
  maxRiskLevel: "low" | "medium" | "high" | "critical";
  requiresExplicitApproval: boolean;
}

// Rules for grouping: tools that commonly run together as one logical operation
const GROUP_RULES: Record<string, { title: string; tools: string[] }> = {
  "trading-workflow": {
    title: "Trading Workflow",
    tools: ["scan_market", "analyze_symbol", "generate_plan"],
  },
  "position-management": {
    title: "Position Management",
    tools: ["check_positions", "update_stop_loss", "update_take_profit"],
  },
  "fund-transfer": {
    title: "Fund Transfer",
    tools: ["get_balance", "estimate_fees", "transfer_funds"],
  },
  "research-suite": {
    title: "Market Research",
    tools: ["fetch_news", "fetch_sec_filings", "fetch_indicators"],
  },
};

const RISK_LEVELS = ["low", "medium", "high", "critical"] as const;

function maxRisk(a: string, b: string): "low" | "medium" | "high" | "critical" {
  const idx = Math.max(RISK_LEVELS.indexOf(a as any), RISK_LEVELS.indexOf(b as any));
  return RISK_LEVELS[Math.max(0, idx)]!;
}

export function groupApprovals(steps: ApprovalStep[]): ApprovalGroup[] {
  if (steps.length === 0) return [];

  const groups: ApprovalGroup[] = [];
  const used = new Set<string>();

  // Try to match rule-based groups
  for (const [groupId, rule] of Object.entries(GROUP_RULES)) {
    const matching = steps.filter((s) => rule.tools.includes(s.toolName) && !used.has(s.id));
    if (matching.length >= 2) {
      const maxR = matching.reduce<"low" | "medium" | "high" | "critical">((r, s) => maxRisk(r, s.riskLevel), "low");
      groups.push({
        id: `group_${groupId}_${Date.now()}`,
        title: rule.title,
        description: matching.map((s) => s.description).join(" → "),
        steps: matching,
        maxRiskLevel: maxR,
        requiresExplicitApproval: maxR === "high" || maxR === "critical",
      });
      matching.forEach((s) => used.add(s.id));
    }
  }

  // Any unmatched steps become individual approvals
  for (const step of steps) {
    if (used.has(step.id)) continue;
    groups.push({
      id: `group_single_${step.id}`,
      title: step.toolName,
      description: step.description,
      steps: [step],
      maxRiskLevel: step.riskLevel,
      requiresExplicitApproval: step.riskLevel === "high" || step.riskLevel === "critical",
    });
  }

  return groups;
}

export function isAutoApprovable(group: ApprovalGroup, mode: "auto" | "ask" | "strict"): boolean {
  if (mode === "strict") return false;
  if (mode === "ask") return group.maxRiskLevel === "low";
  // auto mode
  return group.maxRiskLevel === "low" || group.maxRiskLevel === "medium";
}
