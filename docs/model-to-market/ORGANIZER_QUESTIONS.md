# Questions for the Organizers — open unknowns that affect how we win

Filtered to what is **genuinely open, ambiguous, or uncalibrated** (we exclude already-confirmed facts:
equity carries over, native-MT5-only, short-selling allowed, no commission, automated adaptation
allowed, 30:1 / 30% stop-out, 70/15/10/5 weights, peer-visible rounds / blind finals, fixed-K-TBC,
live-data-setup-window, depth ladder, limit-fills-not-guaranteed-on-touch). Each item notes **why it
changes our play.** Tier 1 first — those would actually change the strategy or sizing.

---

## TIER 1 — would change HOW WE PLAY (ask first, before arming)

1. **Resting limit orders — allowed, or marketable-only (FOK/IOC)?** The kickoff said FOK/IOC-only (no resting orders); later messages say "limit orders rest as liquidity and fill by queue position." **Which is it?** *Why: if we can post resting limits, a maker/half-spread book becomes possible — it would flip our entire cost calculus and could turn the core net-positive. This is the single biggest open question.*

2. **Swap / overnight financing — does it apply, and at what rate per instrument, charged when (rollover time)?** Early Discord said "no swap," the rules left it "TBD." *Why: a 5-day hold across crypto/FX/metals — if swap applies it directly hits our cost model and tips us toward flatten-over-carry.*

3. **How do the 3 rounds + the final combine into the FINAL ranking?** Is the overall winner decided by **cumulative** performance over all 5 days, or by the **finals-window (24–26 Jun) only**? Does equity reset for the finals or carry in? *Why: this decides whether we protect a cumulative lead vs. reset our aggression for a blind finals sprint — a completely different endgame.*

4. **Exact per-round qualifier count K** (you said published after registration closed — 18 Jun). What K advances out of Rounds 1, 2, 3? *Why: it's the line the sleeve must clear; how far below it we are sets how hard we swing.*

5. **Exact Sharpe definition.** Is it the plain `Mean(r)/Std(r)` on 15-minute equity returns, **population or sample** std, **risk-free rate = 0**, and **how are gaps / missing bars / zero-variance periods handled**? Is it the classic Sharpe or a trimmed/winsorized variant (that discounts large gains)? *Why: 10% of score; the std convention and gap handling materially move a low-vol book's Sharpe.*

6. **Stop-out mechanics at the 30% margin level** — hard automatic full liquidation at exactly 30%, or a margin call / partial liquidation first? At what price (mid / bid-ask) are forced liquidations executed? *Why: our survival circuit-breaker is calibrated to flatten ABOVE this — we need the exact trigger and whether it's partial or total.*

7. **Trading hours over the 5-day window.** Do FX & metals trade over the weekend (21 Jun is a Sunday; the window spans a weekend), or only crypto 24/7? Are positions held flat / frozen during closed sessions, and is equity marked during them? *Why: our dollar-neutral pairs need both legs tradeable; if metals/FX close while crypto runs, the neutral book de-hedges over the weekend.*

---

## TIER 2 — CALIBRATION (sizing / risk precision)

8. **Slippage & market-impact model** — what function? Is it per-account (our own order size impacts our own fills only), and does it depend on order size vs displayed depth? *Why: sets the real cost of our reconcile orders and validates depth-aware sizing.*

9. **Order-book depth** — how many levels, typical top-of-book size per instrument (gold ~100 oz was cited), and does consumed depth **replenish** within a bar? *Why: caps how large each reconcile order can be before it walks the book.*

10. **Margin & leverage detail** — is 30:1 the max **per instrument or account-level**, and is the requirement different per asset class (crypto vs FX vs metals)? What's the margin formula (used margin = notional / leverage)? *Why: drives the margin-level calc our breaker watches and the sleeve's safe leverage.*

11. **MaxDD measurement** — computed on the **15-minute equity series** (close-to-close) or intra-bar peak-to-trough / tick? Cumulative from $1M (confirmed) — but at what sampling? *Why: 15% of score; intra-bar vs close-to-close changes our DD number.*

12. **Risk-Discipline (§13) measurement** — are the thresholds (margin >90%/30min, leverage >28×, etc.) evaluated **continuously or sampled**, and at what interval? Does the score truly reset to 100 each round? *Why: 5% of score; our risk samples need to match the platform's sampling.*

13. **Borrow cost for shorts** — any financing/borrow fee on short legs (separate from swap)? *Why: our core is half short by construction.*

14. **Trade count for the Best-Sharpe ≥30-trade gate** — counted as **round-trips, fills, or per-leg orders**? *Why: our breadth clears it easily either way, but we want to be sure.*

---

## TIER 3 — OPERATIONAL / don't-get-DQ'd / don't-break

15. **Disconnection behavior** — if our bridge/terminal drops, do open positions **persist untouched**, or is there a heartbeat/timeout that auto-flattens or restricts? Can we run **headless 24/7** with no session timeout? *Why: a 5-day unattended run; we must know if a dropout risks our book.*

16. **MT5 API rate limits** — the exact request/sec ceiling on the MT5 layer (vs the 500 req/s platform safe-harbor), and what happens at the boundary (throttle vs penalty)? *Why: our cadence + standing polling must stay under it.*

17. **What specifically counts as prohibited manipulation / exploitation** (the DQ triggers) — e.g., is rapid cancel/replace, or sizing to available depth, ever flagged? *Why: we want zero accidental-DQ risk from legitimate automated behavior.*

18. **Position / exposure limits** — any max position size per instrument or max gross/net exposure beyond the 30:1 margin constraint? *Why: caps our book construction.*

19. **Minimum activity for the MAIN competition** — is there a min-trade or min-activity requirement to be ranked at all (beyond the Best-Sharpe ≥30)? *Why: confirms a quiet survival book stays eligible.*

20. **Is the test account's data + execution identical to the live competition** (so our setup-window spread read and smoke test are valid for go-live)? *Why: we base the posture decision on the setup-window spread read.*

21. **Exact symbol strings + contract specs** at login — confirm the crypto ticker is literally `BARUSD` (underlying HBAR/Hedera), and the per-instrument `contract_size / tick_size / volume_min / volume_step / max`. *Why: sizing notional→lots depends on these exactly.*

---

## TIER 4 — LOGISTICS / SIDE PRIZES

22. **Tie-breakers** — confirm the order (Return > MaxDD > Sharpe > Risk-Discipline > activity?) and how N is defined for the rank percentile (all entrants, or active survivors?).
23. **In-person final (27 Jun, London)** — is attendance required to **claim the trading prizes**, or only for Best-Tech judging? What if a finalist can't travel?
24. **Best-Technology submission** — exact deliverables, format, deadline (after Round 3), and the weighting of the 3 axes (System Design / AI Integration / Execution).
25. **Anthropic bounty + NVIDIA/Nemotron prize** — specific criteria and how to be considered.
26. **Sharpe-award & main-comp interaction** — does winning Best-Sharpe require also being in the money on the main board, or are they fully independent prize pools?

---

### The 4 that most change our build if answered "the other way"
- **#1 resting limits** (maker possible → net-positive book),
- **#3 rounds→final combination** (protect lead vs finals sprint),
- **#6 stop-out mechanics** (breaker calibration),
- **#7 weekend trading hours** (does the neutral book stay hedged).
Get these before arming at 22:00; the rest can resolve in the first round.
