/**
 * Citation Agent (GORDON_CITATION_AGENT).
 *
 * Trading-domain port of Anthropic's CitationAgent from "How we built our
 * multi-agent research system" (2026). Anthropic's version processes
 * research findings to ensure proper attribution to sources. The
 * trading-domain analog: every trade recommendation should be tied to
 * specific tool-call evidence so a human reviewer (or a regulator) can
 * answer "why did the agent recommend this?" without re-running the model.
 *
 * Three concrete contributions:
 *
 *   1. `buildCitationManifest(plan, evidence)` — links claims in a
 *      recommendation to specific tool-call results. Heuristic matching:
 *      symbols/tickers/numeric thresholds mentioned in a claim look for
 *      tool calls that produced matching values.
 *   2. `detectUnsupportedClaims` — surfaces claims that have NO matching
 *      evidence. These are the "agent made this up" cases.
 *   3. JSONL persistence at `~/.gordon/citation-manifests.jsonl` so every
 *      recommendation's evidence trail survives the session.
 *
 * This is the audit-trail primitive Gordon needs but doesn't currently
 * have. `decisionLog.ts` captures the "why" of a decision; this captures
 * the "what was the evidence." The two pair: decisionLog says "I chose
 * mean-reversion over momentum because X"; citationAgent says "the
 * specific evidence for X was tool call `get_candles@2026-05-13T10:00`
 * row 47 (RSI=22)."
 */

import { existsSync, mkdirSync, appendFileSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

export const CITATION_AGENT_FLAG_ENV = "GORDON_CITATION_AGENT";
export const CITATION_MANIFEST_PATH_ENV = "GORDON_CITATION_MANIFEST_PATH";

export interface EvidenceRef {
  /** Stable id of the tool call (e.g. invocation index). */
  toolCallId: string;
  toolName: string;
  /** Short hash of the tool-call result for tamper-detection. */
  resultFingerprint: string;
  /** One-line summary of what the result contained. */
  summary: string;
  /** ISO timestamp the tool call was made. */
  timestamp: string;
  /**
   * Optional structured observations from the tool result that may match
   * claims (e.g. { symbol: "BTC/USD", rsi: 22, price: 50000 }).
   */
  observations?: Record<string, string | number | boolean | null>;
}

export interface ClaimCitation {
  claim: string;
  evidenceRefs: EvidenceRef[];
  /** True when no evidence ref matched the claim. */
  unsupported: boolean;
  /** Match score 0..1 — how confident we are the evidence supports the claim. */
  matchScore: number;
}

export interface CitationManifest {
  /** Stable id of the recommendation/plan being cited. */
  recommendationId: string;
  /** ISO timestamp. */
  createdAt: string;
  citations: ClaimCitation[];
  unsupportedClaimCount: number;
  totalEvidenceCount: number;
  /** Overall fraction of claims that have at least one evidence ref. */
  supportRatio: number;
}

export interface BuildManifestInput {
  recommendationId: string;
  /** Free-form claims that the recommendation makes (one per sentence/bullet). */
  claims: string[];
  /** Tool calls that occurred before the recommendation was formed. */
  evidence: EvidenceRef[];
  /** Override clock for tests. */
  now?: string;
}

export function isCitationAgentEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[CITATION_AGENT_FLAG_ENV] === "1" || env[CITATION_AGENT_FLAG_ENV] === "true";
}

export function defaultCitationManifestPath(env: NodeJS.ProcessEnv = process.env): string {
  return env[CITATION_MANIFEST_PATH_ENV] ?? join(homedir(), ".gordon", "citation-manifests.jsonl");
}

function ensureParentDir(path: string): void {
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

// ============================================================================
// Heuristic matching: claim ↔ evidence
// ============================================================================

const TICKER_RE = /\b([A-Z]{2,6}(?:[/-][A-Z]{2,6})?)\b/g;
const NUMERIC_RE = /\b(\d+(?:\.\d+)?)\s*(?:%|bps|usd|eth|btc|x)?\b/gi;
const INDICATOR_RE =
  /\b(rsi|macd|ema|sma|atr|adx|bollinger|stoch(?:astic)?|volume|drawdown|sharpe|momentum|regime)\b/gi;

interface ExtractedFeatures {
  tickers: Set<string>;
  numbers: Set<string>;
  indicators: Set<string>;
  /** Lowercased substantive words from the claim. */
  tokens: Set<string>;
}

function extractClaimFeatures(claim: string): ExtractedFeatures {
  const tickers = new Set<string>();
  const numbers = new Set<string>();
  const indicators = new Set<string>();
  for (const m of claim.matchAll(TICKER_RE)) tickers.add(m[1]!.toUpperCase());
  for (const m of claim.matchAll(NUMERIC_RE)) numbers.add(m[1]!);
  for (const m of claim.matchAll(INDICATOR_RE)) indicators.add(m[1]!.toLowerCase());
  const tokens = new Set(
    claim
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length >= 3 && !STOP_WORDS.has(w)),
  );
  return { tickers, numbers, indicators, tokens };
}

const STOP_WORDS = new Set([
  "the", "and", "for", "with", "this", "that", "from", "into", "above",
  "below", "over", "under", "into", "than", "then", "have", "will",
  "should", "would", "could", "because", "since", "when", "what",
]);

function extractEvidenceFeatures(ev: EvidenceRef): ExtractedFeatures {
  const text = `${ev.toolName} ${ev.summary} ${JSON.stringify(ev.observations ?? {})}`;
  return extractClaimFeatures(text);
}

