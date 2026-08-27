/**
 * Supply/Demand Zone Detection
 * Identifies supply (resistance) and demand (support) zones using rolling extremes.
 * Zones are price ranges, not single levels — defined by high/low and close extremes.
 *
 * Supply/Demand Zone implementation.
 */

import type { Candle } from "./types.ts";

export interface SDZone {
  /** Zone type */
  type: "demand" | "supply";
  /** Upper boundary of the zone */
  upper: number;
  /** Lower boundary of the zone */
  lower: number;
  /** Zone midpoint */
  mid: number;
  /** Zone width as percentage of midpoint */
  widthPct: number;
  /** Number of times price has tested this zone */
  tests: number;
  /** Whether the zone is still intact (not broken through) */
  intact: boolean;
}

export interface SDZResult {
  /** Detected demand zones (sorted by proximity to current price) */
  demandZones: SDZone[];
  /** Detected supply zones (sorted by proximity to current price) */
  supplyZones: SDZone[];
  /** Whether price is currently in a demand zone */
  inDemandZone: boolean;
  /** Whether price is currently in a supply zone */
  inSupplyZone: boolean;
  /** Nearest demand zone below current price */
  nearestDemand: SDZone | null;
  /** Nearest supply zone above current price */
  nearestSupply: SDZone | null;
  /** Signal based on zone interaction */
  signal: "demand_bounce" | "supply_rejection" | "breakout_up" | "breakout_down" | "none";
  /** Interpretation string */
  interpretation: string;
}

/**
 * Detect supply and demand zones.
 *
 * @param candles - OHLCV candle array
 * @param lookback - Rolling window for zone detection (default 20)
 * @param minZoneWidth - Minimum zone width as fraction (default 0.001 = 0.1%)
 * @param zoneMergeTolerance - Merge zones within this fraction (default 0.005 = 0.5%)
 * @param maxZones - Maximum number of zones per side (default 5)
 * @returns SDZResult
 */
export function calculateSupplyDemandZones(
  candles: Candle[],
  lookback: number = 20,
  minZoneWidth: number = 0.001,
  zoneMergeTolerance: number = 0.005,
  maxZones: number = 5,
): SDZResult {
  if (candles.length < lookback + 5) {
    return {
      demandZones: [],
      supplyZones: [],
      inDemandZone: false,
      inSupplyZone: false,
      nearestDemand: null,
      nearestSupply: null,
      signal: "none",
      interpretation: "Insufficient data for supply/demand zone detection",
    };
  }

  const currentPrice = candles[candles.length - 1]!.close;
  const rawDemandZones: SDZone[] = [];
  const rawSupplyZones: SDZone[] = [];

  // Scan through candles using rolling windows to find zones
  for (let i = lookback; i < candles.length - 1; i++) {
    const windowCandles = candles.slice(i - lookback, i);

    // Rolling extremes
    let windowCloseMin = Infinity;
    let windowCloseMax = -Infinity;
    let windowLowMin = Infinity;
    let windowHighMax = -Infinity;

    for (const c of windowCandles) {
      if (c.close < windowCloseMin) windowCloseMin = c.close;
      if (c.close > windowCloseMax) windowCloseMax = c.close;
      if (c.low < windowLowMin) windowLowMin = c.low;
      if (c.high > windowHighMax) windowHighMax = c.high;
    }

    // Demand zone: between the rolling low of lows and rolling low of closes
    // This is the "wick zone" below the close support
    const demandLower = windowLowMin;
    const demandUpper = windowCloseMin;

    if (demandUpper > demandLower) {
      const mid = (demandUpper + demandLower) / 2;
      const widthPct = (demandUpper - demandLower) / mid;

      if (widthPct >= minZoneWidth) {
        rawDemandZones.push({
          type: "demand",
          upper: demandUpper,
          lower: demandLower,
          mid,
          widthPct: parseFloat((widthPct * 100).toFixed(3)),
          tests: 0,
          intact: true,
        });
      }
    }

    // Supply zone: between the rolling high of closes and rolling high of highs
    const supplyLower = windowCloseMax;
    const supplyUpper = windowHighMax;

    if (supplyUpper > supplyLower) {
      const mid = (supplyUpper + supplyLower) / 2;
      const widthPct = (supplyUpper - supplyLower) / mid;

      if (widthPct >= minZoneWidth) {
        rawSupplyZones.push({
          type: "supply",
          upper: supplyUpper,
          lower: supplyLower,
          mid,
          widthPct: parseFloat((widthPct * 100).toFixed(3)),
          tests: 0,
          intact: true,
        });
      }
    }
  }

  // Merge overlapping/close zones
  const demandZones = mergeZones(rawDemandZones, zoneMergeTolerance, maxZones);
  const supplyZones = mergeZones(rawSupplyZones, zoneMergeTolerance, maxZones);

  // Count tests and check if intact
  for (const zone of demandZones) {
    for (const c of candles) {
      if (c.low <= zone.upper && c.low >= zone.lower) zone.tests++;
      if (c.close < zone.lower) zone.intact = false;
    }
  }
  for (const zone of supplyZones) {
    for (const c of candles) {
      if (c.high >= zone.lower && c.high <= zone.upper) zone.tests++;
      if (c.close > zone.upper) zone.intact = false;
    }
  }

  // Filter to intact zones and sort by proximity
  const activeDemand = demandZones
    .filter((z) => z.intact || z.tests >= 2)
    .sort((a, b) => Math.abs(currentPrice - a.mid) - Math.abs(currentPrice - b.mid))
    .slice(0, maxZones);

  const activeSupply = supplyZones
    .filter((z) => z.intact || z.tests >= 2)
    .sort((a, b) => Math.abs(currentPrice - a.mid) - Math.abs(currentPrice - b.mid))
    .slice(0, maxZones);

  // Check current price position
  const inDemandZone = activeDemand.some((z) => currentPrice >= z.lower && currentPrice <= z.upper);
  const inSupplyZone = activeSupply.some((z) => currentPrice >= z.lower && currentPrice <= z.upper);

  // Nearest zones
  const nearestDemand = activeDemand.find((z) => z.upper < currentPrice) ?? null;
  const nearestSupply = activeSupply.find((z) => z.lower > currentPrice) ?? null;

  // Signal
  let signal: "demand_bounce" | "supply_rejection" | "breakout_up" | "breakout_down" | "none" =
    "none";

  if (inDemandZone) {
    // Check if price is bouncing (close > open on last candle)
    const lastCandle = candles[candles.length - 1]!;
    if (lastCandle.close > lastCandle.open) {
      signal = "demand_bounce";
    }
  } else if (inSupplyZone) {
    const lastCandle = candles[candles.length - 1]!;
    if (lastCandle.close < lastCandle.open) {
      signal = "supply_rejection";
    }
  }

  // Check for breakouts
  if (candles.length >= 2) {
    const prevClose = candles[candles.length - 2]!.close;
    for (const sz of activeSupply) {
      if (prevClose <= sz.upper && currentPrice > sz.upper) {
        signal = "breakout_up";
        break;
      }
    }
    if (signal === "none") {
      for (const dz of activeDemand) {
        if (prevClose >= dz.lower && currentPrice < dz.lower) {
          signal = "breakout_down";
          break;
        }
      }
    }
  }

  // Round zone values for output
  const roundZone = (z: SDZone): SDZone => ({
    ...z,
    upper: parseFloat(z.upper.toFixed(4)),
    lower: parseFloat(z.lower.toFixed(4)),
    mid: parseFloat(z.mid.toFixed(4)),
  });

  const interpretation = buildSDZInterpretation(
    currentPrice,
    activeDemand.length,
    activeSupply.length,
    inDemandZone,
    inSupplyZone,
    nearestDemand,
    nearestSupply,
    signal,
  );

  return {
    demandZones: activeDemand.map(roundZone),
    supplyZones: activeSupply.map(roundZone),
    inDemandZone,
    inSupplyZone,
    nearestDemand: nearestDemand ? roundZone(nearestDemand) : null,
    nearestSupply: nearestSupply ? roundZone(nearestSupply) : null,
    signal,
    interpretation,
  };
}

