/**
 * MA-Proximity Surf Classifier
 *
 * Qullamaggie's "surfing the MA" hierarchy: a setup is only trade-
 * ready when price is hugging the rising 10/21/50 SMA closely enough
 * that the stop placed just below the MA implies risk ≤ 3%. Deeper
 * MAs (50 > 21 > 10) are rarer but offer better R:R because the
 * entry is closer to the move's origin.
 *
 * Input: current price, ADR (in price units), and the three MAs
 * (assumed already computed by caller; primitive is pure).
 *
 * Output:
 *   - surfingMa:        which MA price is hugging (within 1×ADR)
 *   - stopUnderMaPct:   % stop distance if placed just below that MA
 *   - rrTier:           premium / good / acceptable / wide / extended
 *   - readyForBreakout: true iff stopUnderMaPct ≤ 3%
 *   - extensionPct:     (price − chosen MA) / MA — how stretched
 *
 * Composes with:
 *   - `compute_margin_of_error` (breakout-long is in-sync when struct
 *     is trending — both must agree before sizing)
 *   - `analyze_vcp_contraction`  (the WHAT setup — coiled)
 *   - `detect_streak`           (the WHY — exhausted from a power move)
 *
 * Pure function.
 */

export interface MaProximityInput {
  /** Current price. */
  price: number;
  /** Average Daily Range in the same price units. Used for proximity test. */
  adr: number;
  /** Current value of the rising 10 SMA. Optional. */
  sma10?: number;
  /** Current value of the rising 21 SMA. Optional. */
  sma21?: number;
  /** Current value of the rising 50 SMA. Optional. */
  sma50?: number;
  /** Maximum stop-as-%-of-price for "ready" verdict. Default 3.0. */
  maxStopPct?: number;
  /** Buffer applied below MA when computing stop (price units). Default 0. */
  stopBufferAbsolute?: number;
  /** Multiple of ADR within which price counts as "hugging" the MA. Default 1.0. */
  proximityAdrMultiple?: number;
}

export type SurfingMa = "10" | "21" | "50" | "extended";
export type RrTier = "premium" | "good" | "acceptable" | "wide" | "extended";

export interface MaProximityResult {
  surfingMa: SurfingMa;
  /** The MA value used for the verdict. null when extended. */
  chosenMa: number | null;
  /** Stop placed just below chosenMa expressed as % of current price. */
  stopUnderMaPct: number;
  /** (price − chosenMa) / chosenMa. null when extended. */
  extensionPct: number | null;
  readyForBreakout: boolean;
  rrTier: RrTier;
  summary: string;
}

const DEFAULT_MAX_STOP_PCT = 3.0;
const DEFAULT_STOP_BUFFER = 0;
const DEFAULT_PROXIMITY_ADR = 1.0;

function classifyRrTier(stopPct: number, surfing: SurfingMa): RrTier {
  if (surfing === "extended") return "extended";
  if (stopPct <= 1.5) return "premium";
  if (stopPct <= 2.5) return "good";
  if (stopPct <= 3.0) return "acceptable";
  return "wide";
}

export function classifyMaProximity(input: MaProximityInput): MaProximityResult {
  const maxStopPct = input.maxStopPct ?? DEFAULT_MAX_STOP_PCT;
  const buffer = input.stopBufferAbsolute ?? DEFAULT_STOP_BUFFER;
  const proxMult = input.proximityAdrMultiple ?? DEFAULT_PROXIMITY_ADR;

  if (input.price <= 0 || input.adr <= 0) {
    return {
      surfingMa: "extended",
      chosenMa: null,
      stopUnderMaPct: Infinity,
      extensionPct: null,
      readyForBreakout: false,
      rrTier: "extended",
      summary: "Invalid price or ADR — cannot classify.",
    };
  }

  const threshold = proxMult * input.adr;
  const candidates: Array<{ label: SurfingMa; value: number }> = [];
  if (input.sma10 !== undefined && Math.abs(input.price - input.sma10) <= threshold) {
    candidates.push({ label: "10", value: input.sma10 });
  }
  if (input.sma21 !== undefined && Math.abs(input.price - input.sma21) <= threshold) {
    candidates.push({ label: "21", value: input.sma21 });
  }
  if (input.sma50 !== undefined && Math.abs(input.price - input.sma50) <= threshold) {
    candidates.push({ label: "50", value: input.sma50 });
  }

  // Qullamaggie hierarchy: 10 (fastest), then 21, then 50 (rarest, best R:R)
  // when price is near several at once. We pick the SHORTEST that qualifies
  // for speed; the chosen MA produces the surfingMa label.
  if (candidates.length === 0) {
    return {
      surfingMa: "extended",
      chosenMa: null,
      stopUnderMaPct: Infinity,
      extensionPct: null,
      readyForBreakout: false,
      rrTier: "extended",
      summary:
        `Price ${input.price.toFixed(2)} is more than ${proxMult.toFixed(1)}× ADR ($${input.adr.toFixed(2)}) ` +
        "from any of the supplied MAs. Setup not ready — wait for MAs to catch up.",
    };
  }

  const chosen = candidates[0]!;
  const stopPrice = Math.max(0, chosen.value - buffer);
  const stopUnderMaPct = ((input.price - stopPrice) / input.price) * 100;
  const extensionPct = (input.price - chosen.value) / chosen.value;
  const readyForBreakout = stopUnderMaPct <= maxStopPct;
  const rrTier = classifyRrTier(stopUnderMaPct, chosen.label);

  const summary =
    `Surfing ${chosen.label} SMA. Stop under MA = ${stopUnderMaPct.toFixed(2)}% (limit ${maxStopPct}%) → ` +
    `${readyForBreakout ? "READY" : "NOT ready"}. R:R tier: ${rrTier}. ` +
    `Extension ${(extensionPct * 100).toFixed(2)}% above MA.`;

  return {
    surfingMa: chosen.label,
    chosenMa: chosen.value,
    stopUnderMaPct: parseFloat(stopUnderMaPct.toFixed(4)),
    extensionPct: parseFloat(extensionPct.toFixed(4)),
    readyForBreakout,
    rrTier,
    summary,
  };
}

export function formatMaProximity(result: MaProximityResult): string {
  const lines = [
    `MA Proximity — surfing ${result.surfingMa}`,
    "",
    `  Chosen MA value: ${result.chosenMa !== null ? result.chosenMa.toFixed(2) : "—"}`,
    `  Stop under MA: ${Number.isFinite(result.stopUnderMaPct) ? `${result.stopUnderMaPct.toFixed(2)}%` : "∞"}`,
    `  Extension: ${result.extensionPct !== null ? `${(result.extensionPct * 100).toFixed(2)}%` : "—"}`,
    `  Ready for breakout: ${result.readyForBreakout ? "yes" : "no"}`,
    `  R:R tier: ${result.rrTier}`,
    "",
    `Summary: ${result.summary}`,
  ];
  return lines.join("\n");
}
