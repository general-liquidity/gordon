/**
 * Ring-fence accounting for the competition BARBELL structure.
 *
 * The optimal competition shape is a barbell: a low-variance Sharpe-core holding
 * most of the capital (it wins the controllable Best-Sharpe + Drawdown ranks) plus
 * a small ring-fenced lottery sleeve — one late, concentrated, leveraged bet that
 * acts as a cheap call option on the #1 return prize.
 *
 * The ring-fence is the accounting boundary that makes the barbell safe: the sleeve
 * is carved off the core ONCE, its worst-case loss is bounded to the reserve, and
 * the two pools are kept accounted separately so a sleeve blow-up draws only the
 * reserve and CANNOT touch the core or push the total below the red-line. A sleeve
 * loss equal to the entire reserve must leave the core intact and total ≥ red-line.
 *
 * Pure state machine: the caller holds `RingFenceState`; every function here is a
 * pure transition. Validation happens only at the `createRingFence` boundary.
 */

export interface RingFenceState {
  /** Core + sleeve reserve + sleeve P&L. The full account equity. */
  totalEquity: number;
  /** Sharpe-core equity. Never drawn down by sleeve losses. */
  coreEquity: number;
  /** Capital carved off for the lottery sleeve, not yet deployed. */
  sleeveReserve: number;
  /** Capital currently committed to a live sleeve bet (out of the reserve). */
  sleeveDeployed: number;
  /** Realized + unrealized P&L attributable to the sleeve. */
  sleevePnL: number;
  /** Account floor — total must stay ≥ this (the disqualification red-line). */
  redLineEquity: number;
}

export interface CreateRingFenceInput {
  totalEquity: number;
  /** Fraction of total carved into the sleeve reserve. 0 ≤ f < 1. */
  sleeveFraction: number;
  redLineEquity: number;
}

/**
 * Carve `sleeveFraction · totalEquity` off the core into the sleeve reserve.
 * Validates (boundary): finite inputs, 0 ≤ sleeveFraction < 1, and that the core
 * after carving still sits strictly above the red-line.
 */
export function createRingFence(input: CreateRingFenceInput): RingFenceState {
  const { totalEquity, sleeveFraction, redLineEquity } = input;

  if (!Number.isFinite(totalEquity) || totalEquity <= 0) {
    throw new Error(`ringFence: totalEquity must be a positive finite number, got ${totalEquity}`);
  }
  if (!Number.isFinite(sleeveFraction) || sleeveFraction < 0 || sleeveFraction >= 1) {
    throw new Error(`ringFence: sleeveFraction must be in [0, 1), got ${sleeveFraction}`);
  }
  if (!Number.isFinite(redLineEquity) || redLineEquity < 0) {
    throw new Error(`ringFence: redLineEquity must be a non-negative finite number, got ${redLineEquity}`);
  }

  const sleeveReserve = sleeveFraction * totalEquity;
  const coreEquity = totalEquity - sleeveReserve;

  if (coreEquity <= redLineEquity) {
    throw new Error(
      `ringFence: carving ${sleeveFraction} would leave core ${coreEquity} at/below red-line ${redLineEquity}`,
    );
  }

  return {
    totalEquity,
    coreEquity,
    sleeveReserve,
    sleeveDeployed: 0,
    sleevePnL: 0,
    redLineEquity,
  };
}

/**
 * The most the sleeve can lose without the TOTAL breaching the red-line.
 * = min(sleeveReserve, totalEquity − redLineEquity). The sleeve must be sized so
 * its worst case is ≤ this. Clamped at 0 (never negative).
 */
export function maxSleeveLoss(state: RingFenceState): number {
  const headroom = state.totalEquity - state.redLineEquity;
  return Math.max(0, Math.min(state.sleeveReserve, headroom));
}

export interface DeployDecision {
  allowed: boolean;
  /** Worst-case loss the bet exposes (notional · liqDistance). */
  worstCaseLoss: number;
  budget: number;
  reason: string;
}

