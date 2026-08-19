/**
 * Safety Projection Layer
 *
 * Minimally projects a proposed action onto the feasible set defined by hard
 * business rules, and emits the audit record as a byproduct of the solve
 * rather than as a narration written after the fact.
 *
 * PROVENANCE AND EVIDENCE, STATED PLAINLY.
 * The architecture is adapted from Tail-Safe Hedging (2026), a control-barrier
 * -function quadratic-program safety filter. The mechanism is adopted on the
 * strength of its logic, not on demonstrated performance, and a reader deserves
 * to know which of the two this is. The paper's architecture is sound and well
 * specified. Its evidence is not: it reports zero quantitative results, its
 * ablation table is populated with arrows and the words "mixed" and "unstable"
 * rather than numbers, and every experiment runs on a synthetic market. Its
 * headline "zero hard-constraint violations" claim is a restatement of its own
 * feasibility theorem, not a measurement. There are therefore no numbers from
 * that paper to cite, and none are cited here. What survives the evidence
 * review is the shape of the idea: a minimal projection onto a barrier-defined
 * feasible set, with telemetry falling out of the solve.
 *
 * Two properties are load-bearing and both are tested in safety-projection.test.ts:
 *   MINIMALITY  the returned action is the closest feasible point to what was
 *               proposed. A layer that clamps everything to zero is safe and
 *               useless.
 *   INVARIANCE  if the state starts feasible and the layer runs every step,
 *               the state stays feasible. That is what makes this a barrier
 *               rather than a filter.
 *
 * This composes with RiskKernel rather than replacing it. The kernel decides
 * approve/modify/reject over a single order against named checks; this layer
 * answers the different question of what the nearest admissible action is over
 * a whole multi-leg action vector, and reports the geometry of the answer.
 * Limits can be derived from the kernel's own config via limitsFromRiskConfig
 * so the two surfaces cannot drift apart.
 *
 * Pure and clock-injected: state carries nowMs, nothing here reads a clock or
 * touches I/O, so a given input always yields identical output.
 */

import type { RiskKernelConfig } from "./config.ts";

// ============================================================================
// Types
// ============================================================================

export type ConstraintName =
  | "leverage"
  | "liquidity"
  | "concentration"
  | "drawdown"
  | "rate_limit"
  | "sign_consistency";

export type ProjectionVerdict =
  | "pass"
  | "soft_intercept"
  | "hard_intercept"
  | "refused"
  | "infeasible";

/** One leg of an action: a signed USD notional delta. Positive adds long exposure. */
export interface ActionLeg {
  symbol: string;
  notionalDelta: number;
}

export interface LegState {
  symbol: string;
  /** Signed current notional. Positive is long, negative is short. */
  currentNotionalUsd: number;
  /**
   * Notional that can be traded on this leg right now. Both a buy and a short
   * consume balance or margin, so this bounds the magnitude of the change, not
   * only the positive direction.
   */
  availableLiquidityUsd: number;
  /** Ceiling on the absolute post-action position for this leg. */
  concentrationCapUsd: number;
  /** Ceiling on total absolute notional change inside the rate window. */
  rateLimitUsd: number;
  /** Marginal drawdown contribution per USD traded on this leg. */
  riskPerUsd: number;
  /**
   * Independent signals, each in [-1, 1]. An empty ensemble opts this leg out
   * of the sign gate: the gate scores evidence, and absence of an ensemble is a
   * caller integration choice rather than a disagreement.
   */
  signals: readonly number[];
  /** Weight in the projection norm. Higher means more reluctance to move this leg. */
  costWeight: number;
}

export interface PriorAction {
  atMs: number;
  legs: readonly ActionLeg[];
}

export interface SafetyState {
  nowMs: number;
  equityUsd: number;
  /** Drawdown already incurred, as a positive number. */
  currentDrawdownUsd: number;
  legs: readonly LegState[];
  recentActions: readonly PriorAction[];
}

