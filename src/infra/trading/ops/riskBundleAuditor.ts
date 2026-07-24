/**
 * Risk Bundle Auditor (GORDON_RISK_BUNDLE_AUDITOR).
 *
 * Port of Ch 10 from Ryan Wright. Every trade is a bundle of risks —
 * not just the thesis you analyzed. Wright enumerates 8 categories
 * that every position carries; each must be tagged Yes (paid to take),
 * No (must hedge/eliminate), or Neutral (cost of doing business).
 *
 *   thesis | market | sector | liquidity | execution
 *   correlation | gap | operational
 *
 * Rob Hall died on Everest with the thesis right (route, weather window,
 * client fitness) but the bundle wrong (crowding + competitive pressure
 * + correlation when everyone needed to descend at once + gap risk
 * from the storm). The bundle determines whether you get out.
 *
 * Distinct from `riskClassifier.ts` (15-dimension quantitative scoring —
 * 8 base + 7 optional hedge-fund-grade dimensions when inputs exist →
 * auto_approve/prompt/require_confirmation/block) — that's a safety
 * gate. This is a *categorical* pre-trade audit forcing the operator
 * to confront every risk type and unbundle the ones they aren't paid
 * for. Pre-trade verdict gates the trade when any required category is
 * left as No without a hedge.
 */

export type RiskCategory =
  | "thesis"
  | "market"
  | "sector"
  | "liquidity"
  | "execution"
  | "correlation"
  | "gap"
  | "operational";

export type RiskTag = "yes" | "no" | "neutral";

export interface RiskItem {
  category: RiskCategory;
  tag: RiskTag;
  /** Free-text justification — required when tag is 'yes' or 'no'. */
  reason?: string;
  /** If tag='no' but unhedged, lists the planned mitigation. */
  hedge?: string;
}

export interface AuditInput {
  items: ReadonlyArray<RiskItem>;
}

export interface AuditResult {
  itemsByCategory: Record<RiskCategory, RiskItem | null>;
  uncoveredCategories: RiskCategory[];
  unhedgedNoItems: RiskItem[];
  paidRisks: RiskItem[];
  verdict: "go" | "incomplete" | "no_go";
  blockers: string[];
}

const REQUIRED_CATEGORIES: RiskCategory[] = [
  "thesis",
  "market",
  "sector",
  "liquidity",
  "execution",
  "correlation",
  "gap",
  "operational",
];

export function auditRiskBundle(input: AuditInput): AuditResult {
  const itemsByCategory: Record<string, RiskItem | null> = {};
  for (const cat of REQUIRED_CATEGORIES) itemsByCategory[cat] = null;
  for (const item of input.items) itemsByCategory[item.category] = item;

  const uncovered = REQUIRED_CATEGORIES.filter((c) => itemsByCategory[c] === null);
  const unhedgedNo = input.items.filter(
    (i) => i.tag === "no" && (!i.hedge || !i.hedge.trim()),
  );
  const paid = input.items.filter((i) => i.tag === "yes");

  const blockers: string[] = [];
  if (uncovered.length > 0) {
    blockers.push(`Missing audit for: ${uncovered.join(", ")}`);
  }
  for (const item of unhedgedNo) {
    blockers.push(`${item.category} tagged 'no' but no hedge specified`);
  }
  if (paid.length === 0) {
    blockers.push("No category tagged 'yes' — no risk you're paid to take, no edge");
  }

  let verdict: AuditResult["verdict"];
  if (uncovered.length > 0) verdict = "incomplete";
  else if (unhedgedNo.length > 0 || paid.length === 0) verdict = "no_go";
  else verdict = "go";

  return {
    itemsByCategory: itemsByCategory as Record<RiskCategory, RiskItem | null>,
    uncoveredCategories: uncovered,
    unhedgedNoItems: unhedgedNo,
    paidRisks: paid,
    verdict,
    blockers,
  };
}

export function formatAudit(result: AuditResult): string {
  const lines: string[] = [];
  lines.push(`Risk bundle audit — ${result.verdict.toUpperCase()}`);
  for (const cat of REQUIRED_CATEGORIES) {
    const item = result.itemsByCategory[cat];
    if (!item) {
      lines.push(`  ${cat}: <missing>`);
    } else {
      const hedgeStr = item.hedge ? ` → hedge: ${item.hedge}` : "";
      lines.push(`  ${cat}: ${item.tag.toUpperCase()} ${item.reason ? `(${item.reason})` : ""}${hedgeStr}`);
    }
  }
  if (result.blockers.length > 0) {
    lines.push("  Blockers:");
    for (const b of result.blockers) lines.push(`    - ${b}`);
  }
  return lines.join("\n");
}

export function auditToPayload(result: AuditResult): Record<string, unknown> {
  return {
    kind: "risk_bundle.audited",
    verdict: result.verdict,
    paidCount: result.paidRisks.length,
    uncoveredCount: result.uncoveredCategories.length,
    unhedgedNoCount: result.unhedgedNoItems.length,
  };
}
