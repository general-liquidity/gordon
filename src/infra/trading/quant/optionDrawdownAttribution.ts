/**
 * Option-position drawdown cause attribution.
 *
 * A long option that is deep underwater (premium down >= a threshold, default
 * 70%) lost its value to some mix of three forces: the underlying moving against
 * the thesis (delta), time decay (theta), and an implied-vol collapse (iv). The
 * rebuy decision hinges on WHICH one did the damage:
 *   - iv_driven  -> the direction thesis is likely intact and vol is now cheaper;
 *                   a fresh contract at the lower IV is attractive.
 *   - theta_driven -> the move never came in time; rebuying just re-pays decay.
 *   - delta_driven -> the underlying went the wrong way; the thesis itself needs
 *                     re-validation before committing again.
 *   - mixed      -> no single dominant cause; research before acting.
 *
 * Attribution is a first-order Greek decomposition when delta/theta/vega are
 * supplied, and a deterministic driver-magnitude heuristic over the four raw
 * inputs (underlying move, DTE elapsed, IV change, premium change) otherwise.
 * Pure; never throws. Configurable threshold + dominance share.
 */

export type OptionDrawdownCause = "delta_driven" | "theta_driven" | "iv_driven" | "mixed" | "none";

export type OptionRebuyVerdict = "StrongBuyNewContract" | "NoRebuyTheta" | "HoldAndResearch";

export interface OptionDrawdownInput {
  optionType: "call" | "put";
  /** Premium paid at entry (per contract, absolute). */
  entryPremium: number;
  /** Current mark premium. */
  currentPremium: number;
  entryUnderlying: number;
  currentUnderlying: number;
  /** Implied vol as a fraction, e.g. 0.60 = 60 vol points. */
  entryIv: number;
  currentIv: number;
  /** Days to expiry at entry. */
  entryDte: number;
  /** Days to expiry now. */
  currentDte: number;
  /** Optional entry delta (signed: calls +, puts -). Enables Greek decomposition. */
  delta?: number;
  /** Optional theta per calendar day (negative for a long option). */
  theta?: number;
  /** Optional vega = dPremium per 1.00 (100 vol-point) change in IV. */
  vega?: number;
  /** Premium-drawdown fraction that arms the classifier. Default 0.70. */
  drawdownThreshold?: number;
  /** Share of adverse magnitude one driver must own to be "dominant". Default 0.60. */
  dominanceShare?: number;
}

export interface OptionDrawdownResult {
  triggered: boolean;
  drawdown: number;
  cause: OptionDrawdownCause;
  verdict: OptionRebuyVerdict;
  /** Fractional shares of the adverse move; sum ~1 when triggered. */
  shares: { delta: number; theta: number; iv: number };
  method: "greeks" | "heuristic";
  interpretation: string;
}

const round = (x: number, p = 4): number => parseFloat(x.toFixed(p));
const clampPos = (x: number): number => (x > 0 ? x : 0);

function verdictFor(cause: OptionDrawdownCause): OptionRebuyVerdict {
  switch (cause) {
    case "iv_driven":
      return "StrongBuyNewContract";
    case "theta_driven":
      return "NoRebuyTheta";
    default:
      return "HoldAndResearch";
  }
}

export function attributeOptionDrawdown(input: OptionDrawdownInput): OptionDrawdownResult {
  const threshold = input.drawdownThreshold ?? 0.7;
  const dominance = input.dominanceShare ?? 0.6;

  const notTriggered = (drawdown: number, reason: string): OptionDrawdownResult => ({
    triggered: false,
    drawdown: round(drawdown),
    cause: "none",
    verdict: "HoldAndResearch",
    shares: { delta: 0, theta: 0, iv: 0 },
    method: input.delta !== undefined && input.vega !== undefined ? "greeks" : "heuristic",
    interpretation: reason,
  });

  if (!(input.entryPremium > 0)) return notTriggered(0, "entryPremium must be > 0");
  if (!(input.entryUnderlying > 0) || !(input.currentUnderlying > 0))
    return notTriggered(0, "underlying prices must be > 0");
  if (!(input.entryDte > 0)) return notTriggered(0, "entryDte must be > 0");

  const drawdown = (input.entryPremium - input.currentPremium) / input.entryPremium;
  if (!(drawdown >= threshold))
    return notTriggered(
      drawdown,
      `premium drawdown ${round(drawdown * 100, 1)}% below the ${round(threshold * 100, 1)}% classifier threshold`,
    );

  const daysElapsed = clampPos(input.entryDte - input.currentDte);
  const ivChange = input.currentIv - input.entryIv;
  const underlyingChange = input.currentUnderlying - input.entryUnderlying;

  let deltaAdverse: number;
  let thetaAdverse: number;
  let ivAdverse: number;
  let method: "greeks" | "heuristic";

  const hasGreeks =
    input.delta !== undefined && input.theta !== undefined && input.vega !== undefined;

  if (hasGreeks) {
    method = "greeks";
    // First-order premium contributions; only the negative (adverse) part counts.
    const deltaContrib = (input.delta as number) * underlyingChange;
    const thetaContrib = (input.theta as number) * daysElapsed;
    const vegaContrib = (input.vega as number) * ivChange;
    deltaAdverse = clampPos(-deltaContrib);
    thetaAdverse = clampPos(-thetaContrib);
    ivAdverse = clampPos(-vegaContrib);
  } else {
    method = "heuristic";
    // Direction is adverse when a call's underlying falls / a put's underlying rises.
    const adverseUnderlyingFrac =
      input.optionType === "call"
        ? clampPos(-underlyingChange) / input.entryUnderlying
        : clampPos(underlyingChange) / input.entryUnderlying;
    // A long option always bleeds theta; the fraction of tenor consumed proxies it.
    const timeDecayFrac = daysElapsed / input.entryDte;
    // A long option is long vega; adverse when IV falls.
    const ivCrushFrac = input.entryIv > 0 ? clampPos(-ivChange) / input.entryIv : 0;
    deltaAdverse = adverseUnderlyingFrac;
    thetaAdverse = timeDecayFrac;
    ivAdverse = ivCrushFrac;
  }

  const total = deltaAdverse + thetaAdverse + ivAdverse;
  const shares =
    total > 0
      ? { delta: deltaAdverse / total, theta: thetaAdverse / total, iv: ivAdverse / total }
      : { delta: 0, theta: 0, iv: 0 };

  let cause: OptionDrawdownCause;
  if (total <= 0) {
    cause = "mixed";
  } else if (shares.delta >= dominance) {
    cause = "delta_driven";
  } else if (shares.theta >= dominance) {
    cause = "theta_driven";
  } else if (shares.iv >= dominance) {
    cause = "iv_driven";
  } else {
    cause = "mixed";
  }

  const verdict = verdictFor(cause);
  const interpretation =
    `long ${input.optionType} down ${round(drawdown * 100, 1)}% -> ${cause} ` +
    `(delta ${round(shares.delta * 100, 0)}% / theta ${round(shares.theta * 100, 0)}% / iv ${round(shares.iv * 100, 0)}%, ${method}) -> ${verdict}`;

  return {
    triggered: true,
    drawdown: round(drawdown),
    cause,
    verdict,
    shares: { delta: round(shares.delta), theta: round(shares.theta), iv: round(shares.iv) },
    method,
    interpretation,
  };
}
