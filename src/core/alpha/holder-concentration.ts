/**
 * Token holder-concentration risk.
 *
 * The second crypto footgun: who actually owns the supply. If a handful of
 * wallets hold most of it — and they're labeled team or an early VC fund —
 * you're the exit liquidity by design. This computes top-N concentration, the
 * Herfindahl-Hirschman Index (and its reciprocal, the effective number of
 * holders), the insider-controlled fraction (team + investor + foundation),
 * and the exchange-held fraction, then flags the dangerous configurations.
 *
 * Pure function. The caller supplies holder balances + labels (data later from
 * Arkham / Nansen / on-chain); typically the top-N holders by balance. HHI is
 * computed over the supplied set, so with only top-N it is a lower bound on
 * true concentration (the dispersed tail is unobserved) — documented, not hidden.
 */

export type HolderLabel =
  | "team"
  | "investor"
  | "foundation"
  | "exchange"
  | "contract"
  | "community"
  | "unknown";

export interface Holder {
  address: string;
  /** Balance in tokens (same units as totalSupply). */
  balance: number;
  label?: HolderLabel;
}

export interface HolderConcentrationInput {
  holders: Holder[];
  /** Total (or circulating) supply for share computation. */
  totalSupply: number;
  /** N for the top-N concentration figure. Default 10. */
  topN?: number;
  /** Insider-controlled flag threshold, % of supply. Default 30. */
  insiderFlagPct?: number;
}

const INSIDER: ReadonlySet<HolderLabel> = new Set(["team", "investor", "foundation"]);

export interface HolderConcentrationResult {
  top1Pct: number;
  topNPct: number;
  topN: number;
  /** Herfindahl-Hirschman Index over the supplied holders (0..1). */
  hhi: number;
  /** 1/HHI — effective number of independent holders. */
  effectiveHolders: number;
  /** team + investor + foundation share, %. */
  insiderControlledPct: number;
  /** exchange-labeled share, %. */
  exchangePct: number;
  flags: string[];
  verdict: "high" | "moderate" | "low";
  summary: string;
}

export function computeHolderConcentration(
  input: HolderConcentrationInput,
): HolderConcentrationResult {
  const topN = input.topN ?? 10;
  const insiderFlagPct = input.insiderFlagPct ?? 30;
  const supply = input.totalSupply;
  const valid = supply > 0 && input.holders.length > 0;

  const sorted = [...input.holders].sort((a, b) => b.balance - a.balance);
  const pct = (bal: number) => (valid ? (bal / supply) * 100 : 0);

  const top1Pct = sorted.length > 0 ? parseFloat(pct(sorted[0]!.balance).toFixed(4)) : 0;
  const topNPct = parseFloat(
    pct(sorted.slice(0, topN).reduce((s, h) => s + h.balance, 0)).toFixed(4),
  );

  let hhi = 0;
  for (const h of sorted) {
    const share = valid ? h.balance / supply : 0;
    hhi += share * share;
  }
  hhi = parseFloat(hhi.toFixed(6));
  const effectiveHolders = hhi > 0 ? parseFloat((1 / hhi).toFixed(2)) : 0;

  const insiderControlledPct = parseFloat(
    pct(sorted.filter((h) => INSIDER.has(h.label ?? "unknown")).reduce((s, h) => s + h.balance, 0)).toFixed(4),
  );
  const exchangePct = parseFloat(
    pct(sorted.filter((h) => (h.label ?? "unknown") === "exchange").reduce((s, h) => s + h.balance, 0)).toFixed(4),
  );

  const flags: string[] = [];
  if (insiderControlledPct >= insiderFlagPct) {
    flags.push(`insiders (team/investor/foundation) control ${insiderControlledPct.toFixed(1)}% — exit-liquidity risk`);
  }
  if (top1Pct >= 20) flags.push(`single wallet holds ${top1Pct.toFixed(1)}% of supply`);
  if (topNPct >= 60) flags.push(`top ${topN} wallets hold ${topNPct.toFixed(1)}% of supply`);

  const verdict: HolderConcentrationResult["verdict"] =
    insiderControlledPct >= insiderFlagPct || top1Pct >= 20 || topNPct >= 70
      ? "high"
      : topNPct >= 40 || top1Pct >= 10
        ? "moderate"
        : "low";

  const summary = !valid
    ? "Invalid supply or no holders — cannot score concentration."
    : `Holder concentration: top-1 ${top1Pct.toFixed(1)}%, top-${topN} ${topNPct.toFixed(1)}%, ` +
      `insider ${insiderControlledPct.toFixed(1)}%, ~${effectiveHolders} effective holders. Verdict: ${verdict}.`;

  return {
    top1Pct,
    topNPct,
    topN,
    hhi,
    effectiveHolders,
    insiderControlledPct,
    exchangePct,
    flags,
    verdict,
    summary,
  };
}
