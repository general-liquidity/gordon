/**
 * Signal half-life under algorithmic crowding.
 *
 * NOT the same thing as `src/backtest/analysis/alpha-decay.ts`. That module measures
 * EXECUTION-DELAY decay: how much of a backtested result survives if the order is sent
 * 1, 5, 15 or 60 minutes late. It answers "how fast must I be?". This module measures
 * SIGNAL LIFESPAN: how many MONTHS a signal keeps paying once other participants adopt
 * the same idea. It answers "how long is this edge worth trading at all?". The two are
 * independent: a signal can be latency-insensitive and still be dead in a year.
 *
 * Model, from "AI-Driven Alpha Decay: Algorithmic Homogenization, Reflexive Signal
 * Erosion, and the Paradox of Intelligent Markets" (Meng and Chen, 2026):
 *
 *   h(phi) = ln(2) / [theta + delta(phi)]
 *   delta(phi) = N * phi * rho * a / lambda(phi)
 *
 * theta is the signal's own mean-reversion rate, phi the AI-adoption share, rho the
 * correlation of strategies across adopters, N the count of competing adopters, a an
 * attention/capital intensity term, lambda(phi) the depth absorbing the crowding.
 *
 * PROVENANCE, READ BEFORE CITING ANY NUMBER FROM THIS FILE.
 * The half-lives here are DERIVED FROM THE MODEL, not measured out of sample. The
 * paper's empirical leg calibrates portfolio convergence against SEC Form 13F filings
 * (99.5 million holdings, 2013-2024) and reports a 42% rise in convergence over that
 * sample. That convergence measurement is real. The hedge-fund return dynamics and the
 * 2010 Flash Crash fragility result are SIMULATED, not observed. So the "~18 months at
 * phi = 0.7, rho = 0.6 versus 5-7 years pre-AI" figure is a modelling output with one
 * calibrated input, not a measured decay curve. Do not cite 18 months as an empirical
 * fact, and do not quietly drop the caveat when this feeds a user-facing answer.
 *
 * Why Gordon carries this: strategy proposal and backtesting here otherwise assume an
 * edge measured on history persists at full strength forever. This module makes that
 * assumption an explicit, falsifiable parameter set the operator can argue with.
 */

/**
 * Every field is caller-supplied and unit-bearing. Rates are per MONTH, matching the
 * timescale the paper reports half-lives on.
 */
export interface SignalHalfLifeConfig {
  /** theta: monthly mean-reversion rate the signal would decay at with no adoption. */
  readonly naturalDecayRate: number;
  /** phi: share of competing capital running AI-selected strategies, in [0, 1]. */
  readonly adoptionShare: number;
  /** rho: correlation of positions across adopters, in [0, 1]. Zero means no crowding. */
  readonly strategyCorrelation: number;
  /** N: number of competing adopters. */
  readonly competingAdopters: number;
  /** a: attention/capital intensity each adopter puts behind the signal. */
  readonly attentionIntensity: number;
  /** lambda_0: market depth at zero adoption, in the same units as N * a. */
  readonly baseMarketDepth: number;
  /**
   * How much of the depth crowding itself consumes, in [0, 1). The paper writes lambda
   * as a function of phi but does not pin the functional form, so this is MY CHOICE:
   * lambda(phi) = lambda_0 * (1 - depthErosion * phi). Set to 0 for depth that does not
   * respond to adoption at all.
   */
  readonly depthErosion: number;
}

/** Paper: pre-AI half-lives of 5-7 years. Midpoint 6 years, expressed in months. */
const PAPER_NATURAL_HALF_LIFE_MONTHS = 72;
/** Paper: ~18 months at the calibration point below. */
const PAPER_CROWDED_HALF_LIFE_MONTHS = 18;
/** Paper: phi ~= 0.7 at the calibration point. */
const PAPER_ADOPTION_SHARE = 0.7;
/** Paper: rho ~= 0.6 at the calibration point. */
const PAPER_STRATEGY_CORRELATION = 0.6;