export interface SafetyLimits {
  maxLeverage: number;
  maxDrawdownUsd: number;
  rateWindowMs: number;
  /** Fraction of signed signal mass that must agree with the proposed direction. */
  signConsistencyMargin: number;
  /**
   * Budget for constraint relaxation. Zero means a constraint that cannot be
   * satisfied yields "infeasible" instead of a slack-carrying action.
   */
  maxSlackUsd: number;
}

export interface ConstraintTelemetry {
  name: ConstraintName;
  /** Barrier value at the proposed action. Negative means the proposal violated it. */
  slackProposed: number;
  /** Barrier value at the returned action. */
  slackProjected: number;
  /** On the boundary within tolerance. */
  active: boolean;
  /** Dropping this constraint would move the projection. Active but not binding is redundancy. */
  binding: boolean;
  /** 0 far from the boundary, 1 on or past it. */
  tightness: number;
  /** Relaxation this constraint had to absorb. Nonzero only on a hard intercept. */
  slackUsedUsd: number;
}

export interface SignConsistencyTelemetry {
  symbol: string;
  score: number;
  agreed: boolean;
}

export interface ProjectionTelemetry {
  constraints: ConstraintTelemetry[];
  activeConstraints: ConstraintName[];
  bindingConstraints: ConstraintName[];
  /**
   * Highest-tightness binding constraint: the one that actually shaped the
   * action. Null when nothing bound.
   */
  tightestConstraint: ConstraintName | null;
  /** Worst per-leg rate-window consumption after the action, in [0, 1]. */
  rateLimitUtilisation: number;
  /** Weighted-norm distance between the proposal and the returned action. */
  deviation: number;
  deviationPerLeg: { symbol: string; delta: number }[];
  signConsistency: SignConsistencyTelemetry[];
  totalSlackUsd: number;
  iterations: number;
  converged: boolean;
}

export interface SafetyProjectionResult {
  verdict: ProjectionVerdict;
  /**
   * Null exactly when the verdict is "refused" or "infeasible", so an absent
   * action can never be mistaken for a successful no-op.
   */
  action: ActionLeg[] | null;
  telemetry: ProjectionTelemetry;
}

export interface BarrierValues {
  leverage: number;
  liquidity: number;
  concentration: number;
  drawdown: number;
  rate_limit: number;
}

const TOL = 1e-7;
const MAX_SWEEPS = 500;
const SWEEP_TOL = 1e-11;
const BISECTION_STEPS = 80;

const BOX_CONSTRAINTS: ConstraintName[] = ["liquidity", "concentration", "rate_limit"];
const HARD_CONSTRAINTS: (keyof BarrierValues)[] = [
  "leverage",
  "liquidity",
  "concentration",
  "drawdown",
  "rate_limit",
];

// ============================================================================
// Kernel interop
// ============================================================================

/**
 * Derive projection limits from the Risk Kernel's own config so the two
 * surfaces cannot drift apart. maxSlackUsd defaults to zero: relaxing a hard
 * limit is an operator decision, never a default.
 */
export function limitsFromRiskConfig(
  config: RiskKernelConfig,
  equityUsd: number,
  overrides?: Partial<SafetyLimits>,
): SafetyLimits {
  return {
    maxLeverage: config.maxLeverage,
    maxDrawdownUsd: (config.maxDrawdownPercent / 100) * equityUsd,
    rateWindowMs: 60_000,
    signConsistencyMargin: 0.5,
    maxSlackUsd: 0,
    ...overrides,
  };
}

/** Per-leg concentration ceiling implied by the kernel's single-asset exposure cap. */
export function concentrationCapFromRiskConfig(
  config: RiskKernelConfig,
  equityUsd: number,
): number {
  return (config.maxSingleAssetExposure / 100) * equityUsd;
}

// ============================================================================
// Barriers
// ============================================================================

/**
 * Barrier values h(x) >= 0 evaluated at the state AFTER the action. Every
 * barrier is expressed in USD so slack, tightness and the relaxation budget
 * are all in one comparable unit.
 */
export function evaluateBarriers(
  action: readonly ActionLeg[],
  state: SafetyState,
  limits: SafetyLimits,
): BarrierValues {
  return barriersFromVector(toVector(action, state), buildContext(state, limits));
}

