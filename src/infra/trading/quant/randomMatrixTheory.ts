/**
 * Random-matrix covariance denoising after Laloux et al. (1999).
 */
import { eigenDecomposition } from "../../../core/alpha/matrix.ts";

export interface MarchenkoPasturBand {
  lower: number;
  upper: number;
}

export function marchenkoPasturBand(q: number, sigma2 = 1): MarchenkoPasturBand {
  if (!(q > 0) || !(sigma2 >= 0)) throw new Error("q must be positive and sigma2 non-negative");
  const root = Math.sqrt(1 / q);
  return {
    lower: sigma2 * (1 - root) ** 2,
    upper: sigma2 * (1 + root) ** 2,
  };
}

export function countSignificantFactors(
  eigenvalues: readonly number[],
  q: number,
  sigma2 = 1,
): number {
  const { upper } = marchenkoPasturBand(q, sigma2);
  return eigenvalues.filter((value) => value > upper).length;
}

export function denoiseCovariance(covariance: number[][], observations: number): number[][] {
  const n = covariance.length;
  if (n === 0) return [];
  if (observations <= 0 || covariance.some((row) => row.length !== n)) {
    throw new Error("covariance must be square and observations positive");
  }
  const decomposition = eigenDecomposition(covariance);
  if (!decomposition) return [];
  const q = observations / n;
  const sigma2 = decomposition.eigenvalues.reduce((sum, value) => sum + value, 0) / n;
  const band = marchenkoPasturBand(q, sigma2);
  const noisy = decomposition.eigenvalues.filter((value) => value >= band.lower && value <= band.upper);
  const replacement = noisy.length
    ? noisy.reduce((sum, value) => sum + value, 0) / noisy.length
    : sigma2;
  const values = decomposition.eigenvalues.map((value) =>
    value >= band.lower && value <= band.upper ? replacement : value,
  );
  const vectors = decomposition.eigenvectors;
  return Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => {
      let value = 0;
      for (let k = 0; k < n; k++) value += vectors[i]![k]! * values[k]! * vectors[j]![k]!;
      return value;
    }),
  );
}
