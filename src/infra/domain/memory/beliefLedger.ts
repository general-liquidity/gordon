/**
 * Belief-tension counter — a belief-revision primitive.
 *
 * A stored `Belief` is a durable claim the agent holds ("BTC is in a macro
 * uptrend", "funding stays positive into the print"). When a new observation
 * CONTRADICTS a belief, a `Tension` is opened against it with a for/against
 * counter that ticks per update. Supporting observations tick the `for` side;
 * contradicting ones tick `against`. When the net weight crosses an adjustable
 * `bar`, the tension recommends a `Verdict`: `flip` the belief (the
 * contradictions won) or `reconfirm` it (the support held). The bar is a
 * skepticism knob — higher skepticism LOWERS the bar, so fewer contradictions
 * are needed to flip.
 *
 * This is a DETERMINISTIC revision primitive, distinct from the LLM-narrative
 * supersession the conversation summarizer performs: reconciliation here is a
 * pure integer tally with no model in the loop. It is also NOT a hot-tier
 * write — the crossed tensions render into their own prompt block
 * (`renderBeliefTensionsBlock`), the same injection seam ACE uses for
 * `shared.ace-lessons`.
 *
 * Ported from gordon-rs `crates/gordon-memory/src/belief.rs`. Everything is
 * pure and dependency-light: timestamps are caller-supplied epoch values, the
 * counters are integers, and the whole module is deterministic under test.
 */

/** The prompt-section key the crossed tensions render into. */
export const BELIEF_TENSIONS_SECTION_KEY = "shared.belief-tensions";

/**
 * The default flip bar: net contradictions needed to recommend a flip at
 * neutral skepticism.
 */
export const DEFAULT_BAR = 3;

/** Which way a fresh observation cuts relative to a stored belief. */
export type Stance = "supports" | "contradicts";

/** What the accumulated tension recommends for the belief. */
export type Verdict = "hold" | "flip" | "reconfirm";

/**
 * Lifecycle status of a stored belief. A belief starts `active`; applying a
 * verdict moves it to `flipped` or `reconfirmed`.
 */
export type BeliefStatus = "active" | "flipped" | "reconfirmed";

/** A durable claim the agent holds. */
export interface Belief {
  /** Stable identifier (caller-assigned). */
  id: string;
  /** The claim itself, e.g. "BTC macro uptrend intact". */
  statement: string;
  /** Current lifecycle status. */
  status: BeliefStatus;
  /** Instrument the belief concerns, if any. */
  symbol?: string;
  /** Where the belief came from, e.g. "regime-scan:2026-07-01". */
  provenance?: string;
  /** Creation timestamp (epoch seconds), if recorded. */
  createdAt?: number;
}

export interface NewBeliefOptions {
  symbol?: string;
  provenance?: string;
  createdAt?: number;
}

/** Construct an active belief. */
export function makeBelief(id: string, statement: string, opts: NewBeliefOptions = {}): Belief {
  const belief: Belief = { id, statement, status: "active" };
  if (opts.symbol !== undefined) belief.symbol = opts.symbol;
  if (opts.provenance !== undefined) belief.provenance = opts.provenance;
  if (opts.createdAt !== undefined) belief.createdAt = opts.createdAt;
  return belief;
}

/**
 * Lower the flip bar as skepticism rises. `skepticism` is clamped to [0, 1];
 * at 0 the bar is `base`, at 1 it is 1 (a single contradiction flips). A more
 * skeptical operator abandons a belief on weaker contradicting evidence.
 */
export function flipBar(base: number, skepticism: number): number {
  const b = Math.max(1, Math.trunc(base));
  const span = b - 1;
  const clamped = Math.min(1, Math.max(0, skepticism));
  const reduction = Math.round(clamped * span);
  return Math.max(1, b - reduction);
}

/**
 * An open tension against a belief: a running for/against tally with a flip
 * bar. One tension exists per challenged belief; it ticks per observation and
 * reports its current `Verdict`.
 */
export interface Tension {
  /** The belief this tension challenges. */
  beliefId: string;
  /** Observations consistent with the belief. */
  forCount: number;
  /** Observations that cut against the belief. */
  againstCount: number;
  /** Total ticks recorded (for/against combined). */
  updates: number;
  /** Net weight (in either direction) at which a verdict is recommended. */
  bar: number;
}

function newTension(beliefId: string, bar: number): Tension {
  return { beliefId, forCount: 0, againstCount: 0, updates: 0, bar: Math.max(1, bar) };
}

/**
 * Net contradiction weight: `against - for`. Positive leans toward a flip,
 * negative toward a reconfirm.
 */
export function tensionWeight(t: Tension): number {
  return t.againstCount - t.forCount;
}

/** The current recommendation given the accumulated weight and the bar. */
export function tensionVerdict(t: Tension): Verdict {
  const weight = tensionWeight(t);
  if (weight >= t.bar) return "flip";
  if (-weight >= t.bar) return "reconfirm";
  return "hold";
}

/** Whether a tension has crossed the bar in either direction. */
export function tensionCrossed(t: Tension): boolean {
  return tensionVerdict(t) !== "hold";
}

/** Tick a tension's counter for one observation and return the new verdict. */
function recordTension(t: Tension, stance: Stance): Verdict {
  if (stance === "supports") t.forCount += 1;
  else t.againstCount += 1;
  t.updates += 1;
  return tensionVerdict(t);
}

