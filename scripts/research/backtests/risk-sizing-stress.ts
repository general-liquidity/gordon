/**
 * Risk/sizing-spine stress test — property test for the money-path sizer.
 *
 * Hammers `sizeCompetitionTrade` (the single sizing decision the competition
 * money-path routes every trade through) across a WIDE grid of market conditions
 * and ASSERTS the invariants that must hold or a live account blows up:
 *
 *   • sizeNotional ≥ 0 always; never NaN/Infinity in ANY numeric field.
 *   • leverageUsed ≤ maxLeverage (+ε).
 *   • when the binding constraint is `risk_per_trade`: riskPct ≤ maxRiskPerTradePct (+ε).
 *   • dailyPnL ≤ −kill·equity  ⇒  verdict "halt" (daily_loss_kill).
 *   • openExposure ≥ cap·equity ⇒ verdict "skip" (exposure_cap).
 *   • sizeUnits · price ≈ sizeNotional (the units/notional identity).
 *
 * Violations are COLLECTED (not thrown) with the exact input that produced them,
 * so one run reports every breach. Also reports the binding-constraint
 * distribution per preset — a sanity check on the frozen survival config (which
 * cap actually dominates the grid).
 *
 * Run:  bun run scripts/research/backtests/risk-sizing-stress.ts
 *
 * Pure: no I/O, no disk, no network. Exercises Gordon's real preset code.
 */

import {
  sizeCompetitionTrade,
  COMPETITION_RISK_SURVIVAL,
  COMPETITION_RISK_DEFAULTS,
  COMPETITION_RISK_AGGRESSIVE,
  type CompetitionRiskParams,
  type CompetitionTradeInput,
  type CompetitionTradeResult,
  type BindingConstraint,
} from "../../../src/core/risk-management/competition-risk-preset.ts";

// ── Numeric tolerance for the inequality + identity checks ──────────────────
// leverageUsed/riskPct are rounded by the sizer (3 / 5 dp); ε must clear that
// rounding plus float noise without masking a real overshoot.
const EPS = 1e-3;
const IDENTITY_REL_EPS = 1e-4; // sizeUnits·price vs sizeNotional (both rounded)

const PRESETS: { name: string; params: CompetitionRiskParams }[] = [
  { name: "SURVIVAL", params: COMPETITION_RISK_SURVIVAL },
  { name: "DEFAULTS", params: COMPETITION_RISK_DEFAULTS },
  { name: "AGGRESSIVE", params: COMPETITION_RISK_AGGRESSIVE },
];

// ── Grid axes — span the realistic-to-pathological range on every dimension ──
const EQUITIES = [1e-2, 1, 100, 1_000_000, 1e12]; // tiny … huge
const PRICES = [1e-4, 1e-2, 1, 100, 10_000, 1e5]; // sub-penny … high
// stopDistance is swept as a FRACTION of price so it is meaningful across the
// 9-order-of-magnitude price range (an absolute 0.0001 stop is huge at price
// 1e-4 and invisible at 1e5). Spans a 0.5bps stop … a 200% stop.
const STOP_FRACS = [5e-5, 1e-3, 0.01, 0.05, 0.2, 1, 2];
const VOLS = [0.01, 0.1, 0.35, 0.8, 1.5, 3.0]; // 1% … 300% annualized
// openExposure swept as a MULTIPLE of equity so it crosses every preset's cap.
const EXPOSURE_MULTS = [0, 0.5, 1, 2.9, 3, 5, 10, 11]; // straddles 3× / 10× caps
// dailyPnL swept as a FRACTION of equity so it crosses every preset's kill.
const PNL_FRACS = [0.05, 0, -0.029, -0.03, -0.05, -0.08, -0.5]; // straddles 3% / 8% kills
const EDGES: (CompetitionTradeInput["edge"] | undefined)[] = [
  undefined,
  { winProb: 0.55, payoffRatio: 1.5 },
  { winProb: 0.4, payoffRatio: 0.8 }, // negative-edge → Kelly clamps to 0
];

// ── Violation record ────────────────────────────────────────────────────────
interface Violation {
  rule: string;
  preset: string;
  input: CompetitionTradeInput;
  result: CompetitionTradeResult;
  detail: string;
}

const finite = (x: number): boolean => Number.isFinite(x);

