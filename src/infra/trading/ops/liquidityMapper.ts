/**
 * Liquidity Mapper (GORDON_LIQUIDITY_MAPPER).
 *
 * Port of Ch 12 from Wright. Stop-clusters are predictable: retail
 * places stops at round numbers, just below obvious support levels,
 * and just past widely-watched moving averages. Sophisticated
 * participants treat those clusters as targets — "stop hunting" is
 * just liquidity provision by another name.
 *
 *   "Ask 'where is the pain?' not 'where will it bounce?'"
 *
 * Concrete primitive: given current price + known structural levels +
 * a set of round-number candidates, score likely stop-cluster zones.
 * Output ranked list of zones with cluster strength. Composes with
 * `confluenceScorer` (the `liquidity_pool` ConfluenceKind already
 * exists — this is the producer for that signal).
 */

export type ZoneKind =
  | "support"
  | "resistance"
  | "round_number"
  | "moving_average"
  | "session_high"
  | "session_low";

export interface StructuralLevel {
  price: number;
  kind: ZoneKind;
  /** Number of times this level has been tested. More tests = more clustered stops. */
  testCount?: number;
  /** Optional label for reporting. */
  label?: string;
}

export interface LiquidityMapInput {
  currentPrice: number;
  /** Buffer (price units) below support / above resistance where stops typically cluster. */
  stopBufferPriceUnits: number;
  levels: ReadonlyArray<StructuralLevel>;
  /** Optional: instrument tick size used to identify round-number magnetism. */
  roundNumberInterval?: number;
}

export interface LiquidityZone {
  price: number;
  side: "below" | "above";
  /** Aggregate cluster strength score (higher = more stops). */
  strength: number;
  sources: ZoneKind[];
  distance: number;
}

export interface LiquidityMapResult {
  zonesBelow: LiquidityZone[];
  zonesAbove: LiquidityZone[];
  nearestBelow: LiquidityZone | null;
  nearestAbove: LiquidityZone | null;
}

function strengthFromLevel(level: StructuralLevel): number {
  const base =
    level.kind === "support" || level.kind === "resistance"
      ? 3
      : level.kind === "moving_average"
        ? 2
        : 1;
  const reinforced = level.testCount ? Math.min(level.testCount, 5) : 1;
  return base * reinforced;
}

function mergeZones(zones: LiquidityZone[]): LiquidityZone[] {
  const merged: LiquidityZone[] = [];
  for (const zone of zones) {
    const existing = merged.find(
      (z) => z.side === zone.side && Math.abs(z.price - zone.price) < 1e-6,
    );
    if (existing) {
      existing.strength += zone.strength;
      for (const s of zone.sources) {
        if (!existing.sources.includes(s)) existing.sources.push(s);
      }
    } else {
      merged.push({ ...zone, sources: [...zone.sources] });
    }
  }
  return merged;
}

export function mapLiquidity(input: LiquidityMapInput): LiquidityMapResult {
  const zones: LiquidityZone[] = [];
  for (const level of input.levels) {
    if (level.kind === "support" || level.kind === "session_low") {
      const target = level.price - input.stopBufferPriceUnits;
      zones.push({
        price: target,
        side: "below",
        strength: strengthFromLevel(level),
        sources: [level.kind],
        distance: input.currentPrice - target,
      });
    } else if (level.kind === "resistance" || level.kind === "session_high") {
      const target = level.price + input.stopBufferPriceUnits;
      zones.push({
        price: target,
        side: "above",
        strength: strengthFromLevel(level),
        sources: [level.kind],
        distance: target - input.currentPrice,
      });
    } else if (level.kind === "moving_average") {
      const target = level.price - input.stopBufferPriceUnits;
      zones.push({
        price: target,
        side: target < input.currentPrice ? "below" : "above",
        strength: strengthFromLevel(level),
        sources: [level.kind],
        distance: Math.abs(input.currentPrice - target),
      });
    } else if (level.kind === "round_number") {
      const side = level.price < input.currentPrice ? "below" : "above";
      zones.push({
        price:
          side === "below"
            ? level.price - input.stopBufferPriceUnits
            : level.price + input.stopBufferPriceUnits,
        side,
        strength: strengthFromLevel(level),
        sources: ["round_number"],
        distance: Math.abs(input.currentPrice - level.price),
      });
    }
  }

  const merged = mergeZones(zones);
  const below = merged
    .filter((z) => z.side === "below" && z.distance > 0)
    .sort((a, b) => a.distance - b.distance);
  const above = merged
    .filter((z) => z.side === "above" && z.distance > 0)
    .sort((a, b) => a.distance - b.distance);

  return {
    zonesBelow: below,
    zonesAbove: above,
    nearestBelow: below[0] ?? null,
    nearestAbove: above[0] ?? null,
  };
}

export function liquidityToPayload(result: LiquidityMapResult): Record<string, unknown> {
  return {
    kind: "liquidity_mapper.mapped",
    nearestBelow: result.nearestBelow
      ? { price: result.nearestBelow.price, strength: result.nearestBelow.strength }
      : null,
    nearestAbove: result.nearestAbove
      ? { price: result.nearestAbove.price, strength: result.nearestAbove.strength }
      : null,
    zoneCount: result.zonesBelow.length + result.zonesAbove.length,
  };
}