/**
 * Score how well `evidence` supports `claim`. 0..1:
 *   +0.4  if tickers overlap
 *   +0.2  if any indicator name overlaps
 *   +0.2  if any number overlaps (exact string match)
 *   +0.2  proportional to token overlap (Jaccard)
 */
function scoreEvidenceForClaim(claim: ExtractedFeatures, ev: ExtractedFeatures): number {
  let score = 0;
  if (intersects(claim.tickers, ev.tickers)) score += 0.4;
  if (intersects(claim.indicators, ev.indicators)) score += 0.2;
  if (intersects(claim.numbers, ev.numbers)) score += 0.2;
  const tokenOverlap = jaccard(claim.tokens, ev.tokens);
  score += 0.2 * tokenOverlap;
  return Math.min(1, score);
}

function intersects<T>(a: Set<T>, b: Set<T>): boolean {
  for (const x of a) if (b.has(x)) return true;
  return false;
}

function jaccard<T>(a: Set<T>, b: Set<T>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let intersection = 0;
  for (const x of a) if (b.has(x)) intersection++;
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/**
 * Find evidence refs that support a claim. Returns refs ranked by score,
 * with a minimum-score threshold to drop weak matches.
 */
export function findEvidenceForClaim(
  claim: string,
  evidence: readonly EvidenceRef[],
  opts: { minScore?: number; topK?: number } = {},
): { refs: EvidenceRef[]; topScore: number } {
  const minScore = opts.minScore ?? 0.2;
  const topK = opts.topK ?? 5;
  const claimFeatures = extractClaimFeatures(claim);
  const scored = evidence
    .map((ev) => ({ ev, score: scoreEvidenceForClaim(claimFeatures, extractEvidenceFeatures(ev)) }))
    .filter((x) => x.score >= minScore)
    .sort((a, b) => b.score - a.score);
  return {
    refs: scored.slice(0, topK).map((x) => x.ev),
    topScore: scored.length === 0 ? 0 : scored[0]!.score,
  };
}

// ============================================================================
// Build manifest
// ============================================================================

export function buildCitationManifest(input: BuildManifestInput): CitationManifest {
  const citations: ClaimCitation[] = input.claims.map((claim) => {
    const { refs, topScore } = findEvidenceForClaim(claim, input.evidence);
    return {
      claim,
      evidenceRefs: refs,
      unsupported: refs.length === 0,
      matchScore: topScore,
    };
  });

  const unsupportedClaimCount = citations.filter((c) => c.unsupported).length;
  const totalEvidenceCount = citations.reduce((sum, c) => sum + c.evidenceRefs.length, 0);
  const supportRatio =
    citations.length === 0 ? 1 : (citations.length - unsupportedClaimCount) / citations.length;

  return {
    recommendationId: input.recommendationId,
    createdAt: input.now ?? new Date().toISOString(),
    citations,
    unsupportedClaimCount,
    totalEvidenceCount,
    supportRatio,
  };
}

export function detectUnsupportedClaims(manifest: CitationManifest): ClaimCitation[] {
  return manifest.citations.filter((c) => c.unsupported);
}

// ============================================================================
// Persistence
// ============================================================================

export function persistCitationManifest(manifest: CitationManifest, path?: string): void {
  const target = path ?? defaultCitationManifestPath();
  ensureParentDir(target);
  appendFileSync(target, JSON.stringify(manifest) + "\n", "utf8");
}

export function readCitationManifests(
  opts: { recommendationId?: string; limit?: number } = {},
  path?: string,
): CitationManifest[] {
  const target = path ?? defaultCitationManifestPath();
  if (!existsSync(target)) return [];
  const lines = readFileSync(target, "utf8").split("\n").filter((l) => l.trim().length > 0);
  const out: CitationManifest[] = [];
  for (const line of lines) {
    try {
      const parsed = JSON.parse(line) as CitationManifest;
      if (typeof parsed.recommendationId === "string" && Array.isArray(parsed.citations)) {
        if (opts.recommendationId && parsed.recommendationId !== opts.recommendationId) continue;
        out.push(parsed);
      }
    } catch {
      // skip malformed
    }
  }
  out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return opts.limit !== undefined ? out.slice(0, opts.limit) : out;
}

// ============================================================================
// Reporting
// ============================================================================

export function formatCitationManifest(manifest: CitationManifest): string {
  const lines: string[] = [];
  lines.push(
    `Citation manifest for ${manifest.recommendationId} — ${(manifest.supportRatio * 100).toFixed(0)}% supported (${manifest.unsupportedClaimCount} unsupported)`,
  );
  for (const c of manifest.citations) {
    const tag = c.unsupported ? "UNSUPPORTED" : `${c.evidenceRefs.length} evidence (score ${c.matchScore.toFixed(2)})`;
    lines.push(`  [${tag}] ${c.claim}`);
    for (const ref of c.evidenceRefs) {
      lines.push(`    → ${ref.toolName}@${ref.timestamp}: ${ref.summary}`);
    }
  }
  return lines.join("\n");
}

export function manifestToPayload(manifest: CitationManifest): Record<string, unknown> {
  return {
    kind: "citation.manifest_recorded",
    recommendationId: manifest.recommendationId,
    claimCount: manifest.citations.length,
    unsupportedClaimCount: manifest.unsupportedClaimCount,
    totalEvidenceCount: manifest.totalEvidenceCount,
    supportRatio: Number(manifest.supportRatio.toFixed(2)),
  };
}