function checkInvariants(
  presetName: string,
  params: CompetitionRiskParams,
  input: CompetitionTradeInput,
  r: CompetitionTradeResult,
  out: Violation[],
): void {
  const push = (rule: string, detail: string): void => {
    out.push({ rule, preset: presetName, input, result: r, detail });
  };

  // 1. No NaN / Infinity in any numeric field.
  for (const [k, v] of Object.entries({
    sizeNotional: r.sizeNotional,
    sizeUnits: r.sizeUnits,
    leverageUsed: r.leverageUsed,
    riskPct: r.riskPct,
  })) {
    if (!finite(v)) push("finite", `${k}=${v} is not finite`);
  }

  // 2. sizeNotional ≥ 0 (and sizeUnits ≥ 0).
  if (r.sizeNotional < 0) push("nonneg_notional", `sizeNotional=${r.sizeNotional} < 0`);
  if (r.sizeUnits < 0) push("nonneg_units", `sizeUnits=${r.sizeUnits} < 0`);
  if (r.leverageUsed < 0) push("nonneg_leverage", `leverageUsed=${r.leverageUsed} < 0`);

  // 3. leverageUsed ≤ maxLeverage (+ε). Only meaningful on an actual trade.
  if (r.verdict === "trade" && r.leverageUsed > params.maxLeverage + EPS) {
    push("leverage_cap", `leverageUsed=${r.leverageUsed} > maxLeverage=${params.maxLeverage}`);
  }

  // 4. When the binding constraint is risk_per_trade, riskPct ≤ maxRiskPerTradePct (+ε).
  if (r.verdict === "trade" && r.bindingConstraint === "risk_per_trade") {
    if (r.riskPct > params.maxRiskPerTradePct + EPS) {
      push("risk_per_trade_cap", `riskPct=${r.riskPct} > maxRiskPerTradePct=${params.maxRiskPerTradePct} (binding=risk_per_trade)`);
    }
  }

  // 5. dailyPnL ≤ −kill·equity ⇒ verdict "halt" (daily_loss_kill).
  //    Guard only on valid inputs — invalid inputs short-circuit to "skip" before
  //    the kill check, which is correct (can't size garbage), so exclude them.
  const validInputs =
    input.equity > 0 && input.price > 0 && input.stopDistance > 0 && input.instrumentVolAnnual > 0;
  if (validInputs && input.dailyPnL <= -params.dailyLossKillPct * input.equity) {
    if (r.verdict !== "halt") {
      push("kill_halts", `dailyPnL=${input.dailyPnL} ≤ −kill(${params.dailyLossKillPct})·equity(${input.equity}) but verdict=${r.verdict}`);
    } else if (r.bindingConstraint !== "daily_loss_kill") {
      push("kill_binding", `halt but bindingConstraint=${r.bindingConstraint} (expected daily_loss_kill)`);
    }
  }

  // 6. openExposure ≥ cap·equity ⇒ verdict "skip" (exposure_cap).
  //    Only when NOT already halted by the daily-loss kill (kill checks first).
  const killed = validInputs && input.dailyPnL <= -params.dailyLossKillPct * input.equity;
  if (validInputs && !killed && input.openExposureNotional >= params.maxConcurrentExposurePct * input.equity) {
    if (r.verdict !== "skip") {
      push("exposure_skips", `openExposure=${input.openExposureNotional} ≥ cap(${params.maxConcurrentExposurePct})·equity(${input.equity}) but verdict=${r.verdict}`);
    } else if (r.bindingConstraint !== "exposure_cap") {
      push("exposure_binding", `skip but bindingConstraint=${r.bindingConstraint} (expected exposure_cap)`);
    }
  }

  // 7. sizeUnits · price ≈ sizeNotional (the units/notional identity).
  //    The sizer reports sizeNotional rounded to 2dp and sizeUnits to 6dp, so the
  //    two fields cannot agree more tightly than those roundings allow. Tolerance
  //    = half-ULP of the notional rounding (0.005) + the price-scaled half-ULP of
  //    the units rounding (5e-7·price) + a small relative float margin. A breach
  //    of THIS bound is a real units/notional inconsistency, not display rounding.
  if (r.verdict === "trade") {
    const recomputed = r.sizeUnits * input.price;
    const roundTol = 0.005 + 5e-7 * input.price + IDENTITY_REL_EPS * Math.abs(r.sizeNotional);
    if (Math.abs(recomputed - r.sizeNotional) > roundTol) {
      push("units_identity", `sizeUnits·price=${recomputed} vs sizeNotional=${r.sizeNotional} (absErr=${Math.abs(recomputed - r.sizeNotional).toExponential(2)}, tol=${roundTol.toExponential(2)})`);
    }
  }
}

