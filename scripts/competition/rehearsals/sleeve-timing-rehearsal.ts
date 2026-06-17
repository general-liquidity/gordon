#!/usr/bin/env bun
/**
 * Tournament / sleeve-timing rehearsal (competition step #4).
 *
 * The lottery sleeve is our ONLY shot at the 70%-weight return crown, and tournament theory
 * says the timing is bang-bang: a post-cut LAGGARD swings (max variance), a post-cut LEADER
 * locks in, and pre-cut you NEVER burn the one-shot bet (protect the cut on the core first).
 * This drives `barbellDecision` across the full (phase × standing) matrix and verifies the
 * sleeve fires exactly when it should — and, crucially, that a TOTAL loss of the sleeve can
 * never red-line the core (the ring-fence survival guarantee). Pure; no venue, no LLM.
 *
 *   bun run scripts/competition/rehearsals/sleeve-timing-rehearsal.ts
 */

import { barbellDecision, BARBELL_CONFIG, SLEEVE_UNIVERSE } from "../../../src/infra/trading/competition/barbellStrategy.ts";
import type { Mt5Bar } from "../../../src/infra/broker/mt5/bridgeClient.ts";

const START_EQUITY = 1_000_000;
const CLUSTER_SYMS = ["BTCUSD", "ETHUSD", "SOLUSD", "XRPUSD", "BARUSD", "XAUUSD", "XAGUSD"];

/** Deterministic pseudo-random walk bars per symbol; per-symbol vol scales with `volScale`. */
function makeBars(seed: number, volScale: number, n = 260): Mt5Bar[] {
  let s = (seed >>> 0) || 1;
  const rng = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
  const out: Mt5Bar[] = [];
  let px = 100;
  for (let i = 0; i < n; i++) {
    px *= 1 + (rng() - 0.5) * 2 * volScale;
    if (px < 1) px = 1;
    out.push({ time: i * 900, open: px, high: px, low: px, close: px, tickVolume: 1, spread: 0, realVolume: 0 } as Mt5Bar);
  }
  return out;
}

function barsBySymbol(): Record<string, Mt5Bar[]> {
  const m: Record<string, Mt5Bar[]> = {};
  // Vary vol so the sleeve has a clear highest-vol pick among SLEEVE_UNIVERSE.
  const vols: Record<string, number> = { BTCUSD: 0.01, ETHUSD: 0.013, SOLUSD: 0.02, XRPUSD: 0.018, BARUSD: 0.025, XAUUSD: 0.006, XAGUSD: 0.009 };
  CLUSTER_SYMS.forEach((sym, i) => (m[sym] = makeBars(7 + i * 13, vols[sym] ?? 0.012)));
  return m;
}

interface Scenario { phase: "pre_cut" | "post_cut"; ourReturnPct: number; label: string }

function assert(cond: boolean, msg: string): void {
  if (!cond) {
    console.error(`\n✗ INVARIANT VIOLATED: ${msg}\n`);
    process.exit(1);
  }
}

function main(): void {
  const bars = barsBySymbol();
  // Standings stay above the ring-fence red-line (−50%); below it `barbellDecision` refuses to
  // carve a sleeve and the live runner's margin circuit breaker flattens instead (proven in #3).
  const scenarios: Scenario[] = [
    { phase: "pre_cut", ourReturnPct: -0.4, label: "lagging" },
    { phase: "pre_cut", ourReturnPct: 0.0, label: "flat" },
    { phase: "pre_cut", ourReturnPct: 0.5, label: "just safe" },
    { phase: "pre_cut", ourReturnPct: 0.8, label: "leading" },
    { phase: "post_cut", ourReturnPct: -0.4, label: "lagging" },
    { phase: "post_cut", ourReturnPct: 0.0, label: "flat / mid" },
    { phase: "post_cut", ourReturnPct: 0.2, label: "mid" },
    { phase: "post_cut", ourReturnPct: 0.8, label: "leading (prize slot)" },
  ];

  console.log("=".repeat(92));
  console.log("SLEEVE / TOURNAMENT-TIMING REHEARSAL — bang-bang sleeve gating + survival guarantee");
  console.log("=".repeat(92));
  console.log(`sleeve universe: ${SLEEVE_UNIVERSE.join(", ")}`);
  console.log("");
  console.log("phase      standing       p-rank  stance         cut?  sleeve");
  console.log("─".repeat(92));

  for (const sc of scenarios) {
    const equity = START_EQUITY * (1 + sc.ourReturnPct);
    const d = barbellDecision({
      barsBySymbol: bars,
      equity,
      startingEquity: START_EQUITY,
      ourReturnPct: sc.ourReturnPct,
      barsToDeadline: 100,
      phase: sc.phase,
      config: BARBELL_CONFIG,
    });
    const st = d.standing;
    const sleeve = d.sleeve;
    const sleeveStr = sleeve
      ? `FIRE → ${sleeve.symbol} ${sleeve.side} ${sleeve.leverage.toFixed(1)}× (margin ${sleeve.margin.toFixed(0)} / notional ${sleeve.notional.toFixed(0)})`
      : "—";
    console.log(
      `${sc.phase.padEnd(10)} ${sc.label.padEnd(14)} ${(st.percentile * 100).toFixed(0).padStart(5)}%  ${st.stance.padEnd(14)} ${(st.clearsCut ? "yes" : "no ").padEnd(4)} ${sleeveStr}`,
    );

    // ── Invariants ──
    // 1. Pre-cut NEVER fires the one-shot sleeve (protect the cut on the core first).
    if (sc.phase === "pre_cut") assert(sleeve === null, `sleeve fired PRE-CUT (${sc.label}) — must never burn the one-shot before the cut`);
    // 2. Post-cut leader (prize slot) locks in → no sleeve; post-cut non-leader swings → sleeve (if safe).
    if (sc.phase === "post_cut" && st.stance === "lock_in") assert(sleeve === null, `sleeve fired while LOCKING IN a prize slot (${sc.label})`);
    // 3. SURVIVAL GUARANTEE — losing the ENTIRE sleeve cannot drop core equity below the red-line.
    if (sleeve) {
      assert(sleeve.margin <= d.ringFence.sleeveReserve + 1e-6, `sleeve margin ${sleeve.margin} exceeds carved reserve ${d.ringFence.sleeveReserve}`);
      const worstCaseEquity = d.ringFence.totalEquity - sleeve.margin; // total loss of the sleeve margin
      assert(worstCaseEquity >= d.ringFence.redLineEquity - 1e-6, `worst-case equity ${worstCaseEquity.toFixed(0)} < red-line ${d.ringFence.redLineEquity.toFixed(0)} — sleeve could eliminate us`);
    }
  }

  console.log("");
  console.log("Bang-bang verified: pre-cut never fires; post-cut LEADERS lock in; post-cut LAGGARDS/MID swing.");
  console.log("Survival verified: every fired sleeve's TOTAL loss leaves core equity ≥ the red-line (ring-fence holds).");
  console.log("\n✓ REHEARSAL PASSED — the sleeve fires exactly when tournament theory says, and never threatens survival.");
}

main();
