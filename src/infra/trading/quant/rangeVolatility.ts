/**
 * Range-Based Volatility Estimators (GORDON_RANGE_VOLATILITY).
 *
 * Three OHLC-based estimators that are more efficient than close-to-close:
 *
 *   Parkinson (1980):    σ² = (1 / (4 ln 2)) · (1/N) · Σ (ln(H/L))²
 *     Range-only — uses High and Low. Assumes continuous price path,
 *     zero drift, no opening jumps. Best for instruments that trade
 *     24/7 with no overnight gaps (crypto).
 *
 *   Garman-Klass (1980): σ² = (1/N) · Σ [0.5·(ln(H/L))² − (2 ln 2 − 1)·(ln(C/O))²]
 *     Uses High, Low, Open, Close. Roughly 7× more efficient than the
 *     close-to-close estimator. Same continuous-path assumption.
 *
 *   Yang-Zhang (2000):   σ²_YZ = σ²_o + k·σ²_c + (1−k)·σ²_rs
 *     where σ²_o = sample variance of overnight log returns ln(O_t/C_{t−1});
 *     σ²_c = sample variance of open-to-close log returns ln(C_t/O_t);
 *     σ²_rs = Rogers-Satchell estimator (1/N)·Σ[ln(H/C)·ln(H/O)+ln(L/C)·ln(L/O)];
 *     k = 0.34 / (1.34 + (N+1)/(N−1)) minimizes total estimator variance.
 *
 *     Port of Yang, D. & Zhang, Q. (2000), "Drift-Independent Volatility
 *     Estimation Based on High, Low, Open, and Close Prices",
 *     Journal of Business 73(3), 477-492.
 *
 *     Properties:
 *       (a) drift-independent — unlike Garman-Klass which assumes zero drift
 *       (b) handles opening price jumps — Garman-Klass collapses on gaps
 *       (c) minimum-variance among similar estimators
 *
 *     Requires N+1 bars (uses bars[0].close as the close-anchor for the
 *     first overnight return; estimator runs over bars[1..N]). NaN when
 *     fewer than 3 bars are available.
 *
 * Annualization: multiply by `periodsPerYear` (e.g. 252 for daily equity,
 * 365 for daily crypto, 24 for hourly). Output is annualized standard
 * deviation in the same units as ln(price), i.e. a number to interpret
 * as a fraction (0.30 → 30% annualized vol).
 *
 * Trading-domain use: short-window vol regime detection where close-only
 * estimators are too noisy. Composes with WW3 volatilityDrag (Kelly-vol
 * coupling), KF2 kalmanVolatility (time-varying state-space estimator —
 * range estimators are more efficient at short samples but lack the
 * filtering structure), and the regime detector. For equity markets with
 * overnight gaps, prefer Yang-Zhang over Garman-Klass.
 */