/** MY CHOICE. The paper reports no adopter count; 100 is a legible round number. */
const CHOSEN_COMPETING_ADOPTERS = 100;
/** MY CHOICE. Attention normalised to one unit per adopter, so N * a reads as headcount. */
const CHOSEN_ATTENTION_INTENSITY = 1;
/** MY CHOICE. Crowding eats 30% of depth at full adoption. Not a paper figure. */
const CHOSEN_DEPTH_EROSION = 0.3;

const LN2 = Math.LN2;

const PAPER_NATURAL_DECAY_RATE = LN2 / PAPER_NATURAL_HALF_LIFE_MONTHS;
const PAPER_ADOPTION_DECAY_RATE = LN2 / PAPER_CROWDED_HALF_LIFE_MONTHS - PAPER_NATURAL_DECAY_RATE;

/**
 * Depth is solved rather than asserted: the three constants above are my choices, so the
 * one remaining degree of freedom is fixed by requiring the preset to reproduce the
 * paper's own calibration point exactly. Changing any chosen constant re-solves depth and
 * keeps the preset on 18 months, which is the property the test pins.
 */
const SOLVED_BASE_MARKET_DEPTH =
  (CHOSEN_COMPETING_ADOPTERS * CHOSEN_ATTENTION_INTENSITY * PAPER_ADOPTION_SHARE * PAPER_STRATEGY_CORRELATION) /
  (PAPER_ADOPTION_DECAY_RATE * (1 - CHOSEN_DEPTH_EROSION * PAPER_ADOPTION_SHARE));

/**
 * The paper's calibration point, named so it can never be mistaken for a silent default.
 * Yields ~18 months as configured and ~72 months at zero adoption.
 */
export const PAPER_CALIBRATION_2026: SignalHalfLifeConfig = {
  naturalDecayRate: PAPER_NATURAL_DECAY_RATE,
  adoptionShare: PAPER_ADOPTION_SHARE,
  strategyCorrelation: PAPER_STRATEGY_CORRELATION,
  competingAdopters: CHOSEN_COMPETING_ADOPTERS,
  attentionIntensity: CHOSEN_ATTENTION_INTENSITY,
  baseMarketDepth: SOLVED_BASE_MARKET_DEPTH,
  depthErosion: CHOSEN_DEPTH_EROSION,
};

export type HalfLifeRegime =
  /** Both decay channels are zero: nothing in the model erodes the edge. */
  | "persistent"
  /** Full adoption at perfect correlation. Net alpha is zero by construction. */
  | "monoculture"
  | "finite";

export interface HalfLifeAssessment {
  readonly regime: HalfLifeRegime;
  /** POSITIVE_INFINITY when persistent, 0 when monoculture. */
  readonly halfLifeMonths: number;
  /** ln(2) / theta: what the half-life would be with no adoption at all. */
  readonly naturalHalfLifeMonths: number;
  /** delta(phi): the crowding-driven part of the decay rate. */
  readonly adoptionDecayRate: number;
  /** theta + delta(phi). */
  readonly totalDecayRate: number;
  /** lambda(phi) after erosion. */
  readonly effectiveDepth: number;
  /** Red Queen result: at monoculture no amount of further investment buys net alpha. */
  readonly netAlphaIsZero: boolean;
  readonly note: string;
}

function assertInRange(name: string, value: number, low: number, high: number): void {
  if (!Number.isFinite(value) || value < low || value > high) {
    throw new RangeError(`${name} must be a finite number in [${low}, ${high}], got ${value}`);
  }
}

function assertConfig(config: SignalHalfLifeConfig): void {
  assertInRange("naturalDecayRate", config.naturalDecayRate, 0, Number.MAX_VALUE);
  assertInRange("adoptionShare", config.adoptionShare, 0, 1);
  assertInRange("strategyCorrelation", config.strategyCorrelation, 0, 1);
  assertInRange("competingAdopters", config.competingAdopters, 0, Number.MAX_VALUE);
  assertInRange("attentionIntensity", config.attentionIntensity, 0, Number.MAX_VALUE);
  assertInRange("depthErosion", config.depthErosion, 0, 0.999999);
  if (!Number.isFinite(config.baseMarketDepth) || config.baseMarketDepth <= 0) {
    throw new RangeError(`baseMarketDepth must be a finite number above 0, got ${config.baseMarketDepth}`);
  }
}

