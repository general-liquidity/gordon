/**
 * Quote Verification — anti-hallucination evidence gate.
 *
 * Pure-TS port of reverse-quant's `provenance.verify_quote()` (MIT). The
 * function answers a single question: given a quoted snippet the model
 * emitted, does that snippet actually appear in the source text? When
 * the answer is no, the claim is hallucinated and downstream code
 * should drop or flag it.
 *
 * Why normalization rather than exact match: real-world source text
 * (news feeds, transcripts, SEC HTML/PDF, on-chain memos) reflows
 * whitespace, contains combining accents from copy-paste, and varies
 * in case. Strict equality fails in practice even when the quote is
 * faithfully grounded. The normalization pass collapses whitespace,
 * strips combining accents (NFKD decomposition + diacritic removal),
 * and casefolds — the cheapest robust form of "did the model quote
 * real text from this source."
 *
 * Integration intent:
 *   - Tools that extract quoted content from external text (news
 *     scrapers, transcript readers, SEC filing parsers) call
 *     `verifyQuote(quote, source)` before persisting the quote.
 *   - The audit decisionTrace can attach a `quoteVerification: {
 *     verified: boolean, method: "string_match" | "regex" | "manual" }`
 *     field per claim it records.
 *   - The agent surface includes `verify_quote_in_text` so the model
 *     can self-check a quote before stating it as fact.
 */

/**
 * Verification method.
 *   - `string_match` (default): normalized substring match.
 *   - `regex`: caller-provided regex pattern applied to the source
 *     text. Pattern errors return false (never throw).
 *   - `manual`: caller has verified out-of-band; this method always
 *     returns true. Use sparingly — it's the audit equivalent of
 *     "trust me."
 */
export type QuoteVerificationMethod = "string_match" | "regex" | "manual";

const WHITESPACE_RE = /\s+/g;

/**
 * Normalize a string for quote-verification comparison.
 *
 * Steps:
 *   1. Unicode NFKD decomposition — splits combined characters into
 *      base + combining marks (e.g. "é" → "e" + COMBINING ACUTE ACCENT)
 *   2. Strip combining diacritic marks (Unicode general category Mn)
 *      via regex on the U+0300..U+036F + U+1AB0..U+1AFF + U+1DC0..U+1DFF
 *      + U+20D0..U+20FF combining-character ranges. This is the
 *      JavaScript equivalent of Python's
 *      `c for c in text if not unicodedata.combining(c)`.
 *   3. Collapse all whitespace runs to a single space, trim ends.
 *   4. Case-fold (use String.toLowerCase since JS lacks a true
 *      casefold; for ASCII + Latin-1 they coincide, and the trading-
 *      domain text Gordon handles is overwhelmingly in that range).
 *
 * Exposed for tests + advanced callers; most code should use
 * `verifyQuote` directly.
 */
export function normalizeForComparison(text: string): string {
  if (!text) return "";
  // Step 1+2: NFKD then strip combining marks. `\p{M}` is Unicode
  // Mark category — matches every combining diacritic and mark
  // across Unicode (Mn + Mc + Me). The `u` flag is required for
  // Unicode property escapes.
  const stripped = text.normalize("NFKD").replace(/\p{M}/gu, "");
  // Step 3+4: collapse whitespace, casefold.
  return stripped.replace(WHITESPACE_RE, " ").trim().toLowerCase();
}

/**
 * Verify that `quote` appears in `sourceText` under the chosen method.
 *
 * Returns false when the quote is empty/whitespace, the source is
 * empty, or the method's check fails. Never throws — regex errors are
 * swallowed as a false result so caller code stays linear.
 */
export function verifyQuote(
  quote: string,
  sourceText: string,
  options: { method?: QuoteVerificationMethod } = {},
): boolean {
  const method = options.method ?? "string_match";
  if (!quote?.trim() || !sourceText) return false;

  if (method === "string_match") {
    return normalizeForComparison(sourceText).includes(normalizeForComparison(quote));
  }

  if (method === "regex") {
    try {
      const re = new RegExp(quote);
      return re.test(sourceText);
    } catch {
      // Malformed regex — pretend it didn't match.
      return false;
    }
  }

  // method === "manual" — caller asserts verified.
  return true;
}

/**
 * Verify a list of quotes against a source, returning per-quote
 * verdicts. Useful for downstream code that wants to discard or flag
 * un-verifiable claims in bulk (e.g. when an extraction tool returns
 * an array of quoted snippets).
 */
export interface QuoteVerificationOutcome {
  quote: string;
  verified: boolean;
  method: QuoteVerificationMethod;
}

export function verifyQuotes(
  quotes: ReadonlyArray<string>,
  sourceText: string,
  options: { method?: QuoteVerificationMethod } = {},
): QuoteVerificationOutcome[] {
  const method = options.method ?? "string_match";
  return quotes.map((q) => ({
    quote: q,
    verified: verifyQuote(q, sourceText, { method }),
    method,
  }));
}

/**
 * Summary stats for a batch verification — designed for the agent's
 * `verify_quote_in_text` tool to return a compact response.
 */
export interface QuoteVerificationSummary {
  total: number;
  verified: number;
  unverified: number;
  verifiedRate: number;
}

export function summarizeQuoteVerifications(
  outcomes: ReadonlyArray<QuoteVerificationOutcome>,
): QuoteVerificationSummary {
  const total = outcomes.length;
  const verified = outcomes.filter((o) => o.verified).length;
  return {
    total,
    verified,
    unverified: total - verified,
    verifiedRate: total === 0 ? 0 : verified / total,
  };
}