export function isFeasible(
  action: readonly ActionLeg[],
  state: SafetyState,
  limits: SafetyLimits,
): boolean {
  return satisfied(evaluateBarriers(action, state, limits), 0);
}

// ============================================================================
// Projection
// ============================================================================

/**
 * Project a proposed action onto the feasible set.
 *
 * No QP solver is pulled in. The feasible set is an intersection of three
 * convex pieces, each with an exact closed-form projection under the diagonal
 * weighted norm: an axis-aligned box (liquidity, concentration and rate
 * limits), a weighted l1 ball on post-action positions (leverage ceiling), and
 * a weighted l1 ball on traded notional (drawdown budget). Dykstra's
 * alternating projection with per-set corrections converges to the exact
 * projection onto an intersection of convex sets, so cycling those three closed
 * forms lands on the same point a QP would, deterministically and with no
 * dependency.
 */
export function projectAction(
  proposed: readonly ActionLeg[],
  state: SafetyState,
  limits: SafetyLimits,
): SafetyProjectionResult {
  const ctx = buildContext(state, limits);
  const xNom = toVector(proposed, state);

  const signReports = evaluateSignConsistency(xNom, state, limits);
  if (signReports.some((r) => !r.agreed)) {
    // Shrinking a wrong-direction trade leaves a small wrong-direction trade,
    // so direction disagreement refuses instead of resizing.
    return {
      verdict: "refused",
      action: null,
      telemetry: refusalTelemetry(xNom, ctx, signReports),
    };
  }

  const hNom = barriersFromVector(xNom, ctx);
  if (satisfied(hNom, 0)) {
    return {
      verdict: "pass",
      action: proposed.map((leg) => ({ ...leg })),
      telemetry: buildTelemetry(xNom, xNom, ctx, hNom, 0, signReports, {
        iterations: 0,
        converged: true,
      }),
    };
  }

  const strict = solve(xNom, ctx, 0);
  if (strict.feasible) {
    return finish("soft_intercept", xNom, ctx, 0, signReports, strict);
  }

  if (limits.maxSlackUsd <= 0) {
    return infeasibleResult(xNom, ctx, signReports, strict);
  }

  const relaxed = solve(xNom, ctx, limits.maxSlackUsd);
  if (!relaxed.feasible) {
    return infeasibleResult(xNom, ctx, signReports, relaxed);
  }

  // Lexicographic rule: smallest relaxation first, then the closest action
  // inside that relaxed set. Projecting straight onto the fully relaxed set
  // would spend the entire slack budget whenever it happened to be available.
  let lo = 0;
  let hi = limits.maxSlackUsd;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (solve(xNom, ctx, mid).feasible) hi = mid;
    else lo = mid;
  }
  const minimal = solve(xNom, ctx, hi);
  return finish("hard_intercept", xNom, ctx, hi, signReports, minimal);
}

// ============================================================================
// Solver
// ============================================================================

interface SolveOutcome {
  x: number[];
  feasible: boolean;
  iterations: number;
  converged: boolean;
}

interface ProjectionContext {
  n: number;
  symbols: string[];
  pos: number[];
  weight: number[];
  riskPerUsd: number[];
  liquidity: number[];
  concentration: number[];
  rateAvailable: number[];
  rateLimit: number[];
  rateUsed: number[];
  leverageRadius: number;
  drawdownRadius: number;
  limits: SafetyLimits;
}

function buildContext(state: SafetyState, limits: SafetyLimits): ProjectionContext {
  const windowStart = state.nowMs - limits.rateWindowMs;
  const rateUsed = state.legs.map((leg) => {
    let used = 0;
    for (const prior of state.recentActions) {
      if (prior.atMs <= windowStart) continue;
      for (const priorLeg of prior.legs) {
        if (priorLeg.symbol === leg.symbol) used += Math.abs(priorLeg.notionalDelta);
      }
    }
    return used;
  });

  return {
    n: state.legs.length,
    symbols: state.legs.map((l) => l.symbol),
    pos: state.legs.map((l) => l.currentNotionalUsd),
    // A non-positive weight would let a leg move arbitrarily far at no cost,
    // which is not what a caller who left the field at zero means.
    weight: state.legs.map((l) => (l.costWeight > 0 ? l.costWeight : 1)),
    riskPerUsd: state.legs.map((l) => l.riskPerUsd),
    liquidity: state.legs.map((l) => l.availableLiquidityUsd),
    concentration: state.legs.map((l) => l.concentrationCapUsd),
    rateAvailable: state.legs.map((l, i) => l.rateLimitUsd - rateUsed[i]!),
    rateLimit: state.legs.map((l) => l.rateLimitUsd),
    rateUsed,
    leverageRadius: limits.maxLeverage * state.equityUsd,
    drawdownRadius: limits.maxDrawdownUsd - state.currentDrawdownUsd,
    limits,
  };
}

