/**
 * DuPont ROE decomposition (3-way + 5-way) with log-additive driver
 * attribution.
 *
 * A flat ROE = NetIncome / Equity hides *why* a business earns its
 * return. DuPont factors it into operational drivers so two firms with
 * the same ROE can be told apart — one earning it on fat margins, the
 * other on thin margins and heavy leverage (a fragile ROE).
 *
 *   3-way:  ROE = NetMargin × AssetTurnover × EquityMultiplier
 *               = (NI/Rev) × (Rev/Assets) × (Assets/Equity)
 *
 *   5-way:  ROE = TaxBurden × InterestBurden × OperatingMargin
 *                 × AssetTurnover × EquityMultiplier
 *               = (NI/PreTax) × (PreTax/EBIT) × (EBIT/Rev)
 *                 × (Rev/Assets) × (Assets/Equity)
 *
 * The 5-way split isolates operating performance (operating margin ×
 * turnover) from financing/tax effects (tax & interest burden ×
 * leverage), which is the distinction that matters when judging ROE
 * quality. Distinct from the forensic-accounting scores (Beneish /
 * Altman / Piotroski / Sloan) — those flag manipulation / distress;
 * this attributes the return to its sources.
 *
 * Driver attribution: when every factor and ROE are strictly positive,
 * ln(ROE) = Σ ln(factor_i) is exact, so each factor's share of ln(ROE)
 * is a clean additive % attribution. When a factor is non-positive
 * (losses, negative equity) the log split is undefined; we report the
 * multiplicative factors and flag the attribution as not computable
 * rather than emit a misleading number.
 *
 * A self-consistency check recomputes ROE from the factors and reports
 * the drift against the directly-computed NI/Equity — a guard against
 * inconsistent statement inputs.
 */

export interface DupontInput {
  revenue: number;
  netIncome: number;
  /** Pre-tax income (EBT). Required for the 5-way tax/interest split. */
  pretaxIncome?: number;
  /** Operating income / EBIT. Required for the 5-way split. */
  ebit?: number;
  totalAssets: number;
  /** Shareholders' equity (book). */
  equity: number;
}

export interface DupontFactor {
  name: string;
  value: number;
  /** % of ln(ROE) attributable to this factor; null when the log split is undefined. */
  contributionPct: number | null;
}

export interface DupontResult {
  reportedRoe: number | null;
  threeWay: {
    netMargin: number;
    assetTurnover: number;
    equityMultiplier: number;
    reconstructedRoe: number;
  } | null;
  fiveWay: {
    taxBurden: number;
    interestBurden: number;
    operatingMargin: number;
    assetTurnover: number;
    equityMultiplier: number;
    reconstructedRoe: number;
  } | null;
  /** Per-factor log-attribution over the 5-way factors (or 3-way if 5-way inputs absent). */
  drivers: DupontFactor[];
  /** |reconstructed − reported| / |reported|, the input-consistency drift. */
  reconstructionError: number | null;
  interpretation: string;
}

function round(x: number, n = 6): number {
  return Number(x.toFixed(n));
}

function safe(num: number, den: number): number | null {
  if (!Number.isFinite(num) || !Number.isFinite(den) || den === 0) return null;
  return num / den;
}

function neutral(why: string): DupontResult {
  return {
    reportedRoe: null,
    threeWay: null,
    fiveWay: null,
    drivers: [],
    reconstructionError: null,
    interpretation: `Neutral — ${why}.`,
  };
}