function main(): void {
  console.log("=".repeat(78));
  console.log("RISK/SIZING SPINE STRESS TEST — sizeCompetitionTrade property test");
  console.log("=".repeat(78));

  const violations: Violation[] = [];
  // Binding-constraint distribution per preset (across the whole grid).
  const dist: Record<string, Record<string, number>> = {};
  const verdictDist: Record<string, Record<string, number>> = {};
  for (const { name } of PRESETS) {
    dist[name] = {};
    verdictDist[name] = {};
  }

  let cases = 0;
  for (const { name, params } of PRESETS) {
    for (const equity of EQUITIES) {
      for (const price of PRICES) {
        for (const stopFrac of STOP_FRACS) {
          const stopDistance = stopFrac * price;
          for (const instrumentVolAnnual of VOLS) {
            for (const expMult of EXPOSURE_MULTS) {
              const openExposureNotional = expMult * equity;
              for (const pnlFrac of PNL_FRACS) {
                const dailyPnL = pnlFrac * equity;
                for (const edge of EDGES) {
                  const input: CompetitionTradeInput = {
                    equity,
                    price,
                    stopDistance,
                    instrumentVolAnnual,
                    openExposureNotional,
                    dailyPnL,
                    edge,
                    params,
                  };
                  const r = sizeCompetitionTrade(input);
                  cases++;

                  checkInvariants(name, params, input, r, violations);

                  dist[name]![r.bindingConstraint] = (dist[name]![r.bindingConstraint] ?? 0) + 1;
                  verdictDist[name]![r.verdict] = (verdictDist[name]![r.verdict] ?? 0) + 1;
                }
              }
            }
          }
        }
      }
    }
  }

  console.log(`Grid axes          : presets=${PRESETS.length}, equity=${EQUITIES.length}, price=${PRICES.length}, stopFrac=${STOP_FRACS.length}, vol=${VOLS.length}, exposure=${EXPOSURE_MULTS.length}, pnl=${PNL_FRACS.length}, edge=${EDGES.length}`);
  console.log(`Total cases        : ${cases.toLocaleString()}`);
  console.log(`Invariant violations: ${violations.length}`);
  console.log("");

  // ── Binding-constraint distribution per preset ─────────────────────────────
  const ALL_CONSTRAINTS: BindingConstraint[] = [
    "risk_per_trade", "vol_target", "leverage", "kelly", "exposure_cap", "daily_loss_kill", "none",
  ];
  console.log("BINDING-CONSTRAINT DISTRIBUTION (which cap dominates the grid)");
  console.log("-".repeat(78));
  const header = ["preset".padEnd(11), ...ALL_CONSTRAINTS.map((c) => c.slice(0, 8).padStart(9))].join(" ");
  console.log(header);
  for (const { name } of PRESETS) {
    const row = [name.padEnd(11)];
    for (const c of ALL_CONSTRAINTS) {
      const n = dist[name]![c] ?? 0;
      const pct = ((n / cases) * PRESETS.length * 100).toFixed(0); // % within this preset
      row.push(`${pct}%`.padStart(9));
    }
    console.log(row.join(" "));
  }
  console.log("");

  console.log("VERDICT DISTRIBUTION");
  console.log("-".repeat(78));
  console.log(["preset".padEnd(11), "trade".padStart(10), "skip".padStart(10), "halt".padStart(10)].join(" "));
  for (const { name } of PRESETS) {
    const per = cases / PRESETS.length;
    const v = verdictDist[name]!;
    console.log([
      name.padEnd(11),
      `${(((v.trade ?? 0) / per) * 100).toFixed(0)}%`.padStart(10),
      `${(((v.skip ?? 0) / per) * 100).toFixed(0)}%`.padStart(10),
      `${(((v.halt ?? 0) / per) * 100).toFixed(0)}%`.padStart(10),
    ].join(" "));
  }
  console.log("");

  // ── Verdict ────────────────────────────────────────────────────────────────
  console.log("=".repeat(78));
  console.log("VERDICT");
  console.log("=".repeat(78));
  if (violations.length === 0) {
    console.log(`PASS — ${cases.toLocaleString()} cases, 0 invariant violations.`);
    console.log("The sizer held every safety invariant across the full pathological grid:");
    console.log("non-negative size, leverage ≤ cap, risk ≤ cap when binding, kill→halt,");
    console.log("exposure→skip, units·price≡notional, no NaN/Infinity anywhere.");
  } else {
    // Group by (rule) for a compact report, then show the first offending input each.
    const byRule = new Map<string, Violation[]>();
    for (const v of violations) {
      const key = `${v.rule}`;
      (byRule.get(key) ?? byRule.set(key, []).get(key)!).push(v);
    }
    console.log(`FAIL — ${violations.length} invariant violation(s) across ${cases.toLocaleString()} cases.`);
    console.log("");
    for (const [rule, vs] of byRule) {
      const first = vs[0]!;
      console.log(`  [${rule}] ×${vs.length}  (preset ${first.preset})`);
      console.log(`    detail: ${first.detail}`);
      console.log(`    input : ${JSON.stringify(first.input)}`);
      console.log(`    result: ${JSON.stringify(first.result)}`);
    }
  }
  console.log("");

  if (violations.length > 0) process.exitCode = 1;
}

main();
