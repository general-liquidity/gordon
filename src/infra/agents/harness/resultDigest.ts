/**
 * Tabular result digest.
 *
 * A blind head-slice of a large tool result is misleading: truncate a 50-row
 * scan at 600 chars and the model sees ~8 rows and has no idea 42 more existed,
 * let alone their range. This builds a sample-with-totals digest instead — the
 * row count, per-column aggregates (min/max/mean/last) over ALL rows, a small
 * deterministic sample, and an "…and N more" tally — so the preview is lossless
 * on the SHAPE of the data even when it samples the rows. The full result still
 * lives on the scratch file (the L3 escape hatch); this only improves the inline
 * preview. The trading analogue of a spreadsheet agent's getCellRange wrapper
 * (free row/column context + compression-with-totals).
 *
 * Returns null when the result isn't a large array-of-objects / array-of-numbers
 * — the caller then falls back to head-slice truncation. Never throws.
 */

export interface DigestOptions {
  /** Rows shown verbatim in the sample. Default 4. */
  sampleRows?: number;
  /** Numeric columns aggregated. Default 8. */
  maxFields?: number;
  /** Hard cap on the digest length; sample rows are dropped to fit. Default 1200. */
  maxChars?: number;
}

interface PrimaryArray {
  arr: unknown[];
  /** Scalar (non-array, non-object) wrapper fields — the "free context". */
  scalars: Record<string, unknown>;
}

function findPrimaryArray(result: unknown): PrimaryArray | null {
  if (Array.isArray(result)) return { arr: result, scalars: {} };
  if (result && typeof result === "object") {
    let best: unknown[] | null = null;
    const scalars: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(result as Record<string, unknown>)) {
      if (Array.isArray(v)) {
        if (!best || v.length > best.length) best = v;
      } else if (v === null || typeof v !== "object") {
        scalars[k] = v;
      }
    }
    if (best) return { arr: best, scalars };
  }
  return null;
}

function fmt(v: unknown): string {
  if (typeof v === "number") {
    if (!Number.isFinite(v)) return String(v);
    if (Number.isInteger(v)) return String(v);
    return v.toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
  }
  if (typeof v === "string") return v.length > 32 ? `${v.slice(0, 32)}…` : v;
  if (v === null || v === undefined) return String(v);
  return "·";
}

function oneLine(row: unknown, cap = 120): string {
  let s: string;
  try {
    s = JSON.stringify(row);
  } catch {
    s = String(row);
  }
  return s.length > cap ? `${s.slice(0, cap)}…` : s;
}

interface ColAgg { field: string; min: number; max: number; mean: number; last: number }

function aggregateNumericColumns(rows: Record<string, unknown>[], maxFields: number): ColAgg[] {
  const acc = new Map<string, { sum: number; min: number; max: number; last: number; n: number }>();
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    for (const [k, v] of Object.entries(row)) {
      if (typeof v !== "number" || !Number.isFinite(v)) continue;
      const a = acc.get(k);
      if (a) {
        a.sum += v; a.min = Math.min(a.min, v); a.max = Math.max(a.max, v); a.last = v; a.n++;
      } else {
        acc.set(k, { sum: v, min: v, max: v, last: v, n: 1 });
      }
    }
  }
  // Keep columns present in a majority of rows — the stable schema.
  const threshold = rows.length / 2;
  return [...acc.entries()]
    .filter(([, a]) => a.n >= threshold)
    .slice(0, maxFields)
    .map(([field, a]) => ({ field, min: a.min, max: a.max, mean: a.sum / a.n, last: a.last }));
}

function build(result: unknown, opts: DigestOptions): string | null {
  const sampleRows = opts.sampleRows ?? 4;
  const maxChars = opts.maxChars ?? 1200;
  const found = findPrimaryArray(result);
  if (!found) return null;
  const { arr, scalars } = found;
  if (arr.length <= sampleRows + 1) return null; // too small to benefit from a digest

  const ctx = Object.entries(scalars)
    .map(([k, v]) => `${k}=${fmt(v)}`)
    .join(" ");
  const ctxSuffix = ctx ? ` (${ctx})` : "";
  const lines: string[] = [];

  if (arr.every((x) => typeof x === "number")) {
    const nums = arr as number[];
    const finite = nums.filter((n) => Number.isFinite(n));
    const sum = finite.reduce((s, n) => s + n, 0);
    lines.push(
      `${arr.length} values${ctxSuffix}: min ${fmt(Math.min(...finite))} max ${fmt(Math.max(...finite))} ` +
        `mean ${fmt(sum / Math.max(finite.length, 1))} last ${fmt(nums[nums.length - 1])}`,
    );
    lines.push(`first ${sampleRows}: ${nums.slice(0, sampleRows).map(fmt).join(", ")} …and ${arr.length - sampleRows} more`);
  } else if (arr.every((x) => x !== null && typeof x === "object" && !Array.isArray(x))) {
    const rows = arr as Record<string, unknown>[];
    lines.push(`${arr.length} rows${ctxSuffix}`);
    for (const a of aggregateNumericColumns(rows, opts.maxFields ?? 8)) {
      lines.push(`  ${a.field}: min ${fmt(a.min)} max ${fmt(a.max)} mean ${fmt(a.mean)} last ${fmt(a.last)}`);
    }
    let shown = sampleRows;
    const render = (n: number): string =>
      [`sample (first ${n} of ${arr.length}):`, ...rows.slice(0, n).map((r) => `  ${oneLine(r)}`), `…and ${arr.length - n} more rows`].join("\n");
    // Drop sample rows until the whole digest fits the budget (keep the aggregates).
    let body = render(shown);
    while (shown > 1 && [...lines, body].join("\n").length > maxChars) {
      shown--;
      body = render(shown);
    }
    lines.push(body);
  } else {
    return null; // mixed / array-of-arrays — let the caller head-slice
  }

  const out = lines.join("\n");
  return out.length > maxChars ? `${out.slice(0, maxChars)}…` : out;
}

export function digestLargeResult(result: unknown, opts: DigestOptions = {}): string | null {
  try {
    return build(result, opts);
  } catch {
    return null;
  }
}
