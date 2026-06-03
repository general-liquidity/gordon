export interface InventoryOrderSizeResult {
  bidSize: number;
  askSize: number;
  accumulationSide: "bid" | "ask" | "none";
  reductionFactor: number;
  maxSize: number;
  interpretation: string;
}

const round6 = (x: number): number => parseFloat(x.toFixed(6));

/**
 * Dynamic inventory order-SIZE model from Fushimi / González Rojas / Herman,
 * "Optimal High-Frequency Market Making" (Avellaneda-Stoikov extension).
 *
 * Complements the inventory-adjusted-spread model (which skews the quote PRICE)
 * by scaling order SIZE per side based on signed inventory: shrink the side that
 * would INCREASE |inventory| (the accumulation side), keep the reducing side at
 * full size. Place smaller orders in the direction of excess position accumulation.
 */
export function computeInventoryOrderSize(input: {
  inventory: number;
  maxSize: number;
  shape?: number;
}): InventoryOrderSizeResult {
  const { inventory, maxSize } = input;
  const shape = input.shape == null ? 0.005 : input.shape;

  if (!(maxSize > 0) || !(shape >= 0)) {
    const neutral = round6(Math.max(maxSize, 0));
    return {
      bidSize: neutral,
      askSize: neutral,
      accumulationSide: "none",
      reductionFactor: 1,
      maxSize: neutral,
      interpretation: "invalid inputs",
    };
  }

  const reductionFactor = round6(Math.exp(-shape * Math.abs(inventory)));
  const reduced = round6(maxSize * reductionFactor);
  const full = round6(maxSize);

  if (inventory > 0) {
    return {
      bidSize: reduced,
      askSize: full,
      accumulationSide: "bid",
      reductionFactor,
      maxSize: full,
      interpretation: `long ${inventory}: shrink bid to ${reduced} (don't add to longs), keep ask at ${full} (encourage selling)`,
    };
  }

  if (inventory < 0) {
    return {
      bidSize: full,
      askSize: reduced,
      accumulationSide: "ask",
      reductionFactor,
      maxSize: full,
      interpretation: `short ${inventory}: shrink ask to ${reduced} (don't add to shorts), keep bid at ${full} (encourage buying)`,
    };
  }

  return {
    bidSize: full,
    askSize: full,
    accumulationSide: "none",
    reductionFactor,
    maxSize: full,
    interpretation: `flat: both sides at ${full}, no accumulation skew`,
  };
}
