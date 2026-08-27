/**
 * Eigenportfolio residual s-scores following Avellaneda and Lee (2010).
 */
import { computeCovarianceMatrix, eigenDecomposition, invert, multiplyVector } from "./matrix.ts";

export interface ResidualSScore {
  asset: number;
  score: number;
  residual: number;
  meanReverting: boolean;
  signal: "long" | "short" | "exit" | "hold";
}

function fitResidualOuScore(innovations: number[]): {
  score: number;
  residual: number;
  meanReverting: boolean;
} {
  const path: number[] = [];
  let cumulative = 0;
  for (const innovation of innovations) {
    cumulative += innovation;
    path.push(cumulative);
  }
  const residual = path.at(-1) ?? 0;
  if (path.length < 3) return { score: 0, residual, meanReverting: false };

  const previous = path.slice(0, -1);
  const next = path.slice(1);
  const meanPrevious = previous.reduce((sum, value) => sum + value, 0) / previous.length;
  const meanNext = next.reduce((sum, value) => sum + value, 0) / next.length;
  let denominator = 0;
  let numerator = 0;
  for (let i = 0; i < previous.length; i++) {
    const centeredPrevious = previous[i]! - meanPrevious;
    denominator += centeredPrevious ** 2;
    numerator += centeredPrevious * (next[i]! - meanNext);
  }
  if (denominator <= Number.EPSILON) {
    return { score: 0, residual, meanReverting: false };
  }

  const beta = numerator / denominator;
  if (!(beta > 0 && beta < 1)) {
    return { score: 0, residual, meanReverting: false };
  }
  const intercept = meanNext - beta * meanPrevious;
  const equilibriumMean = intercept / (1 - beta);
  let squaredError = 0;
  for (let i = 0; i < previous.length; i++) {
    const error = next[i]! - intercept - beta * previous[i]!;
    squaredError += error ** 2;
  }
  const innovationVariance = squaredError / Math.max(1, previous.length - 2);
  const equilibriumVariance = innovationVariance / (1 - beta ** 2);
  const score =
    equilibriumVariance > Number.EPSILON
      ? (residual - equilibriumMean) / Math.sqrt(equilibriumVariance)
      : 0;
  return {
    score: Number.isFinite(score) ? score : 0,
    residual,
    meanReverting: true,
  };
}

export function computeResidualSScores(
  returns: number[][],
  topK = 1,
  entry = 2,
  exit = 0.5,
): ResidualSScore[] {
  const covariance = computeCovarianceMatrix(returns);
  if (!covariance || returns.length === 0) return [];
  const t = returns[0]!.length;
  if (t < 3) return [];
  const decomposition = eigenDecomposition(covariance);
  if (!decomposition) return [];
  const order = decomposition.eigenvalues
    .map((value, index) => ({ value, index }))
    .sort((a, b) => b.value - a.value)
    .slice(0, Math.max(1, Math.min(topK, Math.max(1, returns.length - 1))));
  const factors = order.map(({ index }) =>
    Array.from({ length: t }, (_, time) => {
      let value = 0;
      for (let asset = 0; asset < returns.length; asset++) {
        value += decomposition.eigenvectors[asset]![index]! * returns[asset]![time]!;
      }
      return value;
    }),
  );
  const gram = factors.map((left) =>
    factors.map((right) => left.reduce((sum, value, i) => sum + value * right[i]!, 0)),
  );
  const gramInverse = invert(gram);
  if (!gramInverse) return [];

  return returns.map((series, asset) => {
    const cross = factors.map((factor) =>
      factor.reduce((sum, value, i) => sum + value * series[i]!, 0),
    );
    const beta = multiplyVector(gramInverse, cross);
    const residuals = series.map((value, time) => {
      let fitted = 0;
      for (let k = 0; k < factors.length; k++) fitted += beta[k]! * factors[k]![time]!;
      return value - fitted;
    });
    const { score, residual, meanReverting } = fitResidualOuScore(residuals);
    const signal =
      score <= -entry
        ? "long"
        : score >= entry
          ? "short"
          : Math.abs(score) <= exit
            ? "exit"
            : "hold";
    return { asset, score, residual, meanReverting, signal };
  });
}

export function computeResidualSScore(
  returns: number[][],
  asset: number,
  topK = 1,
): ResidualSScore | null {
  return computeResidualSScores(returns, topK).find((result) => result.asset === asset) ?? null;
}
