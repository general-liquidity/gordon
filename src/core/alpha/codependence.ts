// Non-linear codependence measures for pair selection (alternatives to Pearson).
// Distance correlation (Székely) and mutual information detect non-linear dependence
// that Pearson misses (e.g. y = x^2 with x symmetric → pearson ≈ 0, dCor/MI > 0).

import { sampleCorrelation } from "../stats/index.ts";

export interface CodependenceResult {
  pearson: number;
  mutualInfo: number;
  normalizedMI: number;
  distanceCorr: number;
  sampleSize: number;
  interpretation: string;
}

const MAX_N = 1000;

function round4(v: number): number {
  return Number(v.toFixed(4));
}

function alignFinite(
  x: ReadonlyArray<number>,
  y: ReadonlyArray<number>,
): { xs: number[]; ys: number[] } {
  const n = Math.min(x.length, y.length);
  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = 0; i < n; i++) {
    const xi = x[i]!;
    const yi = y[i]!;
    if (Number.isFinite(xi) && Number.isFinite(yi)) {
      xs.push(xi);
      ys.push(yi);
    }
  }
  return { xs, ys };
}

// Cap at MAX_N by keeping the tail (most recent observations).
function capTail(xs: number[], ys: number[]): { xs: number[]; ys: number[] } {
  if (xs.length <= MAX_N) return { xs, ys };
  return { xs: xs.slice(xs.length - MAX_N), ys: ys.slice(ys.length - MAX_N) };
}

function pearson(xs: number[], ys: number[]): number {
  return sampleCorrelation(xs, ys);
}

function binIndex(v: number, lo: number, width: number, bins: number): number {
  if (width === 0) return 0;
  let idx = Math.floor((v - lo) / width);
  if (idx < 0) idx = 0;
  if (idx >= bins) idx = bins - 1;
  return idx;
}

// 2D-histogram mutual information (natural log) + normalized MI via marginal entropies.
function mutualInformation(
  xs: number[],
  ys: number[],
): { mi: number; nmi: number } {
  const n = xs.length;
  const bins = Math.max(2, Math.round(Math.sqrt(n / 3)));

  let xlo = Infinity;
  let xhi = -Infinity;
  let ylo = Infinity;
  let yhi = -Infinity;
  for (let i = 0; i < n; i++) {
    const xi = xs[i]!;
    const yi = ys[i]!;
    if (xi < xlo) xlo = xi;
    if (xi > xhi) xhi = xi;
    if (yi < ylo) ylo = yi;
    if (yi > yhi) yhi = yi;
  }

  const xWidth = (xhi - xlo) / bins;
  const yWidth = (yhi - ylo) / bins;

  const joint: number[] = new Array(bins * bins).fill(0);
  const px: number[] = new Array(bins).fill(0);
  const py: number[] = new Array(bins).fill(0);

  for (let i = 0; i < n; i++) {
    const bx = binIndex(xs[i]!, xlo, xWidth, bins);
    const by = binIndex(ys[i]!, ylo, yWidth, bins);
    joint[bx * bins + by]! += 1;
    px[bx]! += 1;
    py[by]! += 1;
  }

  let mi = 0;
  for (let bx = 0; bx < bins; bx++) {
    for (let by = 0; by < bins; by++) {
      const c = joint[bx * bins + by]!;
      if (c === 0) continue;
      const pij = c / n;
      const pi = px[bx]! / n;
      const pj = py[by]! / n;
      mi += pij * Math.log(pij / (pi * pj));
    }
  }
  if (mi < 0) mi = 0;

  let hx = 0;
  for (let bx = 0; bx < bins; bx++) {
    const pi = px[bx]! / n;
    if (pi > 0) hx -= pi * Math.log(pi);
  }
  let hy = 0;
  for (let by = 0; by < bins; by++) {
    const pj = py[by]! / n;
    if (pj > 0) hy -= pj * Math.log(pj);
  }

  const hmin = Math.min(hx, hy);
  let nmi = hmin > 0 ? mi / hmin : 0;
  if (nmi < 0) nmi = 0;
  if (nmi > 1) nmi = 1;

  return { mi, nmi };
}