/**
 * A levered worst-case loss approximation: a position of `notional` at `leverage`
 * is liquidated after an adverse move of (1 / leverage), so the controllable loss
 * is the notional itself (you can lose the full margin committed). We treat the
 * bet's worst-case loss as the `notional` posted as margin — the sleeve commits
 * `notional` of reserve, and `leverage` amplifies the exposure but not the capital
 * at risk beyond the posted margin. Liquidation caps the loss at the margin.
 */
export function canDeploySleeve(
  state: RingFenceState,
  notional: number,
  leverage: number,
): DeployDecision {
  const budget = maxSleeveLoss(state);

  if (!Number.isFinite(notional) || notional < 0) {
    return { allowed: false, worstCaseLoss: NaN, budget, reason: `invalid notional ${notional}` };
  }
  if (!Number.isFinite(leverage) || leverage < 1) {
    return { allowed: false, worstCaseLoss: NaN, budget, reason: `invalid leverage ${leverage} (must be ≥ 1)` };
  }

  // Margin posted = notional / leverage; liquidation caps loss at the margin posted.
  // Worst-case capital at risk is the posted margin, never more (liquidation stops it).
  const worstCaseLoss = notional / leverage;

  if (worstCaseLoss > state.sleeveReserve - state.sleeveDeployed) {
    return {
      allowed: false,
      worstCaseLoss,
      budget,
      reason: `worst-case ${worstCaseLoss} exceeds undeployed reserve ${state.sleeveReserve - state.sleeveDeployed}`,
    };
  }
  if (worstCaseLoss > budget) {
    return {
      allowed: false,
      worstCaseLoss,
      budget,
      reason: `worst-case ${worstCaseLoss} exceeds maxSleeveLoss ${budget}`,
    };
  }

  return { allowed: true, worstCaseLoss, budget, reason: "within sleeve budget" };
}

/** Pure: apply core P&L. Core and total move; sleeve pools untouched. */
export function applyCorePnL(state: RingFenceState, pnl: number): RingFenceState {
  const coreEquity = state.coreEquity + pnl;
  return {
    ...state,
    coreEquity,
    totalEquity: coreEquity + state.sleeveReserve + state.sleevePnL,
  };
}

/**
 * Pure: apply sleeve P&L. The sleeve's accumulated P&L moves and the total reflects
 * it, but the core is NEVER touched — a sleeve loss draws only the reserve. The
 * reserve is the cap: cumulative sleeve P&L is floored at −sleeveReserve so the
 * sleeve can never bleed past what was carved for it into the core.
 */
export function applySleevePnL(state: RingFenceState, pnl: number): RingFenceState {
  const sleevePnL = Math.max(-state.sleeveReserve, state.sleevePnL + pnl);
  return {
    ...state,
    sleevePnL,
    totalEquity: state.coreEquity + state.sleeveReserve + sleevePnL,
  };
}

/**
 * True when the total has fallen below the red-line. Sitting exactly on the red-line
 * is the safe edge (total ≥ redLine is the survival condition), so this is strict `<`
 * — losing exactly `maxSleeveLoss` lands on the line without breaching.
 */
export function breachesRedLine(state: RingFenceState): boolean {
  return state.totalEquity < state.redLineEquity;
}

export function formatRingFence(state: RingFenceState): string {
  const fmt = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 2 });
  return [
    `RingFence  total=${fmt(state.totalEquity)}  redLine=${fmt(state.redLineEquity)}`,
    `  core=${fmt(state.coreEquity)}`,
    `  sleeve  reserve=${fmt(state.sleeveReserve)}  deployed=${fmt(state.sleeveDeployed)}  pnl=${fmt(state.sleevePnL)}`,
    `  maxSleeveLoss=${fmt(maxSleeveLoss(state))}  breached=${breachesRedLine(state)}`,
  ].join("\n");
}