export function computeDupont(input: DupontInput): DupontResult {
  const { revenue, netIncome, totalAssets, equity } = input;

  if (![revenue, netIncome, totalAssets, equity].every((x) => Number.isFinite(x))) {
    return neutral("non-finite input");
  }
  if (revenue === 0 || totalAssets === 0 || equity === 0) {
    return neutral("revenue, assets and equity must be non-zero");
  }

  const reportedRoe = safe(netIncome, equity);

  const netMargin = netIncome / revenue;
  const assetTurnover = revenue / totalAssets;
  const equityMultiplier = totalAssets / equity;
  const threeWay = {
    netMargin: round(netMargin),
    assetTurnover: round(assetTurnover),
    equityMultiplier: round(equityMultiplier),
    reconstructedRoe: round(netMargin * assetTurnover * equityMultiplier),
  };

  // 5-way needs pretaxIncome and EBIT (both non-zero to split cleanly).
  const { pretaxIncome, ebit } = input;
  let fiveWay: DupontResult["fiveWay"] = null;
  let factorPairs: Array<{ name: string; value: number }>;

  if (
    pretaxIncome != null &&
    ebit != null &&
    Number.isFinite(pretaxIncome) &&
    Number.isFinite(ebit) &&
    pretaxIncome !== 0 &&
    ebit !== 0
  ) {
    const taxBurden = netIncome / pretaxIncome;
    const interestBurden = pretaxIncome / ebit;
    const operatingMargin = ebit / revenue;
    fiveWay = {
      taxBurden: round(taxBurden),
      interestBurden: round(interestBurden),
      operatingMargin: round(operatingMargin),
      assetTurnover: round(assetTurnover),
      equityMultiplier: round(equityMultiplier),
      reconstructedRoe: round(
        taxBurden * interestBurden * operatingMargin * assetTurnover * equityMultiplier,
      ),
    };
    factorPairs = [
      { name: "taxBurden", value: taxBurden },
      { name: "interestBurden", value: interestBurden },
      { name: "operatingMargin", value: operatingMargin },
      { name: "assetTurnover", value: assetTurnover },
      { name: "equityMultiplier", value: equityMultiplier },
    ];
  } else {
    factorPairs = [
      { name: "netMargin", value: netMargin },
      { name: "assetTurnover", value: assetTurnover },
      { name: "equityMultiplier", value: equityMultiplier },
    ];
  }

  // Log-additive attribution: exact only when ROE and every factor > 0.
  const reconstructedRoe = factorPairs.reduce((p, f) => p * f.value, 1);
  const logComputable = reconstructedRoe > 0 && factorPairs.every((f) => f.value > 0);
  const lnRoe = logComputable ? Math.log(reconstructedRoe) : NaN;

  const drivers: DupontFactor[] = factorPairs.map((f) => ({
    name: f.name,
    value: round(f.value),
    contributionPct:
      logComputable && Math.abs(lnRoe) > 1e-12 ? round((Math.log(f.value) / lnRoe) * 100, 2) : null,
  }));

  const reconstructionError =
    reportedRoe != null && reportedRoe !== 0
      ? round(Math.abs(reconstructedRoe - reportedRoe) / Math.abs(reportedRoe), 6)
      : null;

  let interpretation: string;
  if (reportedRoe == null) {
    interpretation = "ROE undefined (zero equity).";
  } else if (reportedRoe < 0) {
    interpretation =
      `ROE ${(reportedRoe * 100).toFixed(1)}% (negative — loss or negative equity); ` +
      `factor attribution not meaningful. Leverage ${equityMultiplier.toFixed(2)}×.`;
  } else if (logComputable) {
    const ranked = [...drivers].sort((a, b) => (b.contributionPct ?? 0) - (a.contributionPct ?? 0));
    const top = ranked[0]!;
    const drag = ranked[ranked.length - 1]!;
    const leverageNote =
      equityMultiplier > 3
        ? ` Leverage-heavy (equity multiplier ${equityMultiplier.toFixed(2)}×) — ROE quality depends on debt sustainability.`
        : "";
    interpretation =
      `ROE ${(reportedRoe * 100).toFixed(1)}%. Dominant driver: ${top.name} ` +
      `(${top.contributionPct}% of ln-ROE); weakest: ${drag.name} (${drag.contributionPct}%).${leverageNote}`;
  } else {
    interpretation =
      `ROE ${(reportedRoe * 100).toFixed(1)}%. Log-attribution undefined (a factor ≤ 0); ` +
      `factors reported directly. Leverage ${equityMultiplier.toFixed(2)}×.`;
  }

  return {
    reportedRoe: reportedRoe == null ? null : round(reportedRoe),
    threeWay,
    fiveWay,
    drivers,
    reconstructionError,
    interpretation,
  };
}