/** lambda(phi). Kept strictly positive by the depthErosion and adoptionShare ranges. */
function effectiveDepth(config: SignalHalfLifeConfig): number {
  return config.baseMarketDepth * (1 - config.depthErosion * config.adoptionShare);
}

function isMonoculture(config: SignalHalfLifeConfig): boolean {
  return config.adoptionShare >= 1 && config.strategyCorrelation >= 1;
}

export function computeSignalHalfLife(config: SignalHalfLifeConfig): HalfLifeAssessment {
  assertConfig(config);

  const depth = effectiveDepth(config);
  const naturalHalfLifeMonths =
    config.naturalDecayRate > 0 ? LN2 / config.naturalDecayRate : Number.POSITIVE_INFINITY;

  if (isMonoculture(config)) {
    return {
      regime: "monoculture",
      halfLifeMonths: 0,
      naturalHalfLifeMonths,
      adoptionDecayRate: Number.POSITIVE_INFINITY,
      totalDecayRate: Number.POSITIVE_INFINITY,
      effectiveDepth: depth,
      netAlphaIsZero: true,
      note:
        "Monoculture equilibrium: full adoption at perfect correlation. The Red Queen result says net alpha is " +
        "identically zero here, so no half-life is meaningful and further investment buys none.",
    };
  }

  const adoptionDecayRate =
    (config.competingAdopters * config.adoptionShare * config.strategyCorrelation * config.attentionIntensity) /
    depth;
  const totalDecayRate = config.naturalDecayRate + adoptionDecayRate;

  if (totalDecayRate === 0) {
    return {
      regime: "persistent",
      halfLifeMonths: Number.POSITIVE_INFINITY,
      naturalHalfLifeMonths,
      adoptionDecayRate,
      totalDecayRate,
      effectiveDepth: depth,
      netAlphaIsZero: false,
      note:
        "No mean reversion and no adoption pressure, so the model predicts no decay. That is a statement about the " +
        "inputs, not evidence that the edge is permanent.",
    };
  }

  return {
    regime: "finite",
    halfLifeMonths: LN2 / totalDecayRate,
    naturalHalfLifeMonths,
    adoptionDecayRate,
    totalDecayRate,
    effectiveDepth: depth,
    netAlphaIsZero: false,
    note: "Model-derived half-life, not an out-of-sample measurement.",
  };
}

/** Fraction of the original edge still present after `monthsElapsed`. */
export function remainingEdgeFraction(halfLifeMonths: number, monthsElapsed: number): number {
  if (!(monthsElapsed >= 0)) {
    throw new RangeError(`monthsElapsed must not be negative, got ${monthsElapsed}`);
  }
  if (halfLifeMonths === Number.POSITIVE_INFINITY) {
    return 1;
  }
  if (halfLifeMonths <= 0) {
    return monthsElapsed === 0 ? 1 : 0;
  }
  return Math.pow(2, -monthsElapsed / halfLifeMonths);
}

/** Months until only `remainingFractionThreshold` of the original edge is left. */
export function monthsUntilEdgeBelow(halfLifeMonths: number, remainingFractionThreshold: number): number {
  if (!(remainingFractionThreshold > 0) || remainingFractionThreshold > 1) {
    throw new RangeError(`remainingFractionThreshold must be in (0, 1], got ${remainingFractionThreshold}`);
  }
  if (remainingFractionThreshold === 1) {
    return 0;
  }
  if (halfLifeMonths === Number.POSITIVE_INFINITY) {
    return Number.POSITIVE_INFINITY;
  }
  if (halfLifeMonths <= 0) {
    return 0;
  }
  return halfLifeMonths * Math.log2(1 / remainingFractionThreshold);
}

