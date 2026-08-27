/**
 * WorldQuant 101 Formulaic Alphas — representative subset
 * (Kakushadze 2016, "101 Formulaic Alphas", arXiv:1601.00991)
 *
 * A subset of the 101 alphas that need ONLY open/high/low/close/volume/returns
 * — the data Gordon carries on the analytics surface. Each alpha is composed
 * PURELY from the operator kernel in `formulaic-alpha-operators.ts`. The
 * original formula is cited above each implementation.
 *
 * DELIBERATELY SKIPPED (need data this surface lacks):
 *   - Any alpha referencing `vwap`            (no trade-level VWAP feed):
 *       e.g. alpha011, alpha025, alpha041, alpha042, alpha050, alpha083 …
 *   - Any alpha referencing `cap` / market cap (no market-cap panel):
 *       e.g. alpha056, alpha078 …
 *   - Any alpha referencing `IndClass.*`       (no sector/industry map; this is
 *       why `indneutralize` is also absent from the kernel):
 *       e.g. alpha048, alpha058, alpha063 …
 *   - Any alpha referencing `adv{n}` (avg dollar volume)  — derivable but the
 *       paper's adv uses dollar volume Gordon doesn't pass here:
 *       e.g. alpha005, alpha014, alpha044 …
 *
 * Each alpha returns a `Panel` (ticker × date) of the signal. `null` cells
 * mean the signal is undefined there (insufficient window / missing input).
 *
 * Pure functions, no I/O.
 */

import {
  type Panel,
  type Cell,
  makePanel,
  rank,
  sign,
  log,
  ts_delta,
  ts_rank,
  ts_argmax,
  ts_std,
  ts_corr,
  ts_cov,
  signedpower,
  power,
  sub,
  div,
  mul,
  neg,
  addScalar,
  dailyReturns,
} from "./formulaic-alpha-operators.ts";

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

/**
 * The OHLCV panel bundle. Each field is a `Panel` sharing the same
 * `dates`/`tickers` axes. `returns` is optional — if absent it is derived from
 * `close` via simple daily returns. `volume` is optional for alphas that don't
 * use it.
 */
export interface AlphaInputs {
  open?: Panel;
  high?: Panel;
  low?: Panel;
  close: Panel;
  volume?: Panel;
  returns?: Panel;
}

function need(p: Panel | undefined, name: string): Panel {
  if (!p) throw new Error(`alpha requires '${name}' panel`);
  return p;
}

/** Returns panel: explicit if supplied, else derived from close. */
function returnsOf(i: AlphaInputs): Panel {
  return i.returns ?? dailyReturns(i.close);
}

/** A constant panel shaped like `like`, every present-shaped cell = c. */
function constLike(like: Panel, c: number): Panel {
  const values: Cell[][] = like.dates.map(() => like.tickers.map(() => c));
  return makePanel(like.dates, like.tickers, values);
}

// ---------------------------------------------------------------------------
// Conditional helper (for alpha001's returns<0 ? ... : ...)
// ---------------------------------------------------------------------------

/**
 * Elementwise ternary: where(cond < 0, a, b). `cond`, `a`, `b` are aligned
 * panels. Any null among the three operands at a cell -> null.
 */
function whereNeg(cond: Panel, a: Panel, b: Panel): Panel {
  const out: Cell[][] = cond.dates.map(() => cond.tickers.map(() => null));
  for (let d = 0; d < cond.values.length; d++) {
    for (let t = 0; t < cond.tickers.length; t++) {
      const c = cond.values[d]![t]!;
      const av = a.values[d]![t]!;
      const bv = b.values[d]![t]!;
      if (c === null || av === null || bv === null) continue;
      out[d]![t] = c < 0 ? av : bv;
    }
  }
  return makePanel(cond.dates, cond.tickers, out);
}

// ---------------------------------------------------------------------------
// The alphas
// ---------------------------------------------------------------------------

/**
 * Alpha#1:
 *   (rank(Ts_ArgMax(SignedPower(((returns < 0) ? stddev(returns, 20) : close), 2.), 5)) - 0.5)
 */
export function alpha001(i: AlphaInputs): Panel {
  const ret = returnsOf(i);
  const std20 = ts_std(ret, 20);
  const base = whereNeg(ret, std20, i.close);
  const sp = signedpower(base, 2);
  const arg = ts_argmax(sp, 5);
  return addScalar(rank(arg), -0.5);
}

/**
 * Alpha#2:
 *   (-1 * correlation(rank(delta(log(volume), 2)), rank(((close - open) / open)), 6))
 */