function solve(xNom: number[], ctx: ProjectionContext, slack: number): SolveOutcome {
  const dyk = dykstra(xNom, ctx, slack);
  const snapped = snapToFeasible(dyk.x, ctx, slack);
  return {
    x: snapped,
    feasible: satisfied(barriersFromVector(snapped, ctx), slack),
    iterations: dyk.iterations,
    converged: dyk.converged,
  };
}

/**
 * Dykstra's algorithm. Plain alternating projection converges to some point in
 * the intersection; the per-set correction terms are what make the limit the
 * nearest point, which is the minimality property this layer promises.
 */
function dykstra(
  xNom: number[],
  ctx: ProjectionContext,
  slack: number,
): { x: number[]; iterations: number; converged: boolean } {
  return sweep(xNom, ctx, buildBox(ctx, slack), ctx.leverageRadius + slack, ctx.drawdownRadius + slack);
}

function sweep(
  xNom: number[],
  ctx: ProjectionContext,
  box: [number[], number[]],
  leverageRadius: number,
  drawdownRadius: number,
): { x: number[]; iterations: number; converged: boolean } {
  const [lo, hi] = box;
  const levCenter = ctx.pos.map((p) => -p);
  const levCoef = new Array<number>(ctx.n).fill(1);
  const zeroCenter = new Array<number>(ctx.n).fill(0);

  let x = xNom.slice();
  const corrections = [
    new Array<number>(ctx.n).fill(0),
    new Array<number>(ctx.n).fill(0),
    new Array<number>(ctx.n).fill(0),
  ];

  let iterations = 0;
  let converged = false;
  for (let step = 0; step < MAX_SWEEPS; step++) {
    iterations = step + 1;
    const before = x.slice();

    x = applySet(x, corrections[0]!, (v) => clampToBox(v, lo, hi));
    x = applySet(x, corrections[1]!, (v) =>
      projectWeightedL1Ball(v, levCenter, levCoef, leverageRadius, ctx.weight),
    );
    x = applySet(x, corrections[2]!, (v) =>
      projectWeightedL1Ball(v, zeroCenter, ctx.riskPerUsd, drawdownRadius, ctx.weight),
    );

    let move = 0;
    for (let i = 0; i < ctx.n; i++) move = Math.max(move, Math.abs(x[i]! - before[i]!));
    if (move < SWEEP_TOL) {
      converged = true;
      break;
    }
  }

  return { x, iterations, converged };
}

function applySet(
  x: number[],
  correction: number[],
  project: (v: number[]) => number[],
): number[] {
  const shifted = x.map((xi, i) => xi + correction[i]!);
  const projected = project(shifted);
  for (let i = 0; i < x.length; i++) correction[i] = shifted[i]! - projected[i]!;
  return projected;
}

/**
 * Float dust from the iteration can leave a barrier at -1e-12, which would make
 * a nominally feasible answer technically violate. Back off along the segment
 * to a known-admissible anchor until every barrier is non-negative. When the
 * sweep has converged this exits on the first check and minimality is untouched.
 */
