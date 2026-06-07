/**
 * Rotation bars — range and Renko (price-movement) bar construction.
 *
 * Distinct from `information-bars.ts` (López de Prado SAMPLING bars: tick /
 * volume / dollar — sampled by COUNT). Rotation bars are DISTANCE-based: a new
 * bar forms only after price travels a fixed amount, so time and observation
 * count are irrelevant and sub-`size` wiggles are filtered out as noise. The
 * input is any value series — close prices, or a cumulative signal such as
 * cumulative delta — so "delta rotations" work too.
 *
 *   - range: a bar accumulates until its high−low span reaches `size`, then
 *            closes and the next bar opens at that price.
 *   - renko: fixed-`size` bricks; a brick prints each time price crosses the
 *            next brick boundary (1-box construction). Noise < `size` prints
 *            nothing.
 *
 * Pure; never throws. Caps output at `maxBars` (default 5000) so a tiny `size`
 * relative to the series range can't blow up memory/context — truncation is
 * flagged.
 */

export type RotationMethod = "range" | "renko";

export interface RotationBar {
  open: number;
  high: number;
  low: number;
  close: number;
  /** +1 up bar/brick, −1 down. */
  direction: 1 | -1;
}

export interface RotationBarsInput {
  values: number[];
  method?: RotationMethod;
  /** Price (or value) distance that completes one bar/brick. Required, > 0. */
  size: number;
  maxBars?: number;
}

export interface RotationBarsResult {
  method: RotationMethod;
  size: number;
  bars: RotationBar[];
  barCount: number;
  sourceCount: number;
  /** bars per source observation — higher = more price travel (volatility) per point. */
  travelRatio: number;
  /** True if output hit the maxBars cap before consuming the whole series. */
  truncated: boolean;
  interpretation: string;
}

const DEFAULT_MAX_BARS = 5000;
const round = (x: number): number => parseFloat(x.toFixed(8));

export function constructRotationBars(input: RotationBarsInput): RotationBarsResult {
  const method: RotationMethod = input.method ?? "range";
  const size = input.size;
  const maxBars = Math.max(1, Math.floor(input.maxBars ?? DEFAULT_MAX_BARS));
  const values = input.values;
  const n = values.length;

  const empty = (reason: string): RotationBarsResult => ({
    method,
    size,
    bars: [],
    barCount: 0,
    sourceCount: n,
    travelRatio: 0,
    truncated: false,
    interpretation: reason,
  });

  if (!(size > 0)) return empty("size must be > 0");
  if (n < 2) return empty("need ≥ 2 values");

  const bars: RotationBar[] = [];
  let truncated = false;

  if (method === "range") {
    let open = values[0]!;
    let hi = values[0]!;
    let lo = values[0]!;
    for (let i = 1; i < n; i++) {
      const p = values[i]!;
      if (p > hi) hi = p;
      if (p < lo) lo = p;
      if (hi - lo >= size) {
        bars.push({
          open: round(open),
          high: round(hi),
          low: round(lo),
          close: round(p),
          direction: p >= open ? 1 : -1,
        });
        if (bars.length >= maxBars) {
          truncated = i < n - 1;
          break;
        }
        open = p;
        hi = p;
        lo = p;
      }
    }
  } else {
    // renko, 1-box
    let base = values[0]!;
    for (let i = 1; i < n; i++) {
      let diff = values[i]! - base;
      while (diff >= size) {
        bars.push({ open: round(base), high: round(base + size), low: round(base), close: round(base + size), direction: 1 });
        base += size;
        diff = values[i]! - base;
        if (bars.length >= maxBars) break;
      }
      while (diff <= -size) {
        bars.push({ open: round(base), high: round(base), low: round(base - size), close: round(base - size), direction: -1 });
        base -= size;
        diff = values[i]! - base;
        if (bars.length >= maxBars) break;
      }
      if (bars.length >= maxBars) {
        truncated = i < n - 1;
        break;
      }
    }
  }

  const barCount = bars.length;
  const travelRatio = parseFloat((barCount / (n - 1)).toFixed(4));
  const upCount = bars.filter((b) => b.direction === 1).length;
  const interpretation =
    `${method} bars: ${barCount} bar(s) from ${n} values (size ${size}) — ` +
    `${travelRatio} bars/obs, ${upCount} up / ${barCount - upCount} down` +
    (truncated ? ` [truncated at maxBars ${maxBars} — size may be too small]` : "");

  return { method, size, bars, barCount, sourceCount: n, travelRatio, truncated, interpretation };
}
