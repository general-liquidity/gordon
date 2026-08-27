/**
 * Forensic accounting scores — manipulation / distress / quality / strength.
 *
 * The classic four academic screens, run off raw financial-statement line
 * items: a company that flags here is one whose filing you open and read, not
 * one you short on the number alone. Probability flags, not proof.
 *
 *   - Beneish M-Score   — earnings-manipulation likelihood (the Enron screen).
 *                         8 components; > -2.22 => investigate.
 *   - Altman Z-Score    — bankruptcy / distress. < 1.81 distress, > 2.99 safe.
 *   - Piotroski F-Score — 9 yes/no checks on financial strengthening. >= 6 strong.
 *   - Sloan accruals    — earnings quality. |(NI - CFO)/assets| > 0.25 red flag.
 *
 * Sibling to `fundamentalRatios.ts` (ROIC / valuation multiples) — same
 * conventions: optional typed inputs, NULL on missing inputs (never zeros,
 * never throws) so a partial sheet renders without false flags. Beneish and
 * Piotroski are year-over-year and need `prior`; Altman and Sloan need only
 * `current`. Composes with get_fundamentals / Finnhub fundamentals as the
 * source of the line items.
 *
 * Caveat (the one the literature insists on): Beneish runs on LAST year's data,
 * so a manipulation may already be unwinding by the time it flags; it misses
 * some real frauds and false-flags some clean firms. A bad score means READ THE
 * FILING. Pure function.
 */

export interface ForensicYearInput {
  /** Revenue / net sales. */
  sales?: number;
  /** Cost of goods sold. */
  cogs?: number;
  /** Selling, general & administrative expense. */
  sga?: number;
  /** Net income. */
  netIncome?: number;
  /** Cash flow from operations. */
  cfo?: number;
  /** Accounts receivable, net. */
  receivables?: number;
  /** Total current assets. */
  currentAssets?: number;
  /** Total current liabilities. */
  currentLiabilities?: number;
  /** Property, plant & equipment, net. */
  ppeNet?: number;
  /** Depreciation & amortization. */
  depreciation?: number;
  /** Total assets. */
  totalAssets?: number;
  /** Total liabilities. */
  totalLiabilities?: number;
  /** Long-term debt. */
  longTermDebt?: number;
  /** Retained earnings. */
  retainedEarnings?: number;
  /** EBIT / operating income. */
  ebit?: number;
  /** Market capitalization (for Altman's market-value-of-equity term). */
  marketCap?: number;
  /** Diluted shares outstanding (Piotroski dilution check). */
  sharesOutstanding?: number;
}

export interface ForensicInput {
  /** Most recent fiscal year. */
  current: ForensicYearInput;
  /** Prior fiscal year (required for Beneish + Piotroski). */
  prior?: ForensicYearInput;
}

export type AltmanZone = "distress" | "grey" | "safe";

export interface ForensicResult {
  beneishM: { score: number | null; flag: boolean; cutoff: number };
  altmanZ: { score: number | null; zone: AltmanZone | null };
  piotroskiF: { score: number | null; max: number };
  sloanAccruals: { ratio: number | null; flag: boolean };
  /** INVESTIGATE if any computed score trips its flag; CLEAN if all computed
   *  scores are benign; INSUFFICIENT if no score could be computed. */
  verdict: "INVESTIGATE" | "CLEAN" | "INSUFFICIENT";
  flags: string[];
  interpretation: string;
}

// Cutoffs (the documented academic thresholds).
const M_CUTOFF = -2.22; // Beneish: above this => manipulation risk
const Z_DISTRESS = 1.81;
const Z_SAFE = 2.99;
const ACCRUAL_FLAG = 0.25; // |Sloan accruals| above this => earnings-quality flag
const F_STRONG = 6;

/** num/den, null if either is missing/non-finite or den is 0. */
function ratio(num: number | undefined, den: number | undefined): number | null {
  if (num == null || den == null) return null;
  if (!Number.isFinite(num) || !Number.isFinite(den) || den === 0) return null;
  return num / den;
}

function present(...xs: Array<number | undefined>): boolean {
  return xs.every((x) => x != null && Number.isFinite(x));
}

// --- Beneish M-Score (current t + prior p) ---
function beneishM(t: ForensicYearInput, p: ForensicYearInput | undefined): number | null {
  if (!p) return null;
  // All eight components must be computable.
  const dsri = ratio(
    ratio(t.receivables, t.sales) ?? undefined,
    ratio(p.receivables, p.sales) ?? undefined,
  );
  const gmiNum = present(p.sales, p.cogs) ? (p.sales! - p.cogs!) / p.sales! : undefined;
  const gmiDen = present(t.sales, t.cogs) ? (t.sales! - t.cogs!) / t.sales! : undefined;
  const gmi = ratio(gmiNum, gmiDen);
  const aqiT = present(t.currentAssets, t.ppeNet, t.totalAssets)
    ? 1 - (t.currentAssets! + t.ppeNet!) / t.totalAssets!
    : undefined;
  const aqiP = present(p.currentAssets, p.ppeNet, p.totalAssets)
    ? 1 - (p.currentAssets! + p.ppeNet!) / p.totalAssets!
    : undefined;
  const aqi = ratio(aqiT, aqiP);
  const sgi = ratio(t.sales, p.sales);
  const depiP = present(p.depreciation, p.ppeNet)
    ? p.depreciation! / (p.depreciation! + p.ppeNet!)
    : undefined;
  const depiT = present(t.depreciation, t.ppeNet)
    ? t.depreciation! / (t.depreciation! + t.ppeNet!)
    : undefined;
  const depi = ratio(depiP, depiT);
  const sgai = ratio(ratio(t.sga, t.sales) ?? undefined, ratio(p.sga, p.sales) ?? undefined);
  const tata = present(t.netIncome, t.cfo, t.totalAssets)
    ? (t.netIncome! - t.cfo!) / t.totalAssets!
    : null;
  const lvgi = ratio(
    ratio(t.totalLiabilities, t.totalAssets) ?? undefined,
    ratio(p.totalLiabilities, p.totalAssets) ?? undefined,
  );

  if ([dsri, gmi, aqi, sgi, depi, sgai, tata, lvgi].some((x) => x == null)) return null;
  return (
    -4.84 +
    0.92 * dsri! +
    0.528 * gmi! +
    0.404 * aqi! +
    0.892 * sgi! +
    0.115 * depi! -
    0.172 * sgai! +
    4.679 * tata! -
    0.327 * lvgi!
  );
}