export interface CostFloorHorizonInput {
  /** Edge as backtested, in whatever unit the floor uses. Sharpe is the usual one. */
  readonly backtestedEdge: number;
  /** The level below which the strategy no longer covers its own execution costs. */
  readonly costFloorEdge: number;
  readonly halfLifeMonths: number;
}

export interface CostFloorHorizon {
  readonly backtestedEdge: number;
  readonly costFloorEdge: number;
  readonly halfLifeMonths: number;
  readonly monthsUntilBelowFloor: number;
  readonly alreadyBelowFloor: boolean;
  readonly summary: string;
}

/**
 * The operationally useful output: "backtested Sharpe 1.8, at this decay it is under the
 * 0.5 cost floor in N months".
 */
export function monthsUntilBelowCostFloor(input: CostFloorHorizonInput): CostFloorHorizon {
  if (!(input.backtestedEdge > 0)) {
    throw new RangeError(`backtestedEdge must be above 0, got ${input.backtestedEdge}`);
  }
  if (!(input.costFloorEdge >= 0)) {
    throw new RangeError(`costFloorEdge must not be negative, got ${input.costFloorEdge}`);
  }

  if (input.costFloorEdge >= input.backtestedEdge) {
    return {
      backtestedEdge: input.backtestedEdge,
      costFloorEdge: input.costFloorEdge,
      halfLifeMonths: input.halfLifeMonths,
      monthsUntilBelowFloor: 0,
      alreadyBelowFloor: true,
      summary: "The backtested edge is already at or below the cost floor before any decay is applied.",
    };
  }

  // Exponential decay never reaches zero, so a zero floor is never crossed.
  const months =
    input.costFloorEdge === 0
      ? Number.POSITIVE_INFINITY
      : monthsUntilEdgeBelow(input.halfLifeMonths, input.costFloorEdge / input.backtestedEdge);

  return {
    backtestedEdge: input.backtestedEdge,
    costFloorEdge: input.costFloorEdge,
    halfLifeMonths: input.halfLifeMonths,
    monthsUntilBelowFloor: months,
    alreadyBelowFloor: false,
    summary: Number.isFinite(months)
      ? `Edge ${input.backtestedEdge} falls below the ${input.costFloorEdge} cost floor after ${months.toFixed(1)} months.`
      : "Under these inputs the edge never reaches the cost floor.",
  };
}

export interface BacktestValidityInput {
  readonly backtestWindowMonths: number;
  readonly liveHorizonMonths: number;
  readonly halfLifeMonths: number;
}

export interface BacktestValidity {
  readonly backtestWindowMonths: number;
  readonly liveHorizonMonths: number;
  readonly halfLifeMonths: number;
  readonly halfLivesInWindow: number;
  /** True when the edge half-died inside its own measurement window. */
  readonly measuresDecayedAverage: boolean;
  /** Mean surviving fraction across the window: what the backtest actually averaged. */
  readonly windowAverageEdgeFraction: number;
  /** Surviving fraction at the last bar of the window. */
  readonly edgeAtWindowEnd: number;
  /** Surviving fraction at the end of the intended live horizon. */
  readonly edgeAtHorizonEnd: number;
  /** How much the window average flatters the edge inherited at go-live. */
  readonly overstatementFactor: number;
  readonly liveHorizonExceedsHalfLife: boolean;
  readonly warnings: readonly string[];
}

/** Mean of 2^(-t/h) over [0, W], in closed form. */
function averageRemainingFraction(halfLifeMonths: number, windowMonths: number): number {
  if (halfLifeMonths === Number.POSITIVE_INFINITY || windowMonths === 0) {
    return 1;
  }
  if (halfLifeMonths <= 0) {
    return 0;
  }
  return (halfLifeMonths / (windowMonths * LN2)) * (1 - Math.pow(2, -windowMonths / halfLifeMonths));
}

/**
 * An edge averaged over a window in which it half-died is not the edge you inherit. This
 * reports that as a validity error rather than as a footnote.
 */