/**
 * Merge zones that are within tolerance of each other
 */
function mergeZones(zones: SDZone[], tolerance: number, maxCount: number): SDZone[] {
  if (zones.length === 0) return [];

  // Sort by midpoint
  const sorted = [...zones].sort((a, b) => a.mid - b.mid);
  const merged: SDZone[] = [{ ...sorted[0]! }];

  for (let i = 1; i < sorted.length; i++) {
    const current = sorted[i]!;
    const last = merged[merged.length - 1]!;

    if (Math.abs(current.mid - last.mid) / last.mid < tolerance) {
      // Merge: expand bounds, average midpoint
      last.lower = Math.min(last.lower, current.lower);
      last.upper = Math.max(last.upper, current.upper);
      last.mid = (last.upper + last.lower) / 2;
      last.widthPct = parseFloat((((last.upper - last.lower) / last.mid) * 100).toFixed(3));
      last.tests += current.tests;
    } else {
      merged.push({ ...current });
    }
  }

  return merged.slice(0, maxCount * 3); // Keep extra, will filter later
}

function buildSDZInterpretation(
  price: number,
  demandCount: number,
  supplyCount: number,
  inDemand: boolean,
  inSupply: boolean,
  nearestDemand: SDZone | null,
  nearestSupply: SDZone | null,
  signal: string,
): string {
  let msg = `${demandCount} demand zones, ${supplyCount} supply zones active. `;

  if (inDemand) {
    msg += "Price is IN a DEMAND ZONE — potential buying opportunity. ";
  } else if (inSupply) {
    msg += "Price is IN a SUPPLY ZONE — potential selling pressure. ";
  }

  if (nearestDemand) {
    const dist = (((price - nearestDemand.upper) / price) * 100).toFixed(1);
    msg += `Nearest demand: ${nearestDemand.lower.toFixed(2)}-${nearestDemand.upper.toFixed(2)} (${dist}% below). `;
  }
  if (nearestSupply) {
    const dist = (((nearestSupply.lower - price) / price) * 100).toFixed(1);
    msg += `Nearest supply: ${nearestSupply.lower.toFixed(2)}-${nearestSupply.upper.toFixed(2)} (${dist}% above). `;
  }

  if (signal === "demand_bounce") {
    msg += "DEMAND BOUNCE — bullish candle in demand zone.";
  } else if (signal === "supply_rejection") {
    msg += "SUPPLY REJECTION — bearish candle in supply zone.";
  } else if (signal === "breakout_up") {
    msg += "BREAKOUT UP through supply zone — bullish momentum.";
  } else if (signal === "breakout_down") {
    msg += "BREAKOUT DOWN through demand zone — bearish momentum.";
  } else if (!inDemand && !inSupply) {
    msg += "Price between zones — no immediate S/D signal.";
  }

  return msg;
}
