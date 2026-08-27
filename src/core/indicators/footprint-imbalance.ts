/**
 * Diagonal footprint imbalance + stacked-imbalance zones.
 *
 * The canonical footprint read: compare aggressive volume on the DIAGONAL, not
 * the same level. An ASK (buy) imbalance at price P means the ask volume at P
 * overwhelmed the bid volume one tick BELOW (P−1) by ≥ threshold× — aggressive
 * buyers lifting offers faster than sellers refill. A BID (sell) imbalance at P
 * compares bid volume at P to ask volume one tick ABOVE (P+1). Runs of ≥
 * `minStacked` consecutive same-side imbalances are "stacked" — strong
 * momentum / a reactive S/R shelf.
 *
 * Distinct from `delta-ladder` (same-level buy−sell delta). Direct-input: pass a
 * footprint (per-price-level buy/sell volume). Pure; never throws.
 */

export interface FootprintLevel {
  priceLevel: number;
  buyVolume: number;
  sellVolume: number;
}

export interface FootprintImbalanceInput {
  levels: FootprintLevel[];
  /** Ratio that counts as an imbalance (e.g. 3 = 300% / 3:1). Default 3. */
  threshold?: number;
  /** Consecutive same-side imbalances to form a stacked zone. Default 3. */
  minStacked?: number;
}

export interface ImbalanceMarker {
  priceLevel: number;
  side: "buy" | "sell";
  /** Diagonal ratio (Infinity when the opposing diagonal cell is empty). */
  ratio: number;
}

export interface StackedZone {
  side: "buy" | "sell";
  priceLow: number;
  priceHigh: number;
  count: number;
}

export interface FootprintImbalanceResult {
  markers: ImbalanceMarker[];
  stackedZones: StackedZone[];
  buyImbalanceCount: number;
  sellImbalanceCount: number;
  interpretation: string;
}

const roundRatio = (x: number): number =>
  Number.isFinite(x) ? parseFloat(x.toFixed(2)) : Infinity;

export function computeFootprintImbalance(
  input: FootprintImbalanceInput,
): FootprintImbalanceResult {
  const threshold = input.threshold && input.threshold > 1 ? input.threshold : 3;
  const minStacked = Math.max(2, Math.floor(input.minStacked ?? 3));
  const levels = [...input.levels].sort((a, b) => a.priceLevel - b.priceLevel);
  const n = levels.length;

  const markers: ImbalanceMarker[] = [];
  if (n >= 2) {
    for (let i = 0; i < n; i++) {
      const lvl = levels[i]!;
      // Ask/buy imbalance: buy@P vs sell@(P−1 tick) — the level below.
      if (i >= 1 && lvl.buyVolume > 0) {
        const below = levels[i - 1]!.sellVolume;
        if (lvl.buyVolume >= threshold * below) {
          markers.push({
            priceLevel: lvl.priceLevel,
            side: "buy",
            ratio: roundRatio(below > 0 ? lvl.buyVolume / below : Infinity),
          });
        }
      }
      // Bid/sell imbalance: sell@P vs buy@(P+1 tick) — the level above.
      if (i <= n - 2 && lvl.sellVolume > 0) {
        const above = levels[i + 1]!.buyVolume;
        if (lvl.sellVolume >= threshold * above) {
          markers.push({
            priceLevel: lvl.priceLevel,
            side: "sell",
            ratio: roundRatio(above > 0 ? lvl.sellVolume / above : Infinity),
          });
        }
      }
    }
  }

  // Stacked zones: runs of ≥ minStacked consecutive same-side markers (markers
  // are emitted in ascending price order, so consecutive entries are adjacent).
  const stackedZones: StackedZone[] = [];
  let runStart = 0;
  for (let i = 1; i <= markers.length; i++) {
    const sameSide = i < markers.length && markers[i]!.side === markers[runStart]!.side;
    if (!sameSide) {
      const len = i - runStart;
      if (len >= minStacked) {
        stackedZones.push({
          side: markers[runStart]!.side,
          priceLow: markers[runStart]!.priceLevel,
          priceHigh: markers[i - 1]!.priceLevel,
          count: len,
        });
      }
      runStart = i;
    }
  }

  const buyImbalanceCount = markers.filter((m) => m.side === "buy").length;
  const sellImbalanceCount = markers.filter((m) => m.side === "sell").length;
  const interpretation =
    markers.length === 0
      ? "no diagonal imbalances"
      : `${buyImbalanceCount} buy / ${sellImbalanceCount} sell diagonal imbalance(s)` +
        (stackedZones.length > 0
          ? `; ${stackedZones.length} stacked zone(s): ${stackedZones.map((z) => `${z.side} [${z.priceLow}-${z.priceHigh}]×${z.count}`).join(", ")}`
          : "");

  return { markers, stackedZones, buyImbalanceCount, sellImbalanceCount, interpretation };
}