export function assessBacktestValidity(input: BacktestValidityInput): BacktestValidity {
  if (!(input.backtestWindowMonths >= 0)) {
    throw new RangeError(`backtestWindowMonths must not be negative, got ${input.backtestWindowMonths}`);
  }
  if (!(input.liveHorizonMonths >= 0)) {
    throw new RangeError(`liveHorizonMonths must not be negative, got ${input.liveHorizonMonths}`);
  }

  const { halfLifeMonths, backtestWindowMonths, liveHorizonMonths } = input;
  const halfLivesInWindow =
    halfLifeMonths === Number.POSITIVE_INFINITY
      ? 0
      : halfLifeMonths > 0
        ? backtestWindowMonths / halfLifeMonths
        : Number.POSITIVE_INFINITY;
  const measuresDecayedAverage = halfLivesInWindow > 1;
  const liveHorizonExceedsHalfLife =
    halfLifeMonths !== Number.POSITIVE_INFINITY && liveHorizonMonths > halfLifeMonths;

  const windowAverageEdgeFraction = averageRemainingFraction(halfLifeMonths, backtestWindowMonths);
  const edgeAtWindowEnd = remainingEdgeFraction(halfLifeMonths, backtestWindowMonths);
  const edgeAtHorizonEnd = remainingEdgeFraction(halfLifeMonths, backtestWindowMonths + liveHorizonMonths);

  const warnings: string[] = [];
  if (measuresDecayedAverage) {
    warnings.push(
      `Backtest window spans ${halfLivesInWindow.toFixed(2)} half-lives, so the reported edge is an average over a ` +
        "period in which the signal half-died. It overstates the edge available now.",
    );
  }
  if (liveHorizonExceedsHalfLife) {
    warnings.push(
      `Intended live horizon of ${liveHorizonMonths} months exceeds the ${halfLifeMonths.toFixed(1)}-month ` +
        "half-life, so most of the edge is modelled to be gone before the horizon closes.",
    );
  }

  return {
    backtestWindowMonths,
    liveHorizonMonths,
    halfLifeMonths,
    halfLivesInWindow,
    measuresDecayedAverage,
    windowAverageEdgeFraction,
    edgeAtWindowEnd,
    edgeAtHorizonEnd,
    overstatementFactor:
      edgeAtWindowEnd > 0 ? windowAverageEdgeFraction / edgeAtWindowEnd : Number.POSITIVE_INFINITY,
    liveHorizonExceedsHalfLife,
    warnings,
  };
}

export interface AdoptionSensitivityPoint {
  readonly adoptionShare: number;
  readonly halfLifeMonths: number;
  readonly regime: HalfLifeRegime;
}

export interface AdoptionSensitivity {
  readonly points: readonly AdoptionSensitivityPoint[];
  /** The alpha half-life theorem holds on this grid: falling, and falling ever faster. */
  readonly convexDecreasing: boolean;
  /** Lowest adoption at which the half-life drops under the supplied floor, if any. */
  readonly criticalAdoptionShare: number | null;
}

/** MY CHOICE of default grid: eleven evenly spaced points, endpoints included. */
function defaultAdoptionGrid(): number[] {
  const grid: number[] = [];
  for (let step = 0; step <= 10; step += 1) {
    grid.push(step / 10);
  }
  return grid;
}

export interface AdoptionSensitivityOptions {
  readonly grid?: readonly number[];
  /** Half-life below which the signal counts as spent, for the critical-threshold search. */
  readonly halfLifeFloorMonths?: number;
}

/** Shows the convexity rather than a single point estimate. */
export function adoptionSensitivity(
  config: SignalHalfLifeConfig,
  options: AdoptionSensitivityOptions = {},
): AdoptionSensitivity {
  const grid = options.grid ?? defaultAdoptionGrid();
  const points: AdoptionSensitivityPoint[] = grid.map((adoptionShare) => {
    const assessment = computeSignalHalfLife({ ...config, adoptionShare });
    return { adoptionShare, halfLifeMonths: assessment.halfLifeMonths, regime: assessment.regime };
  });

  return {
    points,
    convexDecreasing: isConvexDecreasing(points),
    criticalAdoptionShare:
      options.halfLifeFloorMonths === undefined
        ? null
        : criticalAdoptionShare(config, options.halfLifeFloorMonths),
  };
}

