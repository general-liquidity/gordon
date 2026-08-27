// Bertram (2010) optimal entry/exit thresholds for a symmetric OU mean-reversion
// strategy with transaction cost, maximizing expected return per unit time.
// OU: dX = -theta(X - mu)dt + sigma dW. Equilibrium stdev sigma_eq = sigma/sqrt(2 theta).
// Dimensionless level a = (mu - entry)/sigma_eq. Enter at mu - a*sigma_eq, exit at mu.
// r(a) = (2 a sigma_eq - cost) / E[T(a)], where E[T] is the OU mean-first-passage time.

export interface OuThresholdResult {
  entryLong: number;
  exitLong: number;
  entryShort: number;
  exitShort: number;
  dimensionlessEntry: number;
  expectedReturnPerUnitTime: number;
  expectedCycleTime: number;
  interpretation: string;
}

// Lanczos approximation of the Gamma function.
const LANCZOS_G = 7;
const LANCZOS_COEF = [
  0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313,
  -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6,
  1.5056327351493116e-7,
];

function gamma(z: number): number {
  if (z < 0.5) {
    // Reflection formula for z < 0.5.
    return Math.PI / (Math.sin(Math.PI * z) * gamma(1 - z));
  }
  z -= 1;
  let x = LANCZOS_COEF[0]!;
  for (let i = 1; i < LANCZOS_G + 2; i++) {
    x += LANCZOS_COEF[i]! / (z + i);
  }
  const t = z + LANCZOS_G + 0.5;
  return Math.sqrt(2 * Math.PI) * t ** (z + 0.5) * Math.exp(-t) * x;
}

// Bertram series for the OU expected first-passage / cycle time (dimensionless,
// scaled by 1/theta). E[T(a)] = (1/(2 theta)) * sum_{k>=1} ((sqrt(2) a)^k / k!) * Gamma(k/2).
function expectedCycleTimeDimensionless(a: number, theta: number): number {
  const root2a = Math.SQRT2 * a;
  let sum = 0;
  let logFactorial = 0; // ln(k!) accumulated to avoid overflow
  for (let k = 1; k <= 40; k++) {
    logFactorial += Math.log(k);
    const term = Math.exp(k * Math.log(root2a) - logFactorial) * gamma(k / 2);
    sum += term;
  }
  return sum / (2 * theta);
}

export function computeOuOptimalThresholds(input: {
  theta: number;
  mu: number;
  sigma: number;
  transactionCost?: number;
}): OuThresholdResult {
  const { theta, mu, sigma } = input;
  const cost = input.transactionCost == null ? 0 : input.transactionCost;

  if (!(theta > 0) || !(sigma > 0)) {
    return {
      entryLong: Number(mu.toFixed(6)),
      exitLong: Number(mu.toFixed(6)),
      entryShort: Number(mu.toFixed(6)),
      exitShort: Number(mu.toFixed(6)),
      dimensionlessEntry: 0,
      expectedReturnPerUnitTime: 0,
      expectedCycleTime: 0,
      interpretation:
        "Neutral: theta and sigma must both be positive for a mean-reverting OU process.",
    };
  }

  const sigmaEq = sigma / Math.sqrt(2 * theta);

  // r(a) = (2 a sigma_eq - cost) / E[T(a)]. Maximize over a in (0.05, 4].
  const returnRate = (a: number): number => {
    const eT = expectedCycleTimeDimensionless(a, theta);
    if (!(eT > 0) || !Number.isFinite(eT)) return -Infinity;
    return (2 * a * sigmaEq - cost) / eT;
  };

  // Coarse grid scan to bracket the maximum, then golden-section refine.
  const lo = 0.05;
  const hi = 4;
  let bestA = lo;
  let bestR = returnRate(lo);
  const gridSteps = 400;
  for (let i = 1; i <= gridSteps; i++) {
    const a = lo + ((hi - lo) * i) / gridSteps;
    const r = returnRate(a);
    if (r > bestR) {
      bestR = r;
      bestA = a;
    }
  }

  // Golden-section refinement around the best grid point.
  const phi = (Math.sqrt(5) - 1) / 2;
  let gLo = Math.max(lo, bestA - (hi - lo) / gridSteps);
  let gHi = Math.min(hi, bestA + (hi - lo) / gridSteps);
  let x1 = gHi - phi * (gHi - gLo);
  let x2 = gLo + phi * (gHi - gLo);
  let f1 = returnRate(x1);
  let f2 = returnRate(x2);
  for (let iter = 0; iter < 100 && gHi - gLo > 1e-9; iter++) {
    if (f1 < f2) {
      gLo = x1;
      x1 = x2;
      f1 = f2;
      x2 = gLo + phi * (gHi - gLo);
      f2 = returnRate(x2);
    } else {
      gHi = x2;
      x2 = x1;
      f2 = f1;
      x1 = gHi - phi * (gHi - gLo);
      f1 = returnRate(x1);
    }
  }
  const a = (gLo + gHi) / 2;
  const r = returnRate(a);
  const cycleTime = expectedCycleTimeDimensionless(a, theta);

  const entryLong = mu - a * sigmaEq;
  const exitLong = mu;
  const entryShort = mu + a * sigmaEq;
  const exitShort = mu;

  const interpretation =
    `Bertram-optimal symmetric OU band: enter long at ${entryLong.toFixed(6)} ` +
    `(mu - ${a.toFixed(4)}*sigma_eq), exit at mu=${mu.toFixed(6)}; mirror short at ` +
    `${entryShort.toFixed(6)}. sigma_eq=${sigmaEq.toFixed(6)}. Expected return/unit time ` +
    `${r.toFixed(6)} over expected cycle ${cycleTime.toFixed(6)}.`;

  return {
    entryLong: Number(entryLong.toFixed(6)),
    exitLong: Number(exitLong.toFixed(6)),
    entryShort: Number(entryShort.toFixed(6)),
    exitShort: Number(exitShort.toFixed(6)),
    dimensionlessEntry: Number(a.toFixed(6)),
    expectedReturnPerUnitTime: Number(r.toFixed(6)),
    expectedCycleTime: Number(cycleTime.toFixed(6)),
    interpretation,
  };
}