export function alpha002(i: AlphaInputs): Panel {
  const volume = need(i.volume, "volume");
  const open = need(i.open, "open");
  const a = rank(ts_delta(log(volume), 2));
  const b = rank(div(sub(i.close, open), open));
  return neg(ts_corr(a, b, 6));
}

/**
 * Alpha#3:
 *   (-1 * correlation(rank(open), rank(volume), 10))
 */
export function alpha003(i: AlphaInputs): Panel {
  const open = need(i.open, "open");
  const volume = need(i.volume, "volume");
  return neg(ts_corr(rank(open), rank(volume), 10));
}

/**
 * Alpha#4:
 *   (-1 * Ts_Rank(rank(low), 9))
 */
export function alpha004(i: AlphaInputs): Panel {
  const low = need(i.low, "low");
  return neg(ts_rank(rank(low), 9));
}

/**
 * Alpha#6:
 *   (-1 * correlation(open, volume, 10))
 */
export function alpha006(i: AlphaInputs): Panel {
  const open = need(i.open, "open");
  const volume = need(i.volume, "volume");
  return neg(ts_corr(open, volume, 10));
}

/**
 * Alpha#12:
 *   (sign(delta(volume, 1)) * (-1 * delta(close, 1)))
 */
export function alpha012(i: AlphaInputs): Panel {
  const volume = need(i.volume, "volume");
  return mul(sign(ts_delta(volume, 1)), neg(ts_delta(i.close, 1)));
}

/**
 * Alpha#13:
 *   (-1 * rank(covariance(rank(close), rank(volume), 5)))
 */
export function alpha013(i: AlphaInputs): Panel {
  const volume = need(i.volume, "volume");
  const cov = ts_cov(rank(i.close), rank(volume), 5);
  return neg(rank(cov));
}

/**
 * Alpha#33:
 *   rank((-1 * ((1 - (open / close))^1)))
 *   = rank((open/close) - 1)
 */
export function alpha033(i: AlphaInputs): Panel {
  const open = need(i.open, "open");
  const oneMinus = sub(constLike(i.close, 1), div(open, i.close)); // 1 - open/close
  const inner = neg(power(oneMinus, 1));
  return rank(inner);
}

/**
 * Alpha#53:
 *   (-1 * delta((((close - low) - (high - close)) / (close - low)), 9))
 */
export function alpha053(i: AlphaInputs): Panel {
  const low = need(i.low, "low");
  const high = need(i.high, "high");
  const closeMinusLow = sub(i.close, low);
  const highMinusClose = sub(high, i.close);
  const ratio = div(sub(closeMinusLow, highMinusClose), closeMinusLow);
  return neg(ts_delta(ratio, 9));
}

/**
 * Alpha#54:
 *   ((-1 * ((low - close) * (open^5))) / ((low - high) * (close^5)))
 */
export function alpha054(i: AlphaInputs): Panel {
  const low = need(i.low, "low");
  const high = need(i.high, "high");
  const open = need(i.open, "open");
  const num = neg(mul(sub(low, i.close), power(open, 5)));
  const den = mul(sub(low, high), power(i.close, 5));
  return div(num, den);
}

/**
 * Alpha#101:
 *   ((close - open) / ((high - low) + .001))
 */
export function alpha101(i: AlphaInputs): Panel {
  const open = need(i.open, "open");
  const high = need(i.high, "high");
  const low = need(i.low, "low");
  const num = sub(i.close, open);
  const den = addScalar(sub(high, low), 0.001);
  return div(num, den);
}

// ---------------------------------------------------------------------------
// Registry / dispatcher
// ---------------------------------------------------------------------------

export type AlphaName =
  | "alpha001"
  | "alpha002"
  | "alpha003"
  | "alpha004"
  | "alpha006"
  | "alpha012"
  | "alpha013"
  | "alpha033"
  | "alpha053"
  | "alpha054"
  | "alpha101";

const REGISTRY: Record<AlphaName, (i: AlphaInputs) => Panel> = {
  alpha001,
  alpha002,
  alpha003,
  alpha004,
  alpha006,
  alpha012,
  alpha013,
  alpha033,
  alpha053,
  alpha054,
  alpha101,
};

/** Names of every implemented alpha. */
export const IMPLEMENTED_ALPHAS = Object.keys(REGISTRY) as AlphaName[];

/**
 * Dispatch by name. Returns null if the alpha name is not implemented
 * (NULL-on-missing convention — does not throw on unknown name). Throws only at
 * the input boundary if a required OHLCV panel is absent for the chosen alpha.
 */
export function computeFormulaicAlpha(name: string, inputs: AlphaInputs): Panel | null {
  const fn = REGISTRY[name as AlphaName];
  if (!fn) return null;
  return fn(inputs);
}