// --- Altman Z-Score (current only) ---
function altmanZ(t: ForensicYearInput): number | null {
  if (
    !present(
      t.currentAssets,
      t.currentLiabilities,
      t.totalAssets,
      t.retainedEarnings,
      t.ebit,
      t.marketCap,
      t.totalLiabilities,
      t.sales,
    )
  ) {
    return null;
  }
  const wc = t.currentAssets! - t.currentLiabilities!;
  return (
    1.2 * (wc / t.totalAssets!) +
    1.4 * (t.retainedEarnings! / t.totalAssets!) +
    3.3 * (t.ebit! / t.totalAssets!) +
    0.6 * (t.marketCap! / t.totalLiabilities!) +
    1.0 * (t.sales! / t.totalAssets!)
  );
}

// --- Piotroski F-Score (current t + prior p) ---
function piotroskiF(t: ForensicYearInput, p: ForensicYearInput | undefined): number | null {
  if (!p) return null;
  const need = (y: ForensicYearInput) =>
    present(
      y.netIncome,
      y.cfo,
      y.totalAssets,
      y.currentAssets,
      y.currentLiabilities,
      y.longTermDebt,
      y.sharesOutstanding,
      y.sales,
      y.cogs,
    );
  if (!need(t) || !need(p)) return null;

  let s = 0;
  s += t.netIncome! > 0 ? 1 : 0; // profitability
  s += t.cfo! > 0 ? 1 : 0; // operating cash flow
  s += t.netIncome! / t.totalAssets! > p.netIncome! / p.totalAssets! ? 1 : 0; // rising ROA
  s += t.cfo! > t.netIncome! ? 1 : 0; // cash beats accruals
  s += t.longTermDebt! < p.longTermDebt! ? 1 : 0; // deleveraging
  s += t.currentAssets! / t.currentLiabilities! > p.currentAssets! / p.currentLiabilities! ? 1 : 0; // liquidity up
  s += t.sharesOutstanding! <= p.sharesOutstanding! ? 1 : 0; // no dilution
  s += (t.sales! - t.cogs!) / t.sales! > (p.sales! - p.cogs!) / p.sales! ? 1 : 0; // gross margin up
  s += t.sales! / t.totalAssets! > p.sales! / p.totalAssets! ? 1 : 0; // asset turnover up
  return s;
}

// --- Sloan accruals ratio (current only) ---
function sloanAccruals(t: ForensicYearInput): number | null {
  if (!present(t.netIncome, t.cfo, t.totalAssets)) return null;
  return (t.netIncome! - t.cfo!) / t.totalAssets!;
}

export function computeForensicScores(input: ForensicInput): ForensicResult {
  const t = input.current;
  const p = input.prior;

  const m = beneishM(t, p);
  const z = altmanZ(t);
  const f = piotroskiF(t, p);
  const accr = sloanAccruals(t);

  const mFlag = m != null && m > M_CUTOFF;
  const zone: AltmanZone | null =
    z == null ? null : z < Z_DISTRESS ? "distress" : z > Z_SAFE ? "safe" : "grey";
  const accrFlag = accr != null && Math.abs(accr) > ACCRUAL_FLAG;
  const fFlag = f != null && f < F_STRONG;

  const flags: string[] = [];
  if (mFlag) flags.push(`Beneish M ${m!.toFixed(2)} > ${M_CUTOFF} — earnings-manipulation risk`);
  if (zone === "distress")
    flags.push(`Altman Z ${z!.toFixed(2)} < ${Z_DISTRESS} — financial-distress zone`);
  if (accrFlag)
    flags.push(`Sloan accruals ${(accr! * 100).toFixed(1)}% — earnings-quality red flag`);
  if (fFlag) flags.push(`Piotroski F ${f}/9 — not strengthening`);

  const anyComputed = m != null || z != null || f != null || accr != null;
  const verdict: ForensicResult["verdict"] = !anyComputed
    ? "INSUFFICIENT"
    : flags.length > 0
      ? "INVESTIGATE"
      : "CLEAN";

  const parts: string[] = [];
  if (m != null) parts.push(`M ${m.toFixed(2)}`);
  if (z != null) parts.push(`Z ${z.toFixed(2)} (${zone})`);
  if (f != null) parts.push(`F ${f}/9`);
  if (accr != null) parts.push(`accruals ${(accr * 100).toFixed(1)}%`);
  const interpretation = !anyComputed
    ? "Insufficient financial-statement data to compute any forensic score."
    : `${verdict}: ${parts.join(", ")}.` +
      (verdict === "INVESTIGATE" ? " Open the filing — probability flag, not proof." : "");

  return {
    beneishM: { score: m, flag: mFlag, cutoff: M_CUTOFF },
    altmanZ: { score: z, zone },
    piotroskiF: { score: f, max: 9 },
    sloanAccruals: { ratio: accr, flag: accrFlag },
    verdict,
    flags,
    interpretation,
  };
}