function snapToFeasible(x: number[], ctx: ProjectionContext, slack: number): number[] {
  if (satisfied(barriersFromVector(x, ctx), slack)) return x;

  const [lo, hi] = buildBox(ctx, slack);
  const anchor = clampToBox(new Array<number>(ctx.n).fill(0), lo, hi);
  if (!satisfied(barriersFromVector(anchor, ctx), slack)) return x;

  let good = 0;
  let bad = 1;
  for (let i = 0; i < BISECTION_STEPS; i++) {
    const mid = (good + bad) / 2;
    const candidate = anchor.map((a, j) => a + mid * (x[j]! - a));
    if (satisfied(barriersFromVector(candidate, ctx), slack)) good = mid;
    else bad = mid;
  }
  return anchor.map((a, j) => a + good * (x[j]! - a));
}

// ============================================================================
// Closed-form projections
// ============================================================================

function clampToBox(v: number[], lo: number[], hi: number[]): number[] {
  return v.map((vi, i) => Math.min(Math.max(vi, lo[i]!), hi[i]!));
}

/**
 * Projection onto { x : sum_i coef_i * |x_i - center_i| <= radius } under the
 * diagonal weighted norm sum_i w_i (x_i - v_i)^2. The KKT conditions give a
 * soft threshold x_i = center_i + sign(u_i) * max(0, |u_i| - lambda * coef_i / w_i),
 * and the l1 mass is monotone decreasing in lambda, so one bisection finds it.
 * A negative radius means an empty set: return the centre, the least-violating
 * point, and let the caller's feasibility check report the emptiness.
 */
function projectWeightedL1Ball(
  v: number[],
  center: number[],
  coef: number[],
  radius: number,
  weight: number[],
): number[] {
  if (!Number.isFinite(radius)) return v.slice();
  if (radius < 0) return center.slice();

  const u = v.map((vi, i) => vi - center[i]!);
  let mass = 0;
  for (let i = 0; i < u.length; i++) {
    if (coef[i]! > 0) mass += coef[i]! * Math.abs(u[i]!);
  }
  if (mass <= radius) return v.slice();

  let hi = 0;
  for (let i = 0; i < u.length; i++) {
    if (coef[i]! > 0) hi = Math.max(hi, (Math.abs(u[i]!) * weight[i]!) / coef[i]!);
  }
  let lo = 0;
  for (let step = 0; step < BISECTION_STEPS; step++) {
    const mid = (lo + hi) / 2;
    if (l1Mass(u, coef, weight, mid) > radius) lo = mid;
    else hi = mid;
  }

  return u.map((ui, i) => {
    if (coef[i]! <= 0) return center[i]! + ui;
    const shrunk = Math.max(0, Math.abs(ui) - (hi * coef[i]!) / weight[i]!);
    return center[i]! + Math.sign(ui) * shrunk;
  });
}

function l1Mass(u: number[], coef: number[], weight: number[], lambda: number): number {
  let total = 0;
  for (let i = 0; i < u.length; i++) {
    if (coef[i]! <= 0) continue;
    total += coef[i]! * Math.max(0, Math.abs(u[i]!) - (lambda * coef[i]!) / weight[i]!);
  }
  return total;
}

// ============================================================================
// Constraint geometry
// ============================================================================

function buildBox(
  ctx: ProjectionContext,
  slack: number,
  exclude?: ConstraintName,
): [number[], number[]] {
  const lo: number[] = [];
  const hi: number[] = [];
  for (let i = 0; i < ctx.n; i++) {
    let low = -Infinity;
    let high = Infinity;
    if (exclude !== "concentration") {
      low = Math.max(low, -ctx.concentration[i]! - ctx.pos[i]!);
      high = Math.min(high, ctx.concentration[i]! - ctx.pos[i]!);
    }
    if (exclude !== "liquidity") {
      low = Math.max(low, -ctx.liquidity[i]!);
      high = Math.min(high, ctx.liquidity[i]!);
    }
    if (exclude !== "rate_limit") {
      low = Math.max(low, -ctx.rateAvailable[i]!);
      high = Math.min(high, ctx.rateAvailable[i]!);
    }
    lo.push(low - slack);
    hi.push(high + slack);
  }
  return [lo, hi];
}

