/**
 * Token unlock-schedule risk.
 *
 * In equities the fraud hides in accruals and footnotes; in crypto it hides in
 * supply schedules. Team/VC allocations vest over years, and when they unlock
 * the people who got in near zero get to exit into retail. This classifies an
 * unlock schedule's shape (cliff / linear / mixed), flags any single unlock
 * above a hard fraction of circulating supply (rule of thumb: > 5%), measures
 * the total overhang, and surfaces the next unlock — with extra weight on
 * cliffs into team/investor wallets ("the one that ends portfolios").
 *
 * Pure function. The caller supplies the schedule + circulating supply (data
 * later from DefiLlama / Tokenomist / TokenUnlocks); `now` is injected for a
 * deterministic next-unlock read.
 */

export type UnlockRecipient =
  | "team"
  | "investor"
  | "community"
  | "ecosystem"
  | "foundation"
  | "public"
  | "unknown";

export interface UnlockEvent {
  /** ISO date of the unlock. */
  date: string;
  /** Token amount unlocked (same units as circulatingSupply). */
  amount: number;
  /** Who receives it. team/investor cliffs are the dangerous ones. */
  recipient?: UnlockRecipient;
}

export interface TokenUnlockInput {
  events: UnlockEvent[];
  /** Current circulating supply (tokens). */
  circulatingSupply: number;
  /** Total/max supply, for the FDV-overhang ratio. Optional. */
  totalSupply?: number;
  /** ISO "now" — events on/after this are upcoming. Optional (else earliest-first). */
  now?: string;
  /** Single-unlock flag threshold, % of circulating. Default 5. */
  cliffThresholdPct?: number;
}

export type UnlockShape = "cliff" | "linear" | "mixed" | "none";

export interface ScoredUnlock {
  date: string;
  amount: number;
  recipient: UnlockRecipient;
  pctOfCirculating: number;
  flagged: boolean;
}

export interface TokenUnlockResult {
  events: ScoredUnlock[];
  shape: UnlockShape;
  nextUnlock: ScoredUnlock | null;
  /** Sum of upcoming unlocks as % of circulating. */
  totalOverhangPct: number;
  /** Largest single unlock as % of circulating. */
  largestUnlockPct: number;
  /** totalSupply / circulatingSupply, if totalSupply supplied. */
  fdvToCirculating: number | null;
  flags: string[];
  verdict: "high_risk" | "moderate" | "low";
  summary: string;
}

const INSIDER: ReadonlySet<UnlockRecipient> = new Set(["team", "investor", "foundation"]);

export function computeTokenUnlockRisk(input: TokenUnlockInput): TokenUnlockResult {
  const threshold = input.cliffThresholdPct ?? 5;
  const circ = input.circulatingSupply;
  const valid = circ > 0;

  const sorted = [...input.events].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const scored: ScoredUnlock[] = sorted.map((e) => {
    const pct = valid ? (e.amount / circ) * 100 : 0;
    return {
      date: e.date,
      amount: e.amount,
      recipient: e.recipient ?? "unknown",
      pctOfCirculating: parseFloat(pct.toFixed(4)),
      flagged: pct >= threshold,
    };
  });

  // Shape from the amount distribution.
  let shape: UnlockShape = "none";
  if (scored.length > 0) {
    const amounts = scored.map((e) => e.amount);
    const total = amounts.reduce((s, x) => s + x, 0);
    const maxShare = total > 0 ? Math.max(...amounts) / total : 0;
    const mean = total / amounts.length;
    const variance = amounts.reduce((s, x) => s + (x - mean) * (x - mean), 0) / amounts.length;
    const cov = mean > 0 ? Math.sqrt(variance) / mean : 0;
    if (maxShare >= 0.5) shape = "cliff";
    else if (cov < 0.25) shape = "linear";
    else shape = "mixed";
  }

  const upcoming = input.now ? scored.filter((e) => e.date >= input.now!) : scored;
  const nextUnlock = upcoming[0] ?? null;
  const totalOverhangPct = valid
    ? parseFloat(((upcoming.reduce((s, e) => s + e.amount, 0) / circ) * 100).toFixed(4))
    : 0;
  const largestUnlockPct =
    scored.length > 0 ? Math.max(...scored.map((e) => e.pctOfCirculating)) : 0;
  const fdvToCirculating =
    input.totalSupply != null && valid ? parseFloat((input.totalSupply / circ).toFixed(4)) : null;

  const flags: string[] = [];
  const flaggedUpcoming = upcoming.filter((e) => e.flagged);
  for (const e of flaggedUpcoming) {
    flags.push(
      `${e.date}: ${e.pctOfCirculating.toFixed(1)}% of circulating unlocks` +
        (INSIDER.has(e.recipient) ? ` to ${e.recipient} (cliff-into-insider risk)` : ""),
    );
  }
  if (totalOverhangPct >= 50)
    flags.push(`total overhang ${totalOverhangPct.toFixed(0)}% of circulating`);

  const insiderCliff = flaggedUpcoming.some((e) => INSIDER.has(e.recipient));
  const verdict: TokenUnlockResult["verdict"] =
    (insiderCliff && shape === "cliff") || largestUnlockPct >= 4 * threshold
      ? "high_risk"
      : flaggedUpcoming.length > 0 || totalOverhangPct >= 50
        ? "moderate"
        : "low";

  const summary = !valid
    ? "Invalid circulating supply — cannot score unlock risk."
    : `Unlock schedule: ${shape}, ${scored.length} event(s), largest ${largestUnlockPct.toFixed(1)}% of circulating, ` +
      `overhang ${totalOverhangPct.toFixed(0)}%. ` +
      (nextUnlock
        ? `Next: ${nextUnlock.date} (${nextUnlock.pctOfCirculating.toFixed(1)}%). `
        : "") +
      `Verdict: ${verdict}.`;

  return {
    events: scored,
    shape,
    nextUnlock,
    totalOverhangPct,
    largestUnlockPct,
    fdvToCirculating,
    flags,
    verdict,
    summary,
  };
}
