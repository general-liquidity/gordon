export interface ScenarioRealism {
  excessKurtosis: number;
  absoluteReturnAutocorrelation: number;
  leverageCorrelation: number;
  fatTails: boolean;
  volatilityClustering: boolean;
  leverageEffect: boolean;
  realistic: boolean;
}

function correlation(left: number[], right: number[]): number {
  const n = Math.min(left.length, right.length);
  if (n < 2) return 0;
  const meanLeft = left.slice(0, n).reduce((sum, value) => sum + value, 0) / n;
  const meanRight = right.slice(0, n).reduce((sum, value) => sum + value, 0) / n;
  let covariance = 0;
  let leftVariance = 0;
  let rightVariance = 0;
  for (let i = 0; i < n; i++) {
    const a = left[i]! - meanLeft;
    const b = right[i]! - meanRight;
    covariance += a * b;
    leftVariance += a * a;
    rightVariance += b * b;
  }
  return leftVariance > 0 && rightVariance > 0
    ? covariance / Math.sqrt(leftVariance * rightVariance)
    : 0;
}

export function validateScenarioRealism(returns: number[]): ScenarioRealism {
  if (returns.length < 4 || returns.some((value) => !Number.isFinite(value))) {
    return {
      excessKurtosis: 0,
      absoluteReturnAutocorrelation: 0,
      leverageCorrelation: 0,
      fatTails: false,
      volatilityClustering: false,
      leverageEffect: false,
      realistic: false,
    };
  }
  const mean = returns.reduce((sum, value) => sum + value, 0) / returns.length;
  const centered = returns.map((value) => value - mean);
  const variance = centered.reduce((sum, value) => sum + value ** 2, 0) / returns.length;
  const fourth = centered.reduce((sum, value) => sum + value ** 4, 0) / returns.length;
  const excessKurtosis = variance > 0 ? fourth / variance ** 2 - 3 : 0;
  const absolute = returns.map(Math.abs);
  const absoluteReturnAutocorrelation = correlation(absolute.slice(0, -1), absolute.slice(1));
  const futureVariance = returns.slice(1).map((value) => value ** 2);
  const leverageCorrelation = correlation(returns.slice(0, -1), futureVariance);
  const fatTails = excessKurtosis > 0;
  const volatilityClustering = absoluteReturnAutocorrelation > 0.05;
  const leverageEffect = leverageCorrelation < -0.05;
  return {
    excessKurtosis,
    absoluteReturnAutocorrelation,
    leverageCorrelation,
    fatTails,
    volatilityClustering,
    leverageEffect,
    realistic: fatTails && volatilityClustering && leverageEffect,
  };
}