function barriersFromVector(x: number[], ctx: ProjectionContext): BarrierValues {
  let gross = 0;
  let risk = 0;
  let liquidity = Infinity;
  let concentration = Infinity;
  let rate = Infinity;

  for (let i = 0; i < ctx.n; i++) {
    const after = ctx.pos[i]! + x[i]!;
    gross += Math.abs(after);
    risk += ctx.riskPerUsd[i]! * Math.abs(x[i]!);
    liquidity = Math.min(liquidity, ctx.liquidity[i]! - Math.abs(x[i]!));
    concentration = Math.min(concentration, ctx.concentration[i]! - Math.abs(after));
    rate = Math.min(rate, ctx.rateAvailable[i]! - Math.abs(x[i]!));
  }

  return {
    leverage: ctx.leverageRadius - gross,
    liquidity,
    concentration,
    drawdown: ctx.drawdownRadius - risk,
    rate_limit: rate,
  };
}

function satisfied(h: BarrierValues, slack: number): boolean {
  const floor = -slack - TOL;
  return (
    h.leverage >= floor &&
    h.liquidity >= floor &&
    h.concentration >= floor &&
    h.drawdown >= floor &&
    h.rate_limit >= floor
  );
}

// ============================================================================
// Sign consistency gate
// ============================================================================

function evaluateSignConsistency(
  x: number[],
  state: SafetyState,
  limits: SafetyLimits,
): SignConsistencyTelemetry[] {
  const reports: SignConsistencyTelemetry[] = [];
  for (let i = 0; i < state.legs.length; i++) {
    const leg = state.legs[i]!;
    const delta = x[i]!;
    if (delta === 0 || leg.signals.length === 0) continue;

    let mass = 0;
    let aligned = 0;
    for (const signal of leg.signals) {
      mass += Math.abs(signal);
      aligned += Math.sign(signal) === Math.sign(delta) ? Math.abs(signal) : -Math.abs(signal);
    }
    const score = mass > 0 ? aligned / mass : 0;
    reports.push({ symbol: leg.symbol, score, agreed: score >= limits.signConsistencyMargin });
  }
  return reports;
}

// ============================================================================
// Telemetry
// ============================================================================

function finish(
  verdict: ProjectionVerdict,
  xNom: number[],
  ctx: ProjectionContext,
  slack: number,
  signReports: SignConsistencyTelemetry[],
  outcome: SolveOutcome,
): SafetyProjectionResult {
  return {
    verdict,
    action: ctx.symbols.map((symbol, i) => ({ symbol, notionalDelta: outcome.x[i]! })),
    telemetry: buildTelemetry(
      xNom,
      outcome.x,
      ctx,
      barriersFromVector(outcome.x, ctx),
      slack,
      signReports,
      outcome,
    ),
  };
}

function infeasibleResult(
  xNom: number[],
  ctx: ProjectionContext,
  signReports: SignConsistencyTelemetry[],
  outcome: SolveOutcome,
): SafetyProjectionResult {
  // The feasible set is empty. There is no action to hand back, and handing
  // back a zero action would read to the caller as a successful no-op.
  return {
    verdict: "infeasible",
    action: null,
    telemetry: buildTelemetry(
      xNom,
      outcome.x,
      ctx,
      barriersFromVector(outcome.x, ctx),
      ctx.limits.maxSlackUsd,
      signReports,
      outcome,
    ),
  };
}

function refusalTelemetry(
  xNom: number[],
  ctx: ProjectionContext,
  signReports: SignConsistencyTelemetry[],
): ProjectionTelemetry {
  const base = buildTelemetry(xNom, xNom, ctx, barriersFromVector(xNom, ctx), 0, signReports, {
    iterations: 0,
    converged: true,
  });
  base.constraints.push({
    name: "sign_consistency",
    slackProposed: -1,
    slackProjected: -1,
    active: true,
    binding: true,
    tightness: 1,
    slackUsedUsd: 0,
  });
  base.activeConstraints.push("sign_consistency");
  base.bindingConstraints.push("sign_consistency");
  base.tightestConstraint = "sign_consistency";
  return base;
}