function isConvexDecreasing(points: readonly AdoptionSensitivityPoint[]): boolean {
  const finite = points.filter((point) => Number.isFinite(point.halfLifeMonths));
  if (finite.length < 3) {
    return false;
  }
  for (let index = 1; index < finite.length; index += 1) {
    const previous = finite[index - 1];
    const current = finite[index];
    if (previous === undefined || current === undefined || current.halfLifeMonths >= previous.halfLifeMonths) {
      return false;
    }
  }
  for (let index = 1; index + 1 < finite.length; index += 1) {
    const left = finite[index - 1];
    const middle = finite[index];
    const right = finite[index + 1];
    if (left === undefined || middle === undefined || right === undefined) {
      return false;
    }
    const secondDifference = left.halfLifeMonths - 2 * middle.halfLifeMonths + right.halfLifeMonths;
    if (!(secondDifference > 0)) {
      return false;
    }
  }
  return true;
}

/**
 * phi*, the adoption share past which the signal class is spent. Found by bisection
 * because the half-life is strictly decreasing in adoption, so the crossing is unique.
 */
export function criticalAdoptionShare(config: SignalHalfLifeConfig, halfLifeFloorMonths: number): number | null {
  if (!(halfLifeFloorMonths > 0)) {
    throw new RangeError(`halfLifeFloorMonths must be above 0, got ${halfLifeFloorMonths}`);
  }
  const atZeroAdoption = computeSignalHalfLife({ ...config, adoptionShare: 0 }).halfLifeMonths;
  if (atZeroAdoption <= halfLifeFloorMonths) {
    return 0;
  }
  const atFullAdoption = computeSignalHalfLife({ ...config, adoptionShare: 1 }).halfLifeMonths;
  if (atFullAdoption > halfLifeFloorMonths) {
    return null;
  }

  let low = 0;
  let high = 1;
  // 60 halvings takes the bracket well below float resolution on [0, 1].
  for (let iteration = 0; iteration < 60; iteration += 1) {
    const middle = (low + high) / 2;
    if (computeSignalHalfLife({ ...config, adoptionShare: middle }).halfLifeMonths > halfLifeFloorMonths) {
      low = middle;
    } else {
      high = middle;
    }
  }
  return high;
}

export interface SignalClass {
  readonly name: string;
  readonly config: SignalHalfLifeConfig;
}

export interface ExtinctionEvent {
  readonly name: string;
  readonly halfLifeMonthsAtExtinction: number;
  /** Adoption share the first surviving class carries once the freed capital moves over. */
  readonly survivorAdoptionAfter: number;
}

export interface ExtinctionCascade {
  readonly events: readonly ExtinctionEvent[];
  readonly survivors: readonly { readonly name: string; readonly halfLifeMonths: number }[];
  readonly cascaded: boolean;
}

export interface ExtinctionCascadeOptions {
  readonly halfLifeFloorMonths: number;
  /**
   * MY CHOICE of redistribution rule: the extinct class's adoption share is split evenly
   * across survivors, capped at full adoption. The paper asserts that decay of one class
   * accelerates competition for the rest but does not specify how capital reallocates.
   */
  readonly redistributeAdoption?: boolean;
}

/**
 * Signal extinction cascade: once one class dies, its capital hunts the survivors, which
 * shortens their lives in turn.
 */
