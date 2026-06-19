# Questions for the Organizers — still-open items that affect execution

Filtered to what is genuinely open as of **2026-06-19**. We exclude already-confirmed facts:
native MT5-only, AI-Native has no API/custom agents, resting limits allowed, cancel/replace allowed,
shorting allowed, no commission, no swap, no borrow fees, 30:1 account leverage, 30% stop-out,
70/15/10/5 weights, peer-visible rounds / blind finals, final 15 symbols, `BARUSD` = HBAR,
external data allowed, and platform safe-harbor <= 500 req/s.

## Tier 1 — changes launch or sizing

1. **Exact per-round qualifier count K.** What K advances out of Rounds 1, 2, and 3?  
   Why: this is the line the endgame sleeve must clear.

2. **Exact live launch time.** Is go-live **21 Jun 2026 22:00 BST** or the alternative 23:00 BST citation?  
   Why: arming, first preflight, and bars-to-deadline calculations depend on this.

3. **Per-instrument live specs.** Confirm final symbol strings, contract size, tick size, volume min/step/max, leverage/margin formula, and typical spreads from the live MT5 catalog.  
   Why: notional-to-lots conversion and depth sizing depend on this exactly.

4. **MT5-layer request limits.** What practical request/sec or burst limits apply to the MetaTrader5 path, separate from the platform's <=500 req/s safe harbor?  
   Why: maker cancel/replace cadence and standing polling must stay comfortably below the real limit.

5. **Trade-count semantics for the Best-Sharpe >=30 gate.** Are trades counted as fills, orders, round trips, or per-leg executions?  
   Why: the RV core should clear the floor either way, but we need the exact operational readout.

## Tier 2 — scoring calibration

6. **Sharpe definition details.** Confirm population vs sample std, risk-free rate = 0, treatment of missing/flat periods, and whether the <8-observation cap is exactly as written.  
   Why: affects the live standing monitor and Best-Sharpe read.

7. **MaxDD sampling.** Is MaxDD sampled on the 15-minute equity series, account ticks, or another platform cadence?  
   Why: intra-bar DD vs 15-minute DD changes rank estimates.

8. **Risk-discipline sampling.** Are §13 thresholds evaluated continuously or on fixed samples, and at what interval?  
   Why: the runner samples every cycle; we want the monitor to match platform scoring.

9. **Finals cutoff terminology.** At 24 Jun 22:00 BST, does the leaderboard simply go blind for Top 100, with final trading continuing until 26 Jun 22:00 BST?  
   Why: confirms phase gates and sleeve timing.

## Tier 3 — operational and judging

10. **Test environment fidelity.** Which parts of the setup/test account differ from live: spreads, depth, matching, fills, or rate limits?  
    Why: setup-window spread reads are useful, but maker fills must be judged from live Round 1 if the test environment differs.

11. **Position/order limits beyond margin.** Any per-instrument max lots, max pending orders, or gross/net exposure caps beyond 30:1 account leverage?  
    Why: caps maker probing and sleeve sizing.

12. **Best Technology submission deadline/format.** Exact deadline, repo access expectations, demo format, and whether the three judging axes have explicit weights.  
    Why: lets the tech deck and repo permissions be staged before Round 3.

13. **In-person final logistics.** Is London attendance required to claim trading prizes, or only for Best Technology judging?  
    Why: affects travel planning if we make Top 25/Top 100.

