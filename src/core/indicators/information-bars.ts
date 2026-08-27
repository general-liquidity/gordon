/**
 * Information-driven bars (López de Prado, Advances in Financial ML, Ch 2).
 *
 * Standard time bars over- / under-sample relative to information arrival.
 * Information bars instead close a bar when a cumulative measure crosses a
 * threshold:
 *   - volume bars: cumulative volume >= threshold
 *   - dollar  bars: cumulative price*volume (dollar value) >= threshold
 *   - tick    bars: cumulative tick count >= threshold
 *
 * Input is a trade/tick stream ({price, volume, timestamp}); an OHLCV stream
 * is accepted as a fallback (each candle treated as one trade at its close
 * price with its volume — coarser but usable when ticks are unavailable).
 *
 * Each emitted bar carries OHLCV + VWAP. NULL/empty on no input.
 */

export interface Tick {
  price: number;
  volume: number;
  timestamp: number;
}

export interface OHLCVBar {
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  openTime: number;
  closeTime: number;
}

export interface InformationBar extends OHLCVBar {
  /** Volume-weighted average price over the bar's constituent trades */
  vwap: number;
  /** Number of ticks/trades aggregated into the bar */
  tickCount: number;
  /** Cumulative dollar value (sum of price*volume) over the bar */
  dollarValue: number;
}

export type InformationBarKind = "volume" | "dollar" | "tick";

export interface InformationBarsResult {
  kind: InformationBarKind;
  threshold: number;
  bars: InformationBar[];
  /** Trailing partial bar that has not yet crossed the threshold (or null) */
  partial: InformationBar | null;
}

/** Coarse fallback: map an OHLCV candle to a single synthetic tick at its close. */
export interface OHLCVInput {
  close: number;
  volume: number;
  openTime?: number;
  closeTime?: number;
}

function emptyResult(kind: InformationBarKind, threshold: number): InformationBarsResult {
  return { kind, threshold, bars: [], partial: null };
}

/**
 * Build information-driven bars from a tick stream.
 *
 * @param ticks - Array of {price, volume, timestamp}
 * @param kind - 'volume' | 'dollar' | 'tick'
 * @param threshold - Cumulative threshold that closes a bar (must be > 0)
 * @returns InformationBarsResult (empty bars + null partial if no/invalid input)
 */
export function buildInformationBars(
  ticks: Tick[],
  kind: InformationBarKind,
  threshold: number,
): InformationBarsResult {
  if (!Array.isArray(ticks) || ticks.length === 0 || !(threshold > 0)) {
    return emptyResult(kind, threshold);
  }

  const bars: InformationBar[] = [];

  // Mutable accumulator for the bar in progress.
  let open = 0;
  let high = -Infinity;
  let low = Infinity;
  let close = 0;
  let vol = 0;
  let dollar = 0;
  let pvSum = 0; // sum(price*volume) for VWAP
  let count = 0;
  let openTime = 0;
  let closeTime = 0;
  let active = false;

  const reset = () => {
    high = -Infinity;
    low = Infinity;
    vol = 0;
    dollar = 0;
    pvSum = 0;
    count = 0;
    active = false;
  };

  const emit = () => {
    bars.push({
      open,
      high,
      low,
      close,
      volume: parseFloat(vol.toFixed(8)),
      openTime,
      closeTime,
      vwap: vol > 0 ? parseFloat((pvSum / vol).toFixed(8)) : parseFloat(close.toFixed(8)),
      tickCount: count,
      dollarValue: parseFloat(dollar.toFixed(8)),
    });
    reset();
  };

  const measure = (): number => {
    if (kind === "volume") return vol;
    if (kind === "dollar") return dollar;
    return count; // tick
  };

  for (const t of ticks) {
    if (!active) {
      open = t.price;
      openTime = t.timestamp;
      active = true;
    }
    if (t.price > high) high = t.price;
    if (t.price < low) low = t.price;
    close = t.price;
    closeTime = t.timestamp;
    vol += t.volume;
    dollar += t.price * t.volume;
    pvSum += t.price * t.volume;
    count += 1;

    if (measure() >= threshold) emit();
  }

  // Trailing partial bar (threshold not yet crossed).
  let partial: InformationBar | null = null;
  if (active && count > 0) {
    partial = {
      open,
      high,
      low,
      close,
      volume: parseFloat(vol.toFixed(8)),
      openTime,
      closeTime,
      vwap: vol > 0 ? parseFloat((pvSum / vol).toFixed(8)) : parseFloat(close.toFixed(8)),
      tickCount: count,
      dollarValue: parseFloat(dollar.toFixed(8)),
    };
  }

  return { kind, threshold, bars, partial };
}

/**
 * Fallback builder from an OHLCV stream when ticks are unavailable. Each candle
 * is treated as one trade at its close price with its volume. Coarser than a
 * true tick aggregation but preserves the threshold-crossing semantics.
 *
 * @param ohlcv - Array of {close, volume, openTime?, closeTime?}
 * @param kind - 'volume' | 'dollar' | 'tick'
 * @param threshold - Cumulative threshold that closes a bar (must be > 0)
 * @returns InformationBarsResult
 */
export function buildInformationBarsFromOHLCV(
  ohlcv: OHLCVInput[],
  kind: InformationBarKind,
  threshold: number,
): InformationBarsResult {
  if (!Array.isArray(ohlcv) || ohlcv.length === 0 || !(threshold > 0)) {
    return emptyResult(kind, threshold);
  }

  const ticks: Tick[] = ohlcv.map((c, i) => ({
    price: c.close,
    volume: c.volume,
    timestamp: c.closeTime ?? c.openTime ?? i,
  }));

  return buildInformationBars(ticks, kind, threshold);
}