export function projectExtinctionCascade(
  signals: readonly SignalClass[],
  options: ExtinctionCascadeOptions,
): ExtinctionCascade {
  if (!(options.halfLifeFloorMonths > 0)) {
    throw new RangeError(`halfLifeFloorMonths must be above 0, got ${options.halfLifeFloorMonths}`);
  }
  const redistribute = options.redistributeAdoption ?? true;

  let active: SignalClass[] = signals.map((signal) => ({ name: signal.name, config: signal.config }));
  const events: ExtinctionEvent[] = [];

  for (let round = 0; round < signals.length; round += 1) {
    const scored = active.map((signal) => ({
      signal,
      halfLifeMonths: computeSignalHalfLife(signal.config).halfLifeMonths,
    }));
    let weakest = scored[0];
    if (weakest === undefined) {
      break;
    }
    for (const candidate of scored) {
      if (candidate.halfLifeMonths < weakest.halfLifeMonths) {
        weakest = candidate;
      }
    }
    if (weakest.halfLifeMonths > options.halfLifeFloorMonths) {
      break;
    }

    const extinctName = weakest.signal.name;
    const survivors = active.filter((signal) => signal.name !== extinctName);
    const freedShare = weakest.signal.config.adoptionShare;
    const perSurvivor = redistribute && survivors.length > 0 ? freedShare / survivors.length : 0;
    active = survivors.map((signal) => ({
      name: signal.name,
      config: { ...signal.config, adoptionShare: Math.min(1, signal.config.adoptionShare + perSurvivor) },
    }));

    const firstSurvivor = active[0];
    events.push({
      name: extinctName,
      halfLifeMonthsAtExtinction: weakest.halfLifeMonths,
      survivorAdoptionAfter: firstSurvivor === undefined ? 0 : firstSurvivor.config.adoptionShare,
    });
  }

  return {
    events,
    survivors: active.map((signal) => ({
      name: signal.name,
      halfLifeMonths: computeSignalHalfLife(signal.config).halfLifeMonths,
    })),
    cascaded: events.length > 0,
  };
}

export interface FragilityEfficiencyPoint {
  readonly adoptionShare: number;
  /** Relative and unitless. Only the shape and the argmax carry meaning. */
  readonly priceDiscovery: number;
  /** Relative and unitless. Crowded exposure measured against surviving depth. */
  readonly fragility: number;
}

export interface FragilityEfficiencyTradeoff {
  readonly points: readonly FragilityEfficiencyPoint[];
  readonly discoveryMaximisingAdoption: number;
  readonly fragilityMinimisingAdoption: number;
  readonly gap: number;
  /** The paper's result 4: the efficient adoption level sits above the safe one. */
  readonly efficientExceedsSafe: boolean;
  readonly caveat: string;
}

/**
 * Fragility-efficiency tradeoff. The paper reports the ordering; the functional forms
 * below are MY CHOICE, since it publishes neither. Price discovery rises with the number
 * of independent processors of information and falls as correlation collapses them into
 * one processor: phi * (1 - rho * phi). Fragility is crowded exposure over surviving
 * depth, which is monotone in adoption, so the safe level is the bottom of the grid.
 * These forms reproduce the ordering under stated assumptions; they do not evidence it.
 */
export function fragilityEfficiencyTradeoff(
  config: SignalHalfLifeConfig,
  grid: readonly number[] = defaultAdoptionGrid(),
): FragilityEfficiencyTradeoff {
  assertConfig(config);

  const points: FragilityEfficiencyPoint[] = grid.map((adoptionShare) => {
    const depth = effectiveDepth({ ...config, adoptionShare });
    return {
      adoptionShare,
      priceDiscovery: adoptionShare * (1 - config.strategyCorrelation * adoptionShare),
      fragility:
        (config.competingAdopters *
          config.attentionIntensity *
          config.strategyCorrelation *
          adoptionShare *
          adoptionShare) /
        depth,
    };
  });

  let best = points[0];
  let safest = points[0];
  if (best === undefined || safest === undefined) {
    throw new RangeError("grid must contain at least one adoption share");
  }
  for (const point of points) {
    if (point.priceDiscovery > best.priceDiscovery) {
      best = point;
    }
    if (point.fragility < safest.fragility) {
      safest = point;
    }
  }

  return {
    points,
    discoveryMaximisingAdoption: best.adoptionShare,
    fragilityMinimisingAdoption: safest.adoptionShare,
    gap: best.adoptionShare - safest.adoptionShare,
    efficientExceedsSafe: best.adoptionShare > safest.adoptionShare,
    caveat:
      "Discovery and fragility curves use assumed functional forms, not published ones. The ordering is the paper's " +
      "claim; the magnitudes here are illustrative.",
  };
}