/** Serializable snapshot of a ledger — the shape `toJSON` emits. */
export interface BeliefLedgerSnapshot {
  beliefs: Belief[];
  tensions: Tension[];
  bar: number;
}

/**
 * The belief layer of the memory subsystem: the stored beliefs plus the open
 * tensions challenging them. Its output is an injected prompt block, not a
 * hot-tier write.
 *
 * A tension is opened lazily: the first CONTRADICTING observation against a
 * belief opens it. Supporting observations against a belief with no open
 * tension are no-ops — an unchallenged belief needs no counter.
 */
export class BeliefLedger {
  beliefs: Belief[] = [];
  tensions: Tension[] = [];
  /** The flip bar new tensions inherit. Defaults to DEFAULT_BAR. */
  bar: number = DEFAULT_BAR;

  /** Set the flip bar directly for tensions opened after this call. */
  withBar(bar: number): this {
    this.bar = Math.max(1, Math.trunc(bar));
    return this;
  }

  /**
   * Derive the flip bar from a skepticism level ([0, 1]). Higher skepticism
   * lowers the bar (see `flipBar`).
   */
  withSkepticism(skepticism: number): this {
    this.bar = flipBar(DEFAULT_BAR, skepticism);
    return this;
  }

  /** Register a belief. Returns its index for later lookup. */
  addBelief(belief: Belief): number {
    this.beliefs.push(belief);
    return this.beliefs.length - 1;
  }

  belief(id: string): Belief | undefined {
    return this.beliefs.find((b) => b.id === id);
  }

  tension(beliefId: string): Tension | undefined {
    return this.tensions.find((t) => t.beliefId === beliefId);
  }

  /**
   * Record an observation against a belief and return the tension's verdict.
   *
   * Returns `undefined` when the belief is unknown, or when a SUPPORTING
   * observation arrives for a belief with no open tension (nothing to tally).
   * A CONTRADICTING observation opens a tension if none exists yet.
   */
  observe(beliefId: string, stance: Stance): Verdict | undefined {
    if (!this.belief(beliefId)) return undefined;
    const existing = this.tension(beliefId);
    if (existing) return recordTension(existing, stance);
    if (stance === "contradicts") {
      const tension = newTension(beliefId, this.bar);
      const verdict = recordTension(tension, stance);
      this.tensions.push(tension);
      return verdict;
    }
    return undefined;
  }

  /**
   * The open tensions that have crossed the bar, with the verdict each
   * recommends — the set an operator (or the loop) should act on.
   */
  pending(): Array<{ tension: Tension; verdict: Verdict }> {
    return this.tensions
      .filter(tensionCrossed)
      .map((tension) => ({ tension, verdict: tensionVerdict(tension) }));
  }

  /**
   * Apply the current recommendation for `beliefId`: on `flip` the belief
   * becomes `flipped`, on `reconfirm` it becomes `reconfirmed`, and the
   * resolved tension is dropped. Returns the applied verdict, or `undefined`
   * if there is no tension or it has not crossed the bar (a `hold` is left
   * standing).
   */
  resolve(beliefId: string): Verdict | undefined {
    const idx = this.tensions.findIndex((t) => t.beliefId === beliefId);
    if (idx === -1) return undefined;
    const verdict = tensionVerdict(this.tensions[idx]!);
    if (verdict === "hold") return undefined;
    const belief = this.belief(beliefId);
    if (belief) belief.status = verdict === "flip" ? "flipped" : "reconfirmed";
    this.tensions.splice(idx, 1);
    return verdict;
  }

  get length(): number {
    return this.beliefs.length;
  }

  isEmpty(): boolean {
    return this.beliefs.length === 0;
  }

  /** Plain-object snapshot for persistence. */
  toJSON(): BeliefLedgerSnapshot {
    return { beliefs: this.beliefs, tensions: this.tensions, bar: this.bar };
  }

  /** Reconstruct a ledger from a snapshot (round-trips `toJSON`). */
  static fromJSON(snapshot: BeliefLedgerSnapshot): BeliefLedger {
    const ledger = new BeliefLedger();
    ledger.beliefs = snapshot.beliefs.map((b) => ({ ...b }));
    ledger.tensions = snapshot.tensions.map((t) => ({ ...t }));
    ledger.bar = Math.max(1, snapshot.bar);
    return ledger;
  }
}

/**
 * Render the crossed tensions into the `shared.belief-tensions` prompt block,
 * or `undefined` when nothing has crossed the bar. Injected like
 * `shared.ace-lessons` — never written to the hot tier.
 */
export function renderBeliefTensionsBlock(ledger: BeliefLedger): string | undefined {
  const lines: string[] = [];
  for (const { tension, verdict } of ledger.pending()) {
    if (verdict === "hold") continue;
    const statement = ledger.belief(tension.beliefId)?.statement ?? tension.beliefId;
    const action = verdict === "flip" ? "FLIP" : "RECONFIRM";
    lines.push(
      `- ${action}: "${statement}" (for ${tension.forCount}, against ${tension.againstCount})`,
    );
  }
  if (lines.length === 0) return undefined;
  return `Belief tensions to resolve:\n${lines.join("\n")}`;
}
