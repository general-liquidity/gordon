# Quant Library Adoption — Spec (branch `quant-lib-adoption`)

**Goal:** plan where Gordon's *hand-rolled* numerical/quant code can adopt mature TS/JS libraries,
to cut bug-surface and maintenance — as a **spec**, executed later, not a rushed refactor.

## Governing principles (read before specing)
1. **This is post-competition work.** The stack is validated/rehearsed-green; retrofitting libraries
   into working code carries re-validation cost + numeric-drift risk. Nothing here ships before the
   competition. The spec is the plan.
2. **Parity is mandatory.** Any swap must be validated against the current output (golden/tolerance),
   exactly like the TS→Python port. A library whose numerics diverge from a validated module is NOT a
   free swap — it needs re-baselining + re-validation.
3. **Prioritize bug-surface reduction over churn.** Replacing a gnarly hand-rolled numeric (erf,
   inverse-CDF, SVD, eigen, Cholesky, distributions) with a battle-tested lib is HIGH value. Replacing
   a working, tested classic indicator is LOW value (churn). Say which is which.
4. **Mind the dependency budget.** A CLI agent wants a tight tree. Heavy deps (TF.js-backed danfojs,
   etc.) need justification. Prefer focused libs (`@stdlib/*` sub-packages, `simple-statistics`).
5. **Name the gaps.** Where NO mature TS lib exists (econometrics: cointegration/GARCH/ADF/HMM), say
   so — those stay hand-rolled (or polyglot via WASM/sidecar), don't force a bad fit.

## Spec format — one row per opportunity (use a table per file/cluster)
| Module (file:line) | Hand-rolled | Candidate lib (API) | Replaces | Parity | Effort | Priority | Notes |
|---|---|---|---|---|---|---|---|
- **Parity:** `exact` (same algorithm) · `tolerance` (lib differs, re-baseline) · `divergent` (different method — risky) |
- **Effort:** S / M / L
- **Priority:** `HIGH` (bug-surface on gnarly numerics) · `MED` · `LOW` (churn on working code) · `SKIP` (no lib / econometrics gap)

## Files
- `00-CATALOG.md` — the authoritative TS/JS quant library catalog (web-researched), by use-case.
- `10-indicators.md` — core/indicators + core/market-analysis.
- `20-alpha-regime.md` — core/alpha + core/learning + core/regime + core/risk-kernel.
- `30-trading-infra.md` — infra/trading/{quant,risk,execution}.
- `40-backtest-strategies.md` — backtest/ + strategies/ + core/backtesting.
- `SPEC.md` — (synthesis) the prioritized master plan, written after the regions land.
