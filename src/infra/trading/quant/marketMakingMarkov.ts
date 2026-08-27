// 3-state market-making Markov-chain quote-efficiency metrics.
// Port of the performance model in Fushimi / González Rojas / Herman,
// "Optimal High-Frequency Market Making".
//
// States:
//   0 = Quoting  (both bid + ask resting in the book)
//   1 = Waiting  (one side filled, awaiting the other)
//   2 = Spread   (both sides filled → spread captured)
//
// P is the 3×3 transition matrix, P[i][j] = Prob(state i → state j).
// After capturing the spread the maker always requotes, so the paper fixes
// the absorbing-into-restart row: P[2][0] = 1, P[2][1] = P[2][2] = 0.
//
// Quote-efficiency metrics over a waiting horizon W (default 5):
//
//   pMakeSpread  = P[0][2] + P[0][1] · Σ_{n=0..W} ( P[1][1]^n · P[1][2] )
//     "both sides fill immediately (0→2), OR one side fills (0→1) then the
//      other side fills (1→2) within W consecutive waits."
//
//   pOneSideFill = P[0][1] · P[1][1]^W · P[1][0]
//     "one side fills (0→1), stays unfilled through W consecutive waits
//      (P[1][1]^W), then the outstanding order is cancelled (1→0) — the
//      inventory-risk path."
//
// Closed-form scalar math; no matrix library required.

export interface MmMarkovResult {
  transitionMatrix: number[][];
  pMakeSpread: number;
  pOneSideFill: number;
  waitingPeriods: number;
  sampleSize: number;
  interpretation: string;
}

const DEFAULT_WAITING_PERIODS = 5;
const ROW_SUM_TOLERANCE = 1e-6;

function neutral(waitingPeriods: number, note: string): MmMarkovResult {
  return {
    transitionMatrix: [
      [0, 0, 0],
      [0, 0, 0],
      [0, 0, 0],
    ],
    pMakeSpread: 0,
    pOneSideFill: 0,
    waitingPeriods,
    sampleSize: 0,
    interpretation: note,
  };
}

function isValidMatrix(m: number[][]): boolean {
  if (m.length !== 3) return false;
  for (let i = 0; i < 3; i++) {
    const row = m[i]!;
    if (row.length !== 3) return false;
    let sum = 0;
    for (let j = 0; j < 3; j++) {
      const v = row[j]!;
      if (typeof v !== "number" || !Number.isFinite(v) || v < 0) return false;
      sum += v;
    }
    if (Math.abs(sum - 1) > ROW_SUM_TOLERANCE) return false;
  }
  return true;
}

// Row-normalize transition counts. Rows with zero outgoing → identity row.
function estimateFromStates(states: ReadonlyArray<number>): number[][] | null {
  const valid = states.filter((s) => s === 0 || s === 1 || s === 2);
  if (valid.length < 2) return null;

  const counts: number[][] = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  for (let k = 0; k < valid.length - 1; k++) {
    const from = valid[k]!;
    const to = valid[k + 1]!;
    counts[from]![to] = counts[from]![to]! + 1;
  }

  const matrix: number[][] = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  for (let i = 0; i < 3; i++) {
    const row = counts[i]!;
    const total = row[0]! + row[1]! + row[2]!;
    if (total === 0) {
      matrix[i]![i] = 1;
    } else {
      for (let j = 0; j < 3; j++) {
        matrix[i]![j] = row[j]! / total;
      }
    }
  }
  return matrix;
}

export function computeMarketMakingMarkov(input: {
  transitionMatrix?: number[][];
  states?: ReadonlyArray<0 | 1 | 2 | number>;
  waitingPeriods?: number;
}): MmMarkovResult {
  const wRaw = input.waitingPeriods;
  const waitingPeriods =
    wRaw == null || !Number.isFinite(wRaw) || wRaw < 0 ? DEFAULT_WAITING_PERIODS : Math.floor(wRaw);

  let matrix: number[][] | null = null;
  let sampleSize = 0;

  if (input.transitionMatrix != null) {
    matrix = input.transitionMatrix;
    if (!isValidMatrix(matrix)) {
      return neutral(
        waitingPeriods,
        "Invalid transition matrix (must be 3×3 with rows summing to 1).",
      );
    }
  } else if (input.states != null) {
    const estimated = estimateFromStates(input.states);
    if (estimated == null) {
      return neutral(
        waitingPeriods,
        "Insufficient state data (need ≥2 states in {0,1,2}) to estimate transitions.",
      );
    }
    matrix = estimated;
    sampleSize = input.states.filter((s) => s === 0 || s === 1 || s === 2).length;
  } else {
    return neutral(waitingPeriods, "No input: provide either transitionMatrix or states.");
  }

  const P = matrix;
  const p01 = P[0]![1]!;
  const p02 = P[0]![2]!;
  const p10 = P[1]![0]!;
  const p11 = P[1]![1]!;
  const p12 = P[1]![2]!;

  // Σ_{n=0..W} P[1][1]^n · P[1][2]
  let waitFillSum = 0;
  for (let n = 0; n <= waitingPeriods; n++) {
    waitFillSum += p11 ** n * p12;
  }

  const pMakeSpread = p02 + p01 * waitFillSum;
  const pOneSideFill = p01 * p11 ** waitingPeriods * p10;

  const roundedMatrix = P.map((row) => row.map((v) => Number(v.toFixed(6))));
  const make = Number(pMakeSpread.toFixed(6));
  const one = Number(pOneSideFill.toFixed(6));

  const interpretation =
    `Over W=${waitingPeriods} waits: P(capture spread)=${make.toFixed(4)}, ` +
    `P(one-side-fill→cancel / inventory risk)=${one.toFixed(4)}. ` +
    (make >= 0.5
      ? "Quotes are efficient — spread capture dominates."
      : "Low capture probability — quotes frequently fail to complete the round-trip.");

  return {
    transitionMatrix: roundedMatrix,
    pMakeSpread: make,
    pOneSideFill: one,
    waitingPeriods,
    sampleSize,
    interpretation,
  };
}
