# Gordon — Best Technology Setup Submission

**Model to Market: The Quantitative Hack — §9 Top-25 technical submission.**
Targets the **Best Technology Setup** prize ($10k) and the **Anthropic** + **NVIDIA** partner bounties.

> The §9 form, structured to the competition's three published judging axes — **System Design · AI Integration · Execution Approach** — plus the §9 deliverables: the GitHub repo, the partner-technology overview, the data-usage details, and the demo. Numbers knowable only after the live week (final Sharpe, rank, trade count) are marked **`[TBD post-comp]`**.

---

## 1. Thesis

**One line:** *Gordon is a governed, AI-native trading OS built on **bounded autonomy** — the agent reasons and proposes, a structural risk plane the strategy cannot override decides, and only human-approved decision objects reach the venue.*

Most entrants ship a strategy script wired to an API. Gordon ships the *system around* the strategy — a capital-safety plane, an eval harness, an MT5 execution bridge, and a self-correcting autonomy loop — and then a posture that was selected **honestly**, against the competition's exact objective function, after costs.

The design thesis is not ours alone. **Hui Gong, "Bounded Autonomy" (UCL, arXiv 2603.13942)** argues the value of an AI agent **is not proportional to its autonomy** — the win comes from *structuring the reasoning a human acts on*, not from removing the human. That is precisely Gordon's `create_plan → verify_plan → approve_plan → execute_plan` spine: the LLM produces a typed **decision object**, the risk plane gates it, and execution is human-approved and idempotent. Autonomy is bounded *by construction*, not by policy a clever prompt can talk past.

Why this shape fits *this* contest: it is a relative tournament with attrition, a leveraged two-week window, and a **blind** final phase (§14, §8). The format rewards **survive-and-compound over variance**. Forced liquidation is instant elimination — a system that *cannot* wipe out has a structural ranking edge before the strategy contributes a single basis point. And — as §6 below argues honestly — in a likely luck-dominated return tournament, **disciplined execution, survival, and the governance architecture are the defensible edges**.

---

## 2. System Design (judging axis 1 — architecture quality, scalability, robustness)

### 2.1 The governance plane (the moat)

Every state-changing action passes a deny-first gate the strategy layer cannot bypass:

- **15-dimension pre-trade risk classifier** — `src/infra/trading/risk/riskClassifier.ts`. 8 base + 7 hedge-fund-grade dimensions (vol-adjusted sizing, tail risk, correlation, venue/MEV, …) → one of `auto_approve | prompt_user | require_confirmation | block`.
- **Deny-first permission engine** — `src/runtime/permissions/PermissionEngine.ts` + `trustTrajectory.ts`. A hard deny-list (`place_order`, `execute_trade`, `cancel_*`, `wallet_transfer`) **bypasses trust scoring** — adaptive auto-approval can never reach the money-critical surface.
- **Trading constitution + signed audit log** on every write; `create/approve/execute_plan` and all `cancel_*` tools take a required `rationale` (min 10 chars), logged via `recordStructuredObservation` — the audit captures *intent*, not just the call.
- **Survive-and-compound sizer** — `src/core/risk-management/competition-risk-preset.ts` (`sizeCompetitionTrade`). A **min-of-caps** composition of per-trade-risk / vol-target / leverage / fractional-Kelly / exposure-cap / daily-loss-kill: the most conservative constraint always binds, so a losing streak can't cause ruin while vol-targeting keeps Sharpe central. Every sizing decision returns the `bindingConstraint` for audit.

### 2.2 Deliberately centralized multi-agent topology

`gordon` (orchestrator/router) → `executor` (has execution permissions) + `researcher` (does **not**) + a bounded `delegate_subagent` — `src/infra/agents/definitions/`.

The split is a **security boundary**, not an efficiency choice: only the executor can touch capital, every handoff is tracked, and the agents carry *different* tool subsets scoped by permission boundary. We deliberately did **not** collapse to a single agent — for a regulated, strict-verification money domain, centralized multi-agent is the recommended pattern for error containment, and the executor/researcher permission split is non-negotiable. The surface is a typed **22-tool** core plus two meta-dispatchers (`compute_indicator`, `compute_microstructure`) exposing ~60 quant ops — explicit-over-meta on the safety-critical surface, and **no arbitrary-code-execution tool by design** (a code tool dissolves the per-action money-gate).

