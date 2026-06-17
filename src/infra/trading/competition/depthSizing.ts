/**
 * Depth-aware order sizing for FOK/IOC reconcile orders.
 *
 * Cypher executes FOK/IOC (immediate-or-cancel) against REAL L2 depth limits
 * (e.g. gold ~100 oz top-of-book). A raw market order that exceeds available
 * depth partial-fills or NO-fills, so the target book never establishes.
 *
 * Usage: the reconciler fetches `client.depth(symbol)`, picks the relevant
 * side's levels (asks when buying, bids when selling), and clamps each
 * reconcile order via `clampToDepth` so the FOK/IOC order fills instead of
 * bouncing. Because reconcile is idempotent, any remaining gap is closed on
 * subsequent cycles once fresh depth refills the book.
 *
 * PURE module: no imports, defines its own minimal types.
 */

export interface DepthLevel {
  /** Price at this level. */
  price: number;
  /** Volume in lots/units available at this level. Top-of-book first. */
  volume: number;
}

export interface ClampToDepthOptions {
  /** Only sum the first N levels of the book. Default: all levels. */
  maxLevels?: number;
  /**
   * Fraction of summed depth to treat as fillable (0..1). Default 1.
   * Use e.g. 0.5 to leave a margin so a FOK doesn't fail against a thin book.
   */
  fillFraction?: number;
}

export interface ClampToDepthResult {
  /** Clamped order size, with the sign (and zero) of `targetLots` preserved. */
  fillableLots: number;
  /** Total fillable depth = summed volume over maxLevels × fillFraction. */
  availableLots: number;
  /** True when the requested |targetLots| exceeded availableLots. */
  capped: boolean;
}

/**
 * Clamp a target order size to what the order book can actually fill.
 *
 * @param targetLots Desired order size; sign indicates direction (caller may
 *   pass a signed delta). The result preserves this sign; 0 → 0.
 * @param side       "buy" or "sell" — informational for the caller's level
 *   selection; the math operates on whatever levels are passed.
 * @param levels     Relevant side's depth levels, top-of-book first.
 * @param opts       `maxLevels` (default all) and `fillFraction` (default 1).
 */
export function clampToDepth(
  targetLots: number,
  side: "buy" | "sell",
  levels: readonly DepthLevel[],
  opts?: ClampToDepthOptions,
): ClampToDepthResult {
  const fillFraction = opts?.fillFraction ?? 1;
  const maxLevels = opts?.maxLevels ?? Number.POSITIVE_INFINITY;

  const target = Number.isFinite(targetLots) ? targetLots : 0;
  const magnitude = Math.abs(target);

  if (!Array.isArray(levels) || levels.length === 0) {
    return { fillableLots: 0, availableLots: 0, capped: magnitude > 0 };
  }

  let summed = 0;
  const limit = Math.min(levels.length, Math.max(0, Math.floor(maxLevels)));
  for (let i = 0; i < limit; i++) {
    const volume = levels[i]?.volume;
    if (Number.isFinite(volume) && volume > 0) {
      summed += volume;
    }
  }

  const availableLots = summed * fillFraction;
  const fillableMagnitude = Math.min(magnitude, availableLots);
  const sign = target < 0 ? -1 : 1;

  return {
    fillableLots: target === 0 ? 0 : sign * fillableMagnitude,
    availableLots,
    capped: magnitude > availableLots,
  };
}