export interface OhlcBar {
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface RangeVolatilityInput {
  bars: ReadonlyArray<OhlcBar>;
  /** Periods per year (252 daily equity, 365 daily crypto, 24 hourly, 24*365 hourly crypto). Default 365. */
  periodsPerYear?: number;
}

export interface RangeVolatilityResult {
  parkinsonAnnualized: number;
  garmanKlassAnnualized: number;
  /** Yang-Zhang (2000) annualized. NaN if <3 bars (estimator needs prior close). */
  yangZhangAnnualized: number;
  /** Close-to-close annualized for reference. NaN if <2 bars. */
  closeToCloseAnnualized: number;
  sampleSize: number;
  /** Ratio of close-to-close variance to Garman-Klass variance — efficiency gain. */
  efficiencyGain: number;
  reasoning: string;
}

const PARKINSON_COEFFICIENT = 1 / (4 * Math.log(2));
const GK_C_COEFFICIENT = 2 * Math.log(2) - 1;
const DEFAULT_PERIODS_PER_YEAR = 365;

function isValidBar(b: OhlcBar): boolean {
  return (
    Number.isFinite(b.open) &&
    Number.isFinite(b.high) &&
    Number.isFinite(b.low) &&
    Number.isFinite(b.close) &&
    b.open > 0 &&
    b.high > 0 &&
    b.low > 0 &&
    b.close > 0 &&
    b.high >= b.low
  );
}

function parkinsonVariance(bars: ReadonlyArray<OhlcBar>): number {
  let sum = 0;
  let n = 0;
  for (const b of bars) {
    if (!isValidBar(b)) continue;
    const lnHL = Math.log(b.high / b.low);
    sum += lnHL * lnHL;
    n++;
  }
  if (n === 0) return 0;
  return PARKINSON_COEFFICIENT * (sum / n);
}

function garmanKlassVariance(bars: ReadonlyArray<OhlcBar>): number {
  let sum = 0;
  let n = 0;
  for (const b of bars) {
    if (!isValidBar(b)) continue;
    const lnHL = Math.log(b.high / b.low);
    const lnCO = Math.log(b.close / b.open);
    sum += 0.5 * lnHL * lnHL - GK_C_COEFFICIENT * lnCO * lnCO;
    n++;
  }
  if (n === 0) return 0;
  return Math.max(0, sum / n);
}

/**
 * Yang-Zhang (2000) drift-independent OHLC volatility variance.
 *
 * Requires bars[0..N] where bars[0] supplies the close anchor for the
 * first overnight return. Returns NaN when fewer than 3 valid bars or
 * when the post-anchor sample is too small to compute sample variances.
 */
function yangZhangVariance(bars: ReadonlyArray<OhlcBar>): number {
  if (bars.length < 3) return Number.NaN;

  const overnight: number[] = []; // ln(O_t / C_{t-1})
  const openToClose: number[] = []; // ln(C_t / O_t)
  let rsSum = 0;
  let rsCount = 0;

  for (let i = 1; i < bars.length; i++) {
    const prev = bars[i - 1]!;
    const curr = bars[i]!;
    if (!isValidBar(prev) || !isValidBar(curr)) continue;

    overnight.push(Math.log(curr.open / prev.close));
    openToClose.push(Math.log(curr.close / curr.open));

    const lnHC = Math.log(curr.high / curr.close);
    const lnHO = Math.log(curr.high / curr.open);
    const lnLC = Math.log(curr.low / curr.close);
    const lnLO = Math.log(curr.low / curr.open);
    rsSum += lnHC * lnHO + lnLC * lnLO;
    rsCount++;
  }

  const N = overnight.length;
  if (N < 2 || rsCount < 1) return Number.NaN;

  const sampleVar = (xs: number[]): number => {
    const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
    let ss = 0;
    for (const x of xs) ss += (x - mean) * (x - mean);
    return ss / (xs.length - 1);
  };

  const sigmaO2 = sampleVar(overnight);
  const sigmaC2 = sampleVar(openToClose);
  const sigmaRS2 = rsSum / rsCount;

  // k tuned to minimize total estimator variance (Yang-Zhang eq. 6).
  // For N >= 2 this is always in (0, 1).
  const k = 0.34 / (1.34 + (N + 1) / (N - 1));

  const variance = sigmaO2 + k * sigmaC2 + (1 - k) * sigmaRS2;
  return Math.max(0, variance);
}

function closeToCloseVariance(bars: ReadonlyArray<OhlcBar>): number {
  const rets: number[] = [];
  for (let i = 1; i < bars.length; i++) {
    const prev = bars[i - 1]!;
    const curr = bars[i]!;
    if (!isValidBar(prev) || !isValidBar(curr)) continue;
    rets.push(Math.log(curr.close / prev.close));
  }
  if (rets.length < 2) return Number.NaN;
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
  let ss = 0;
  for (const r of rets) ss += (r - mean) * (r - mean);
  return ss / (rets.length - 1);
}

export function computeRangeVolatility(input: RangeVolatilityInput): RangeVolatilityResult {
  const ppy = input.periodsPerYear ?? DEFAULT_PERIODS_PER_YEAR;
  const validBars = input.bars.filter(isValidBar);
  const n = validBars.length;

  if (n === 0) {
    return {
      parkinsonAnnualized: 0,
      garmanKlassAnnualized: 0,
      yangZhangAnnualized: Number.NaN,
      closeToCloseAnnualized: Number.NaN,
      sampleSize: 0,
      efficiencyGain: Number.NaN,
      reasoning: "no valid OHLC bars",
    };
  }

  const parkVar = parkinsonVariance(validBars);
  const gkVar = garmanKlassVariance(validBars);
  const yzVar = yangZhangVariance(validBars);
  const ccVar = closeToCloseVariance(validBars);

  const parkAnn = Math.sqrt(parkVar * ppy);
  const gkAnn = Math.sqrt(gkVar * ppy);
  const yzAnn = Number.isFinite(yzVar) ? Math.sqrt(yzVar * ppy) : Number.NaN;
  const ccAnn = Number.isFinite(ccVar) ? Math.sqrt(ccVar * ppy) : Number.NaN;
  const efficiencyGain = Number.isFinite(ccVar) && gkVar > 0 ? ccVar / gkVar : Number.NaN;

  const reasoning =
    n < 10
      ? `small sample (${n} bars) — range estimators have a relative advantage here, but the absolute estimate is noisy`
      : `${n} bars: parkinson ${(parkAnn * 100).toFixed(1)}%, garman-klass ${(gkAnn * 100).toFixed(1)}%, yang-zhang ${Number.isFinite(yzAnn) ? (yzAnn * 100).toFixed(1) + "%" : "n/a"}, close-to-close ${Number.isFinite(ccAnn) ? (ccAnn * 100).toFixed(1) + "%" : "n/a"}${Number.isFinite(efficiencyGain) ? `; GK is ${efficiencyGain.toFixed(1)}× more efficient than CC` : ""}`;

  return {
    parkinsonAnnualized: parkAnn,
    garmanKlassAnnualized: gkAnn,
    yangZhangAnnualized: yzAnn,
    closeToCloseAnnualized: ccAnn,
    sampleSize: n,
    efficiencyGain,
    reasoning,
  };
}

export function rangeVolatilityToPayload(result: RangeVolatilityResult): Record<string, unknown> {
  return {
    kind: "range_volatility.computed",
    parkinson: Number(result.parkinsonAnnualized.toFixed(5)),
    garmanKlass: Number(result.garmanKlassAnnualized.toFixed(5)),
    yangZhang: Number.isFinite(result.yangZhangAnnualized)
      ? Number(result.yangZhangAnnualized.toFixed(5))
      : null,
    closeToClose: Number.isFinite(result.closeToCloseAnnualized)
      ? Number(result.closeToCloseAnnualized.toFixed(5))
      : null,
    sampleSize: result.sampleSize,
    efficiencyGain: Number.isFinite(result.efficiencyGain)
      ? Number(result.efficiencyGain.toFixed(3))
      : null,
  };
}