### 2.3 Execution bridge — MT5 with a deny-first trading guard

MT5 is the competition's only programmatic path (no Syphonix REST API). Gordon's bridge — **built**:

- **Python sidecar** `scripts/mt5-bridge/mt5_bridge.py` — wraps the `MetaTrader5` package behind a localhost-only JSON API (`/health /account /positions /orders /symbols /quote /depth(L2) /bars /order /cancel /close`). Binds to `127.0.0.1` only; a **deny-first trading guard** makes `/order /cancel /close` validate via `order_check` and refuse to fire unless `MT5_BRIDGE_ALLOW_TRADING=1`. MT5 login/password/server live in the sidecar env, never in Gordon.
- **Typed client** `src/infra/broker/mt5/bridgeClient.ts` (`Mt5BridgeClient`, 8 tests).
- **BrokerAdapter** `src/infra/broker/adapters/mt5.ts` (`Mt5Adapter`, brokerId `mt5`) — maps onto the normalized broker contract; registered in the factory + inclusion gate (approved), 7 adapter tests.
- **Double safety guard (defense-in-depth):** orders fire only when **both** `MT5_BRIDGE_ALLOW_TRADING=1` (sidecar) **and** `GORDON_LIVE_TRADING=1` (runner) are set, in two separate processes. Either unset ⇒ the stack reads / validates / sizes but never submits. The resting state is *off*.

### 2.4 Four-layer mapping

| Layer | Responsibility | Where it lives |
|---|---|---|
| **Perception** | market data, L2 microstructure, news, funding | `src/infra/data/`, `scripts/dev/parquet_l2_features.py`, `src/infra/news/` |
| **Reasoning** | Claude-native planning, extended thinking, critique | `src/infra/agents/cognition/` (`thinkingPhase`, `extendedThinking`, `critiquePhase`) |
| **Strategy** | signals, regime, sizing, the dry-run | `src/core/alpha/`, `src/core/regime/`, `src/core/risk-management/`, `src/backtest/` |
| **Execution & control** | risk gate, permission engine, MT5 bridge, audit | `src/infra/trading/risk/`, `src/runtime/permissions/`, `src/infra/broker/mt5/` |

---

## 3. AI Integration (judging axis 2 — how effectively AI drives signal-gen / risk / execution)

### 3.1 Claude-native, end-to-end → Anthropic bounty

