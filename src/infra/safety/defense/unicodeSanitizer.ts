/**
 * Structural Unicode Sanitizer.
 *
 * Complements the pattern/keyword injection detection in
 * `injectionDefense.ts` + `withResultSanitizer.ts`. Those catch *visible*
 * adversarial phrasing ("ignore previous instructions"); this catches the
 * *structural* vector — invisible / tag-plane characters that smuggle
 * instructions past human review and past keyword regexes.
 *
 * Two transforms, applied in order:
 *   1. NFKC normalization — folds compatibility variants (full-width,
 *      ligatures, composed forms) so downstream pattern detection sees a
 *      single canonical form instead of a homoglyph-evading variant.
 *   2. Strip structural control planes: the Unicode Tag block plus the
 *      remaining format/private-use/unassigned categories — while preserving
 *      ordinary whitespace.
 *
 * Additive: this does NOT replace keyword detection. Run it as an extra
 * pass over untrusted tool output.
 */

// Unicode Tag block U+E0000–U+E007F: the classic invisible-instruction
// vector — tag characters render as nothing but carry ASCII semantics,
// letting an attacker hide a full "ignore previous instructions" payload
// in whitespace. Stripped explicitly (also covered by \p{Cf}/\p{Cn} below,
// but called out because it is the primary documented attack.)
const TAG_BLOCK = /[\u{E0000}-\u{E007F}]/gu;

// Format (\p{Cf}), private-use (\p{Co}), and unassigned (\p{Cn}) code points.
// \p{Cf} covers the zero-width chars used to break up keywords (ZWSP U+200B,
// ZWNJ U+200C, ZWJ U+200D, BOM/ZWNBSP U+FEFF, word-joiner U+2060) as well as
// bidi overrides; \p{Co}/\p{Cn} are non-semantic for trading text. Ordinary
// whitespace (\n \t \r space) is NOT in any of these classes, so it survives.
const STRUCTURAL_CONTROL = /[\p{Cf}\p{Co}\p{Cn}]/gu;

export function sanitizeUnicode(text: string): string {
  if (text.length === 0) return text;
  const normalized = text.normalize("NFKC");
  return normalized.replace(TAG_BLOCK, "").replace(STRUCTURAL_CONTROL, "");
}

const MAX_DEPTH = 12;

/**
 * Walk a value, NFKC-normalizing + stripping structural Unicode from every
 * string leaf. Non-strings pass through unchanged. Cycle-safe (WeakSet) and
 * depth-capped — never throws on hostile input, just stops descending.
 */
export function recursivelySanitizeUnicode<T>(value: T): T {
  const seen = new WeakSet<object>();

  function walk(v: unknown, depth: number): unknown {
    if (typeof v === "string") return sanitizeUnicode(v);
    if (depth >= MAX_DEPTH || v === null || typeof v !== "object") return v;

    if (seen.has(v as object)) return v;
    seen.add(v as object);

    if (Array.isArray(v)) {
      return v.map((item) => walk(item, depth + 1));
    }

    // Only transform plain-object string leaves. Dates, Maps, typed arrays,
    // class instances etc. pass through to avoid structurally mangling them.
    const proto = Object.getPrototypeOf(v);
    if (proto !== Object.prototype && proto !== null) return v;

    const out: Record<string, unknown> = {};
    for (const [k, vv] of Object.entries(v as Record<string, unknown>)) {
      out[k] = walk(vv, depth + 1);
    }
    return out;
  }

  return walk(value, 0) as T;
}
