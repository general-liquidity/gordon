/**
 * Game-Type Classifier: positive-sum / zero-sum / negative-sum.
 *
 * Frames the structural question "who funds this edge?" before any alpha
 * claim. A trade lives inside a game defined by three structural facts:
 *
 *   1. instrument class     - does the instrument have INTRINSIC value
 *                             generation (a claim on production: real
 *                             yield / dividends / carry / staking / beta),
 *                             or is it a pure transfer instrument (a
 *                             derivative that nets to zero across
 *                             counterparties, or a non-yielding store)?
 *   2. fee / funding / borrow drag - the leakage every participant pays
 *                             regardless of skill (trading fees, expense
 *                             ratios, perp funding, short borrow, margin
 *                             interest). This subtracts from the pool.
 *   3. counterparty structure - who sits across the trade: the real
 *                             economy / issuer (a claim can grow the pie),
 *                             a peer trader (netting - my gain is their
 *                             loss), or the house / venue (a structural
 *                             rake - a casino is negative-sum by design).
 *
 * The aggregate edge pool per year:
 *
 *   netEdgePerYear = generation - totalDrag
 *
 * where `generation` is credited ONLY when the instrument is a productive
 * asset backed by a claim on production (a future does not create wealth;
 * a non-yielding store does not either), and `totalDrag` is the sum of the
 * fee / funding / borrow leakage plus any explicit house edge.
 *
 *   netEdgePerYear >  epsilon  -> positive-sum  (real value funds the edge)
 *   |netEdgePerYear| <= epsilon -> zero-sum      (pure skill transfer)
 *   netEdgePerYear < -epsilon  -> negative-sum  (participants fund the venue)
 *
 * Configurable, no hardcoded venues. The caller supplies the structural
 * categories and the annualized drags; nothing here references a specific
 * exchange, product, or ticker. Pure function.
 */

/**
 * Structural class of the instrument.
 *   productive_asset - a claim on production with intrinsic value
 *                      generation (equity, real-yield bond, staked asset,
 *                      cash-and-carry, dividend/beta exposure).
 *   derivative       - a netting contract (future, perp, option, swap,
 *                      CFD, FX) whose payoff sums to zero across the two
 *                      sides before costs.
 *   non_yielding_store - a spot asset with no cashflow (gold, a
 *                      non-staked store-of-value coin, a collectible):
 *                      no intrinsic generation, real return is a transfer
 *                      among holders.
 */
export type InstrumentClass = "productive_asset" | "derivative" | "non_yielding_store";

/**
 * Who sits across the trade.
 *   issuer_or_production - the real economy / issuer; the pie can grow.
 *   peer_netting         - another trader; the game nets to zero pre-cost.
 *   house_or_venue       - a venue / AMM / structured-product issuer that
 *                          takes a structural rake (adverse-selection edge,
 *                          markup, spread capture).
 */
export type CounterpartyStructure = "issuer_or_production" | "peer_netting" | "house_or_venue";

export type GameType = "positive_sum" | "zero_sum" | "negative_sum";

export interface GameTypeInputs {
  instrumentClass: InstrumentClass;
  counterparty: CounterpartyStructure;
  /**
   * Intrinsic annualized value generation as a decimal (e.g. 0.05 = 5%
   * real yield / dividend / carry / expected beta drift). Credited ONLY
   * when the instrument is a productive_asset backed by a claim on
   * production. Default 0.
   */
  realYieldAnnualized?: number;
  /** Annualized trading fees / expense ratio, decimal. Default 0. */
  feeDragAnnualized?: number;
  /** Annualized perp funding paid, decimal. Default 0. */
  fundingDragAnnualized?: number;
  /** Annualized short-borrow / margin interest, decimal. Default 0. */
  borrowDragAnnualized?: number;
  /**
   * Explicit house rake as an annualized decimal - the structural edge a
   * venue / AMM / product issuer extracts. Only meaningful when
   * counterparty is house_or_venue. Default 0.
   */
  houseEdgeAnnualized?: number;
}

export interface GameTypeOptions {
  /**
   * Dead-band around zero. |netEdgePerYear| within epsilon classifies as
   * zero-sum. Default 0.005 (50 bps/yr).
   */
  epsilon?: number;
}

export interface GameTypeResult {
  gameType: GameType;
  /** generation - totalDrag, annualized decimal. */
  netEdgePerYear: number;
  /** Intrinsic generation credited (0 unless a productive-asset claim). */
  generation: number;
  /** feeDrag + fundingDrag + borrowDrag + houseEdge. */
  totalDrag: number;
  /** Plain-English answer to "who funds this edge?". */
  whoFundsEdge: string;
  components: {
    instrumentClass: InstrumentClass;
    counterparty: CounterpartyStructure;
    realYieldAnnualized: number;
    feeDragAnnualized: number;
    fundingDragAnnualized: number;
    borrowDragAnnualized: number;
    houseEdgeAnnualized: number;
  };
  reasoning: string;
}