// Distance correlation (Székely): double-centered pairwise distance matrices. O(n^2).
function distanceCorrelation(xs: number[], ys: number[]): number {
  const n = xs.length;

  const a: number[] = new Array(n * n);
  const b: number[] = new Array(n * n);
  const aRow: number[] = new Array(n).fill(0);
  const bRow: number[] = new Array(n).fill(0);
  let aGrand = 0;
  let bGrand = 0;

  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const av = Math.abs(xs[i]! - xs[j]!);
      const bv = Math.abs(ys[i]! - ys[j]!);
      a[i * n + j] = av;
      b[i * n + j] = bv;
      aRow[i]! += av;
      bRow[i]! += bv;
    }
  }
  for (let i = 0; i < n; i++) {
    aGrand += aRow[i]!;
    bGrand += bRow[i]!;
  }
  const aGrandMean = aGrand / (n * n);
  const bGrandMean = bGrand / (n * n);
  const aColMean: number[] = new Array(n);
  const bColMean: number[] = new Array(n);
  for (let i = 0; i < n; i++) {
    aColMean[i] = aRow[i]! / n; // symmetric matrix → row mean = col mean
    bColMean[i] = bRow[i]! / n;
  }
  const aRowMean = aColMean;
  const bRowMean = bColMean;

  let dCov2 = 0;
  let dVarX2 = 0;
  let dVarY2 = 0;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const A = a[i * n + j]! - aRowMean[i]! - aColMean[j]! + aGrandMean;
      const B = b[i * n + j]! - bRowMean[i]! - bColMean[j]! + bGrandMean;
      dCov2 += A * B;
      dVarX2 += A * A;
      dVarY2 += B * B;
    }
  }
  const total = n * n;
  dCov2 /= total;
  dVarX2 /= total;
  dVarY2 /= total;

  const denom = Math.sqrt(dVarX2 * dVarY2);
  if (denom <= 0) return 0;
  let dCor2 = dCov2 / denom;
  if (dCor2 < 0) dCor2 = 0;
  let dCor = Math.sqrt(dCor2);
  if (dCor > 1) dCor = 1;
  return dCor;
}

function interpret(
  pearsonV: number,
  nmi: number,
  dCor: number,
): string {
  const linear = Math.abs(pearsonV);
  if (dCor < 0.1 && nmi < 0.05) {
    return "Independent — no detectable linear or non-linear codependence.";
  }
  if (linear < 0.2 && (dCor > 0.3 || nmi > 0.1)) {
    return "Non-linear dependence: Pearson is near-zero but distance correlation / MI detect structure a linear pair-screen would miss.";
  }
  if (linear > 0.7 && dCor > 0.7) {
    return "Strong linear codependence across all measures.";
  }
  return "Moderate codependence — some shared structure, partly non-linear.";
}

function neutral(sampleSize: number): CodependenceResult {
  return {
    pearson: 0,
    mutualInfo: 0,
    normalizedMI: 0,
    distanceCorr: 0,
    sampleSize,
    interpretation: "Insufficient aligned data (<5 points) — codependence not estimated.",
  };
}

export function computeCodependence(input: {
  x: ReadonlyArray<number>;
  y: ReadonlyArray<number>;
}): CodependenceResult {
  const aligned = alignFinite(input.x, input.y);
  if (aligned.xs.length < 5) {
    return neutral(aligned.xs.length);
  }
  const { xs, ys } = capTail(aligned.xs, aligned.ys);
  const n = xs.length;

  const pearsonV = pearson(xs, ys);
  const { mi, nmi } = mutualInformation(xs, ys);
  const dCor = distanceCorrelation(xs, ys);

  return {
    pearson: round4(pearsonV),
    mutualInfo: round4(mi),
    normalizedMI: round4(nmi),
    distanceCorr: round4(dCor),
    sampleSize: n,
    interpretation: interpret(pearsonV, nmi, dCor),
  };
}

export function codependenceMatrix(
  seriesBySymbol: Record<string, ReadonlyArray<number>>,
): Array<{
  a: string;
  b: string;
  pearson: number;
  normalizedMI: number;
  distanceCorr: number;
}> {
  const symbols = Object.keys(seriesBySymbol);
  const rows: Array<{
    a: string;
    b: string;
    pearson: number;
    normalizedMI: number;
    distanceCorr: number;
  }> = [];

  for (let i = 0; i < symbols.length; i++) {
    for (let j = i + 1; j < symbols.length; j++) {
      const a = symbols[i]!;
      const b = symbols[j]!;
      const res = computeCodependence({
        x: seriesBySymbol[a]!,
        y: seriesBySymbol[b]!,
      });
      rows.push({
        a,
        b,
        pearson: res.pearson,
        normalizedMI: res.normalizedMI,
        distanceCorr: res.distanceCorr,
      });
    }
  }
  return rows;
}