The orchestrator + executor + researcher all run on Claude (Anthropic) as the default reasoning model. AI is in the loop for **planning** (decision-object generation), **risk-management** (the classifier's qualitative dimensions and the rationale capture), and **execution** (plan synthesis and approval framing) — exactly the three surfaces the Anthropic bounty rewards. Provider plumbing: `src/infra/ai/llm/providerCaching.ts` (Anthropic prompt-cache breakpoints) + cross-sub-agent prefix reuse (`src/infra/agents/context/sharedPrefixCache.ts`).

### 3.2 Reasoning quality primitives

- **Extended thinking by workflow phase** — `src/infra/agents/cognition/extendedThinking.ts` (native `budget_tokens`).
- **Tool-free pre-action reasoning** — `cognition/thinkingPhase.ts` (separate LLM pass before acting).
- **Critique/refine at HIGH thinking depth** — `cognition/critiquePhase.ts`.

### 3.3 Eval harness — verification as a first-class discipline

`src/infra/domain/evals/harness/` — the writer is never the grader:

- **RULER-pattern LLM-as-judge** over **generated** scenarios (derived from the constitution / risk dimensions / deny-list, provenance-stamped, auto-updating).
- **Tri-judge cross-family panel** (Anthropic + OpenAI + Google) to wash out single-family self-preference.
- **Deterministic process checks** over the signed audit trace (`risk_gate_before_order`, `denylist_without_approval`) — assertions, not vibes.
- **pass^k reliability** — safety scenarios must pass on *every* run, not on average.
- **Production-trace → regression loop** (`promoteTraceToScenario`) + a **CI gate** (`scripts/dev/eval-gate.ts`).

### 3.4 Observability → Pydantic Logfire (OTel-native, drop-in)

`src/infra/platform/observability/tracing.ts` exports `resolveExporterTarget()`: when `LOGFIRE_TOKEN` is set it routes the existing OTel exporter to Logfire (`https://logfire-{us,eu}.pydantic.dev`, region via `LOGFIRE_BASE_URL`), otherwise defaults to Axiom. Because tracing is OTel-native, Logfire is a **drop-in target** — agent/tool spans, no instrumentation rewrite. Verified by `logfireTarget.test.ts`.

### 3.5 Inference → Doubleword (batch tier) + Nemotron → NVIDIA bounty

- **Doubleword** is OpenAI-compatible. The **eval-harness judge** runs on Doubleword's **OpenAI Batch tier** (~90% cheaper, 24h window) via `src/infra/domain/evals/harness/doublewordBatchJudge.ts` — one batch per scenario-suite × variants run, mapped back by `custom_id`, scored with the *same* `buildJudgePrompt` as the realtime path.
- **NVIDIA Nemotron via Doubleword** — `src/core/pipeline/llmFailover.ts` pins `nvidia/NVIDIA-Nemotron-3-Ultra-550B-A55B-NVFP4` as the Doubleword failover/eval model (also surfaced in `ModelPicker.tsx` + `infra/runtime/providers/registry.ts`). Running Nemotron through Doubleword's gateway is Gordon's NVIDIA-bounty usage: NVIDIA compute drives the bulk eval-judging leg.

---

## 4. Execution Approach (judging axis 3 — strategy clarity, risk-adjusted returns)

### 4.1 We encoded the EXACT published objective and optimized against it

`src/core/risk-management/competition-scoring.ts` transcribes the official §11–17 scoring model verbatim:

```
Final Score = 0.70·ReturnRank + 0.15·DrawdownRank + 0.10·SharpeRank + 0.05·RiskDiscipline
```

…including the non-annualized 15-minute Sharpe, the **<8-observation Sharpe cap at 50**, the §13 risk-discipline penalties, the §14 red-line DQ, the §16 tie-breakers, and the §17 Best Sharpe Award eligibility (`selectBestSharpeAward`). 16 tests. We optimize against the *true* objective, not a proxy.

### 4.2 A cost-honest, platform-accurate dry-run

`src/backtest/competition-dry-run.ts` is the keystone rehearsal — the full money-path (signal → `sizeCompetitionTrade` → fills → stop/target → daily-loss-kill + exposure-cap → equity curve → judged metrics), pure and deterministic. It models the competition's *exact* friction as confirmed by the organisers at the kickoff: **NO commission, NO swap** — the only execution cost is the **bid-ask spread you cross** (+ slippage).

Crucially, Cypher exposes **only FOK / IOC order types** — both immediate-or-cancel and marketable. There are **no resting limit orders**, so there is no passive/maker fill and no rebate to earn: every fill is a **taker** that crosses the spread. We model exactly that, and reject the tempting-but-impossible "rest a limit and earn the half-spread" trick that the platform simply does not allow. Honest cost model in, honest verdict out.

### 4.3 The honest empirical finding — *no signal showed a stable edge after costs*

We tested every transparent, parameter-light signal family we could against the **real Model to Market bars** through the cost-honest dry-run under **taker execution** (the only Cypher-executable mode), IS 70% / OOS 30%, after costs — and, going further, swept the full signal library × param grid × instrument through a **walk-forward harness ranked with deflated-Sharpe / PSR multiple-testing correction** (`scripts/research/alpha-search.ts`). The families and their validators:

| Signal family | Validator | OOS-after-costs verdict |
|---|---|---|
| Naive trend / TA | `scripts/dev/momq-edge-validate.ts` | no stable edge — IS edges did not survive OOS |
| Momentum (directional) | `momq-edge-validate.ts` | sign unstable IS↔OOS |
| Reversal — time-series (per-symbol z-band) | `momq-reversal-validate.ts` | failed OOS across lookbacks {7,14,21} |
| Reversal — cross-sectional (rank, long losers/short winners) | `momq-cross-sectional-validate.ts` | IC did not hold OOS |
| Q-7 factor composite (reversal + residual-vol; + funding on crypto) | `momq-factor-validate.ts`, `momq-crypto-q7-validate.ts` | IC not OOS-stable |
| L2 order-book imbalance | `momq-imbalance-validate.ts` | no edge — *and on FX majors the provided historical depth is **static** (imbalance ≡ 0, ≤18 distinct values/month), so it is un-backtestable there by construction; depth **does** vary on metals (XAU/XAG), the one place the signal is real* |
| Microstructure order-flow pressure | `momq-microstructure-validate.ts` | no edge after costs (same FX static-depth caveat) |
| Full library × params × instruments (systematic sweep) | `scripts/research/alpha-search.ts` | **0 of 620 cells** cleared the deflated-Sharpe bar (M15); repeated on **3yr extended crypto** (1h, 1d) — same verdict |

> **The honest result:** across naive TA, momentum, time-series **and** cross-sectional reversal, the Q-7 factors, order-book imbalance, and microstructure order-flow, **no signal showed a stable directional edge after costs** — the signs flipped between in-sample and out-of-sample. We are **not** claiming "my bot found alpha." We *measured*, against the competition's exact objective, that the cheap directional edges are not there in this window.

Candidate primitives we wired (e.g. `src/core/alpha/reversal-strategy.ts`, `cross-sectional-contrarian.ts`, `crypto-factor-model.ts`) are kept as honest, runnable *candidates* — the validators above are the receipts that they did **not** clear the OOS-after-costs bar. One month + a single IS/OOS split is indicative, not conclusive (the validators say so in their own headers), and it is the pre-competition window, not the live week.

### 4.4 What we built *because* the signals didn't survive

Two things consistently *did* hold up — and with the rigor of the search itself, they are the technology story:

1. **Survival / no-blow-up sizing.** `sizeCompetitionTrade`'s min-of-caps composition (§2.1) means a losing streak cannot cause ruin. Forced liquidation = instant elimination (§14); a book that *cannot* wipe out has a ranking edge by construction in an attrition tournament. With **no commission** and **30:1 leverage** available to ~500 entrants, the 70%-weight return rank is a *variance contest* — the controllable edges are survival, drawdown, and Sharpe rank, not return-alpha we proved isn't there.
2. **A regime-adaptive default.** `COMPETITION_RISK_AGGRESSIVE` (`competition-risk-preset.ts`) is **diversified aggressive compounding** — many small, vol-targeted, diversified positions across the 30+ instruments rather than a few concentrated bets. This competes on return (70%) while keeping the 15-min Sharpe high and controlling drawdown. All ceilings stay under the §13 discipline thresholds (leverage < 28×, margin < 90%, single-instrument < 90%, net-directional < 95%) and the many-small-trades book naturally clears the §17 ≥30-trade floor.

And the **rigor of the search is itself the edge**: a walk-forward, deflated-Sharpe, multiple-testing-corrected harness that refuses to launder noise into a "winner" — plus the one genuine data advantage, since the organisers provide **no crypto backtest data**, so our self-scraped **3-year multi-regime Binance history** (18 symbols × M15/1h/1d) is coverage most entrants won't have.

**The thesis:** in a no-commission, luck-dominated return tournament, the defensible edges are **disciplined survival + a regime-adaptive book + the governance/measurement architecture** — and that **honesty and rigor IS the technology story**, which is exactly what the Best Technology axis rewards.

---

## 5. Data usage (§9 deliverable)

| Source | What | How ingested |
|---|---|---|
| **Syphonix tick + L2 parquet** (provided, ~21 GB, FX/metals) | tick-level, ≥5-level order-book depth, 1 month pre-launch | `scripts/dev/parquet_resample.py` → M15 bars; `scripts/dev/parquet_l2_features.py` → L2 microstructure (book imbalance, microprice-vs-mid, spread, tick count) per 15-min bucket. Memory-safe, one daily file at a time. |
| **Native crypto price history** (Binance) | the 5 competition crypto (parquet has no crypto) | `scripts/dev/fetch-crypto-history.ts` → `data/momq/bars/<SYM>_M15.json` |
| **Funding** (Binance perpetual `fapi`) | 8-hourly funding rates (real Q-7 funding factor) | `scripts/dev/fetch-crypto-funding.ts` (read-only public, no auth) |
| **CoinGecko** (free public tier) | daily market-cap + volume for the 5 crypto | `scripts/dev/fetch-crypto-marketdata.ts` (read-only, no key) |

All external feeds are read-only public data, explicitly permitted by the organizers (§4: "external data is explicitly allowed"). Honestly scoped: **one month + a single IS/OOS split is indicative, not conclusive**, and it is the pre-competition window, not the live week — the validation scripts say so in their own headers.

---

## 6. Partner technology table (§9 deliverable)

| Partner | What it provides | How Gordon uses it | Path |
|---|---|---|---|
| **Anthropic (Claude)** | reasoning model for all 3 agents | planning / risk-rationale / execution-framing; prompt-cache breakpoints | `src/infra/agents/definitions/`, `src/infra/ai/llm/providerCaching.ts` |
| **Pydantic Logfire** | OTel-native observability backend | drop-in OTel exporter target for agent/tool spans (`LOGFIRE_TOKEN` switch) | `src/infra/platform/observability/tracing.ts` |
| **Doubleword** | OpenAI-compatible inference + Batch tier | bulk eval-harness judging on the cheap 24h batch tier | `src/infra/domain/evals/harness/doublewordBatchJudge.ts` |
| **NVIDIA Nemotron** | Nemotron-3-Ultra via Doubleword gateway | failover + eval-judge model; NVIDIA compute drives the eval-judging leg | `src/core/pipeline/llmFailover.ts`, `src/infra/runtime/providers/registry.ts` |
| **Northflank** | Linux container platform ($100 credit) | hosts Gordon's non-MT5 services (data fetch, dashboards); the MT5 terminal + sidecar + live runner stay on a Windows VPS (the `MetaTrader5` package is Windows-only) | deployment target; MT5 co-locates locally per §8.1 of the brief |

---

## 7. Demo plan (§9 deliverable)

The demo runs entirely **dry / validate-only** — no real orders. The two trading guards (`MT5_BRIDGE_ALLOW_TRADING`, `GORDON_LIVE_TRADING`) stay **unset** throughout, so the bridge `order_check`s and the runner reads/sizes but never submits.

### Demo script — exact commands, in order

```bash
# 1. Start the MT5 bridge sidecar (terminal A) — validate-only (guard unset).
#    Binds 127.0.0.1 only; /order /cancel /close will order_check, not fire.
pip install -r scripts/mt5-bridge/requirements.txt        # first time only
python scripts/mt5-bridge/mt5_bridge.py

# 2. Smoke-test the Gordon↔MT5 transport (terminal B).
#    Reads account + quote + L2 depth + bars + symbol spec; health.tradingEnabled
#    reflects the (unset) sidecar guard, proving the validate-only posture.
bun run scripts/dev/mt5-smoke.ts

# 3. The honest empirical finding — run the cost-honest, IS/OOS validators.
#    Each prints per-instrument return / 15-min Sharpe (taker, after costs).
bun run scripts/dev/momq-edge-validate.ts            # naive TA / momentum
bun run scripts/dev/momq-reversal-validate.ts        # time-series reversal
bun run scripts/dev/momq-cross-sectional-validate.ts # cross-sectional reversal
bun run scripts/dev/momq-factor-validate.ts          # Q-7 factor IC
bun run scripts/dev/momq-imbalance-validate.ts       # L2 order-book imbalance
bun run scripts/dev/momq-microstructure-validate.ts  # order-flow pressure
#    → the takeaway beat: no signal survives OOS after costs (taker — the only Cypher mode);
#      0/620 cells clear the deflated-Sharpe bar in the systematic sweep.

# 4. The live-trader REHEARSAL — drive the REAL CompetitionLiveTrader loop
#    end-to-end over replayed M15 bars (ReplayMt5 stands in for the sidecar).
#    Exercises sizing → lot-rounding → order-shape → daily-loss-kill on the live path.
bun run scripts/competition/rehearsal.ts

# 5. The live runner in DRY mode — GORDON_LIVE_TRADING UNSET.
#    Connects to the real bridge, sizes every cycle through COMPETITION_RISK_AGGRESSIVE,
#    logs intended (dry) orders, submits nothing. This is the exact go-live process,
#    minus the two guards.
bun run scripts/competition/live-runner.ts
```

### Three narrative beats for a live walkthrough

1. **The money-gate:** submit an oversized / over-leveraged order → the 15-dim risk classifier **blocks** it before it reaches the venue, and the sidecar `order_check`s rather than fires.
2. **The dry-run truth:** step 3 above — show every signal family failing OOS after costs, and the **systematic walk-forward sweep returning 0/620 past the deflated-Sharpe bar**, all scored on the *exact* competition metric under taker execution.
3. **The audit + observability:** show the signed audit log capturing rationale, and the same run's spans landing in Logfire (`LOGFIRE_TOKEN` set).

---

## 8. Reproducibility (§9 deliverable)

**GitHub repo:** `[TBD — submission repo link]`

### Repo layout (the bits a judge will open)

| Path | What |
|---|---|
| `scripts/mt5-bridge/` | MT5 Python sidecar (`mt5_bridge.py`, `requirements.txt`, `README.md`) |
| `src/infra/broker/mt5/` | typed bridge client + adapter |
| `src/core/risk-management/competition-scoring.ts` | exact §11–17 objective function (16 tests) |
| `src/core/risk-management/competition-risk-preset.ts` | survive-and-compound + `COMPETITION_RISK_AGGRESSIVE` sizer |
| `src/backtest/competition-dry-run.ts` | cost-honest taker money-path simulator (FOK/IOC, no commission) |
| `src/core/alpha/` | candidate signal primitives (reversal, cross-sectional, factor model) |
| `scripts/dev/momq-*.ts` | the IS/OOS, after-costs signal validators (the receipts) |
| `scripts/competition/` | `rehearsal.ts` (replay live-trader) + `live-runner.ts` (real bridge) |
| `src/infra/trading/risk/riskClassifier.ts`, `src/runtime/permissions/` | the governance plane |
| `src/infra/domain/evals/harness/` | the eval harness (RULER judge, panel, process checks, CI gate) |
| `docs/model-to-market/` | this deck, the competition brief, the live-week operations runbook |

### How to run

```bash
bun install                                    # deps (Bun runtime)
# Validation path (no venue, deterministic):
bun run scripts/dev/momq-edge-validate.ts      # + the other momq-*-validate.ts
bun run scripts/competition/rehearsal.ts       # live-trader loop over replayed bars
# Tests:
bun test src/core/risk-management/competition-scoring.test.ts \
         src/backtest/competition-dry-run.test.ts \
         scripts/competition/rehearsal.test.ts
# Live path: see docs/model-to-market/OPERATIONS.md (Windows + MT5 terminal + both guards).
```

The full 24/7 live-week runbook (topology, the double guard, start sequence, kill switch, pre-launch checklist) is `docs/model-to-market/OPERATIONS.md`; the single competition reference (schedule, scoring, rules) is `docs/model-to-market/COMPETITION_BRIEF.md`.

---

## 9. What we learned (honest)

- **We encoded the EXACT published objective function** (`competition-scoring.ts`, §11–17, 16 tests) and validated every candidate **against it**, not a proxy.
- **Across naive TA, momentum, reversal (time-series AND cross-sectional), the Q-7 factors, order-book imbalance, and microstructure order-flow, NO signal showed a stable edge after costs** — the signs flipped between in-sample and out-of-sample. (One month + one IS/OOS split is indicative, not conclusive — but it is enough to refuse to deploy a signal we can't measure.)
- So we built toward what *is* consistent and measurable:
  - **Survival / no-blow-up sizing** — min-of-caps so a losing streak can't cause ruin; forced liquidation is instant elimination, so not-wiping-out is itself a ranking edge in a no-commission, high-leverage variance contest.
  - **Search rigor as the edge** — a walk-forward, deflated-Sharpe, multiple-testing-corrected harness that returns *0/620* rather than launder noise; plus self-scraped 3-year multi-regime crypto history (the organisers provide none).
  - **A regime-adaptive default** — diversified aggressive compounding: many small, vol-targeted, diversified positions, all under the §13 discipline thresholds.
- **The conclusion:** in a likely luck-dominated return tournament, the defensible edges are **disciplined execution + survival + the governance architecture** — and the honesty/rigor of *measuring that* is the technology story.

---

## 10. Live results (fill post-competition)

- Final Sharpe (15-min, non-annualized): `[TBD post-comp]`
- Final return off the $1M baseline: `[TBD post-comp]`
- Max drawdown: `[TBD post-comp]`
- Overall rank / Top-50 status / red-line clean: `[TBD post-comp]`
- Trade count (§17 ≥30 floor): `[TBD post-comp]`