const DEFAULT_EPSILON = 0.005;

function finiteOr(x: number | undefined, fallback: number): number {
  return typeof x === "number" && Number.isFinite(x) ? x : fallback;
}

/**
 * Classify the structural game a trade lives in. Pure function.
 */
export function classifyGameType(
  inputs: GameTypeInputs,
  options: GameTypeOptions = {},
): GameTypeResult {
  const epsilon = Math.abs(finiteOr(options.epsilon, DEFAULT_EPSILON));

  const realYield = finiteOr(inputs.realYieldAnnualized, 0);
  const feeDrag = Math.max(0, finiteOr(inputs.feeDragAnnualized, 0));
  const fundingDrag = Math.max(0, finiteOr(inputs.fundingDragAnnualized, 0));
  const borrowDrag = Math.max(0, finiteOr(inputs.borrowDragAnnualized, 0));
  const houseEdge =
    inputs.counterparty === "house_or_venue"
      ? Math.max(0, finiteOr(inputs.houseEdgeAnnualized, 0))
      : 0;

  // Generation is credited only when there is a genuine claim on
  // production: a productive asset AND an issuer/production counterparty.
  // A derivative or a non-yielding store creates no aggregate wealth, and
  // a claim wrapped by a house/venue is not funded by production.
  const generation =
    inputs.instrumentClass === "productive_asset" && inputs.counterparty === "issuer_or_production"
      ? realYield
      : 0;

  const totalDrag = feeDrag + fundingDrag + borrowDrag + houseEdge;
  const netEdgePerYear = generation - totalDrag;

  let gameType: GameType;
  if (netEdgePerYear > epsilon) gameType = "positive_sum";
  else if (netEdgePerYear < -epsilon) gameType = "negative_sum";
  else gameType = "zero_sum";

  const whoFundsEdge = describeFunding(gameType, inputs.counterparty, generation, totalDrag);
  const reasoning = buildReasoning(gameType, generation, totalDrag, netEdgePerYear, whoFundsEdge);

  return {
    gameType,
    netEdgePerYear,
    generation,
    totalDrag,
    whoFundsEdge,
    components: {
      instrumentClass: inputs.instrumentClass,
      counterparty: inputs.counterparty,
      realYieldAnnualized: realYield,
      feeDragAnnualized: feeDrag,
      fundingDragAnnualized: fundingDrag,
      borrowDragAnnualized: borrowDrag,
      houseEdgeAnnualized: houseEdge,
    },
    reasoning,
  };
}

function describeFunding(
  gameType: GameType,
  counterparty: CounterpartyStructure,
  generation: number,
  totalDrag: number,
): string {
  if (gameType === "positive_sum") {
    return `Real economic value (issuer / production) funds the edge: ${(generation * 100).toFixed(2)}%/yr generation exceeds ${(totalDrag * 100).toFixed(2)}%/yr drag.`;
  }
  if (gameType === "negative_sum") {
    const sink =
      counterparty === "house_or_venue"
        ? "the venue / house (structural rake)"
        : "fees, funding and borrow leakage";
    return `You fund the edge: ${sink} costs ${(totalDrag * 100).toFixed(2)}%/yr against ${(generation * 100).toFixed(2)}%/yr generation. Negative expectancy before any alpha.`;
  }
  return `Another trader funds the edge (peer netting): the pool nets to ~zero before costs. Winners are paid by losers, not by production.`;
}

function buildReasoning(
  gameType: GameType,
  generation: number,
  totalDrag: number,
  netEdgePerYear: number,
  whoFundsEdge: string,
): string {
  const label =
    gameType === "positive_sum"
      ? "POSITIVE-SUM"
      : gameType === "negative_sum"
        ? "NEGATIVE-SUM"
        : "ZERO-SUM";
  return `${label}: net edge pool ${(netEdgePerYear * 100).toFixed(2)}%/yr (generation ${(generation * 100).toFixed(2)}% - drag ${(totalDrag * 100).toFixed(2)}%). ${whoFundsEdge}`;
}

/** Operator-facing one-line summary. */
export function formatGameType(result: GameTypeResult): string {
  return `Game type: ${result.gameType.replace("_", "-")} (net ${(result.netEdgePerYear * 100).toFixed(2)}%/yr). ${result.whoFundsEdge}`;
}