function buildTelemetry(
  xNom: number[],
  x: number[],
  ctx: ProjectionContext,
  h: BarrierValues,
  slack: number,
  signReports: SignConsistencyTelemetry[],
  outcome: { iterations: number; converged: boolean },
): ProjectionTelemetry {
  const hNom = barriersFromVector(xNom, ctx);
  const moved = xNom.some((v, i) => Math.abs(v - x[i]!) > TOL);
  const scales = barrierScales(ctx);

  const constraints: ConstraintTelemetry[] = HARD_CONSTRAINTS.map((name) => {
    const projected = h[name];
    const active = projected < 0 || Math.abs(projected) <= 1e-6;
    return {
      name: name as ConstraintName,
      slackProposed: hNom[name],
      slackProjected: projected,
      active,
      binding: moved && active && dropChangesAnswer(name as ConstraintName, xNom, x, ctx, slack),
      tightness: tightness(projected, scales[name as ConstraintName]),
      slackUsedUsd: Math.max(0, -projected),
    };
  });

  const tightest = constraints
    .filter((c) => c.binding)
    .sort((a, b) => b.tightness - a.tightness || a.name.localeCompare(b.name))[0];

  let utilisation = 0;
  for (let i = 0; i < ctx.n; i++) {
    if (ctx.rateLimit[i]! <= 0) continue;
    utilisation = Math.max(utilisation, (ctx.rateUsed[i]! + Math.abs(x[i]!)) / ctx.rateLimit[i]!);
  }

  let sq = 0;
  for (let i = 0; i < ctx.n; i++) sq += ctx.weight[i]! * (x[i]! - xNom[i]!) ** 2;

  return {
    constraints,
    activeConstraints: constraints.filter((c) => c.active).map((c) => c.name),
    bindingConstraints: constraints.filter((c) => c.binding).map((c) => c.name),
    tightestConstraint: tightest ? tightest.name : null,
    rateLimitUtilisation: utilisation,
    deviation: Math.sqrt(sq),
    deviationPerLeg: ctx.symbols.map((symbol, i) => ({ symbol, delta: x[i]! - xNom[i]! })),
    signConsistency: signReports,
    totalSlackUsd: constraints.reduce((sum, c) => sum + c.slackUsedUsd, 0),
    iterations: outcome.iterations,
    converged: outcome.converged,
  };
}

/**
 * A constraint is merely active when the answer sits on its boundary; it is
 * binding when removing it moves the answer. Two constraints can be active with
 * only one carrying the projection, and an operator needs to see which.
 */
function dropChangesAnswer(
  name: ConstraintName,
  xNom: number[],
  x: number[],
  ctx: ProjectionContext,
  slack: number,
): boolean {
  const box = buildBox(ctx, slack, BOX_CONSTRAINTS.includes(name) ? name : undefined);
  const without = sweep(
    xNom,
    ctx,
    box,
    name === "leverage" ? Infinity : ctx.leverageRadius + slack,
    name === "drawdown" ? Infinity : ctx.drawdownRadius + slack,
  );
  return without.x.some((v, i) => Math.abs(v - x[i]!) > 1e-5);
}

function barrierScales(ctx: ProjectionContext): Record<ConstraintName, number> {
  return {
    leverage: ctx.leverageRadius,
    drawdown: ctx.limits.maxDrawdownUsd,
    liquidity: ctx.liquidity.reduce((m, v) => Math.max(m, v), 0),
    concentration: ctx.concentration.reduce((m, v) => Math.max(m, v), 0),
    rate_limit: ctx.rateLimit.reduce((m, v) => Math.max(m, v), 0),
    sign_consistency: 1,
  };
}

function tightness(h: number, scale: number): number {
  if (!Number.isFinite(h)) return 0;
  if (scale <= 0) return 1;
  return Math.min(1, Math.max(0, 1 - h / scale));
}

// ============================================================================
// Vector plumbing
// ============================================================================

function toVector(action: readonly ActionLeg[], state: SafetyState): number[] {
  const index = new Map(state.legs.map((leg, i) => [leg.symbol, i]));
  const x = new Array<number>(state.legs.length).fill(0);
  for (const leg of action) {
    const i = index.get(leg.symbol);
    if (i === undefined) {
      throw new Error(`safety-projection: action leg ${leg.symbol} has no matching leg state`);
    }
    x[i] = leg.notionalDelta;
  }
  return x;
}
