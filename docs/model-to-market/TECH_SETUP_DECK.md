# Gordon — Best Technology Setup Submission

**Model to Market: The Quantitative Hack — §9 Top-25 technical submission.**
Targets the **Best Technology Setup** prize ($10k) and the **Anthropic** + **NVIDIA** partner bounties.

> This is the §9 form, structured to the competition's three published judging axes — **System Design · AI Integration · Execution Approach** — plus the §9 deliverables: the GitHub repo, the partner-technology overview, the data-usage details, and the demo. Numbers that can only be known after the live week (final Sharpe, rank) are marked **`[TBD post-comp]`**.

---

## 1. One-liner + thesis

**Gordon is a governed, AI-native trading OS that implements *bounded autonomy*: the agent reasons and proposes, a structural risk plane decides, and only human-approved decision objects reach the venue.**

Most entrants ship a strategy script wired to an API. Gordon ships the *system around* the strategy — a capital-safety plane, an eval harness, and a self-correcting autonomy loop — and then a strategy that was selected *honestly*, against the competition's exact objective function, after costs.

The design thesis is not ours alone. **Hui Gong, "Bounded Autonomy" (UCL, arXiv 2603.13942)** argues that the value of an AI agent **is not proportional to its autonomy** — the win comes from *structuring the reasoning a human acts on*, not from removing the human. That is precisely Gordon's `create_plan → verify_plan → approve_plan → execute_plan` spine: the LLM produces a typed **decision object**, the risk plane gates it, and execution is human-approved and idempotent. Autonomy is bounded *by construction*, not by policy that a clever prompt can talk past.

Why this shape fits *this* contest: it is a relative tournament with attrition, a leveraged two-week window, and a **blind** final phase. The format rewards **survive-and-compound over variance**. Gordon's defining property — risk gates the strategy *cannot override* — is the asset, not the constraint. Forced liquidation is instant elimination (§14); a system that *cannot* wipe out has a structural ranking edge before the strategy contributes a single basis point.

---

## 2. System Design (judging axis 1 — architecture quality, scalability, robustness)

### 2.1 The governance plane (the moat)

Every state-changing action passes a deny-first gate that the strategy layer cannot bypass:

- **15-dimension pre-trade risk classifier** — `src/infra/trading/risk/riskClassifier.ts`. 8 base + 7 optional hedge-fund-grade dimensions (vol-adjusted sizing, tail risk, correlation, venue/MEV, …) → one of `auto_approve | prompt_user | require_confirmation | block`.
- **Deny-first permission engine** — `src/runtime/permissions/PermissionEngine.ts` + `trustTrajectory.ts`. A hard deny-list (`place_order`, `execute_trade`, `cancel_*`, `wallet_transfer`) **bypasses trust scoring** — adaptive auto-approval can never reach the money-critical surface.
- **Trading constitution + signed audit log** on every write; `create/approve/execute_plan` and all `cancel_*` tools take a required `rationale` (min 10 chars), logged via `recordStructuredObservation` — the audit captures *intent*, not just the call.
- **Survive-and-compound sizer** — `src/core/risk-management/competition-risk-preset.ts` (`sizeCompetitionTrade`). A **min-of-caps** composition of per-trade-risk / vol-target / leverage / fractional-Kelly / exposure-cap / daily-loss-kill: the most conservative constraint always binds, so a losing streak can't cause ruin while vol-targeting keeps Sharpe central. Every sizing decision returns the `bindingConstraint` for audit.

### 2.2 Deliberately centralized multi-agent topology

`gordon` (orchestrator/router) → `executor` (has execution permissions) + `researcher` (does **not**) + a bounded `delegate_subagent` — `src/infra/agents/definitions/`.

The split is a **security boundary**, not an efficiency choice: only the executor can touch capital, every handoff is tracked, and the agents carry *different* tool subsets scoped by permission boundary. (We deliberately did **not** collapse to a single agent — for a regulated, strict-verification money domain, centralized multi-agent is the recommended pattern for error containment, and the executor/researcher permission split is non-negotiable.) The surface is a typed **22-tool** core plus two meta-dispatchers (`compute_indicator`, `compute_microstructure`) exposing ~60 quant ops — explicit-over-meta on the safety-critical surface, and **no arbitrary-code-execution tool by design** (a code tool dissolves the per-action money-gate).

### 2.3 Execution bridge — MT5 with a deny-first trading guard

MT5 is the competition's only programmatic path (no Syphonix REST API). Gordon's bridge — **built**:

- **Python sidecar** `scripts/mt5-bridge/mt5_bridge.py` — wraps the `MetaTrader5` package behind a localhost-only JSON API (`/health /account /positions /orders /symbols /quote /depth(L2) /bars /order /cancel /close`). Binds to `127.0.0.1` only; **deny-first trading guard** — `/order /cancel /close` validate via `order_check` and refuse to fire unless `MT5_BRIDGE_ALLOW_TRADING=1`. MT5 login/password/server live in the sidecar env, never in Gordon.
- **Typed client** `src/infra/broker/mt5/bridgeClient.ts` (`Mt5BridgeClient`, 8 tests).
- **BrokerAdapter** `src/infra/broker/adapters/mt5.ts` (`Mt5Adapter`, brokerId `mt5`) — maps onto the normalized broker contract; registered in the factory + inclusion gate (approved), 7 adapter tests.

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

`src/infra/platform/observability/tracing.ts` exports `resolveExporterTarget()`: when `LOGFIRE_TOKEN` is set it routes the existing OTel exporter to `https://logfire-{us,eu}.pydantic.dev/v1/traces` (region via `LOGFIRE_BASE_URL`), otherwise defaults to Axiom. Because tracing is OTel-native, Logfire is a **drop-in target** — agent/tool spans, no instrumentation rewrite. Verified by `logfireTarget.test.ts`.

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

### 4.2 A cost-honest dry-run with taker AND maker execution

`src/backtest/competition-dry-run.ts` is the keystone rehearsal — the full money-path (signal → `sizeCompetitionTrade` → fills → stop/target → daily-loss-kill + exposure-cap → equity curve → judged metrics), pure and deterministic. It models the competition's *exact* friction: **NO commission, NO swap — only spread + slippage + market impact** (§5). It supports both:

- **taker** — crosses the spread, pays half-spread + slippage on every fill;
- **maker** — rests a limit, **earns** the half-spread rebate (net cost can go negative) but is not guaranteed to fill; tracks `makerFillRate` and an expiry budget.

### 4.3 The honest empirical finding (including the negative one)

We ran transparent, parameter-light candidates through the dry-run on the real Model to Market bars (`scripts/dev/momq-edge-validate.ts`, IS 70% / OOS 30%, after costs). The honest result:

> **Naive trend/TA does not survive costs out-of-sample.** Most directional TA candidates that looked fine in-sample lost their edge once the spread+slippage layer was applied OOS.

The one signal that *did* persist OOS was **short-term reversal** (crypto cross-sectional IC ≈ **+0.16**), consistent with the choppy, mean-reverting regime in the provided month. That finding is consolidated into a real, tunable primitive — `src/core/alpha/reversal-strategy.ts` (negated short-horizon z-score, vol-scaled stops/targets). The cost analysis is *why* we lean on **maker execution** (turn the spread from a cost into a rebate) plus **reversal** rather than chasing naive momentum. We are not claiming "my bot made X%"; we are claiming we *measured* what has edge after costs and built toward it.

### 4.4 Survive-and-compound risk posture

`COMPETITION_RISK_AGGRESSIVE` (`competition-risk-preset.ts`) is **diversified aggressive compounding**: many small, vol-targeted, diversified positions across the 30+ instruments rather than a few concentrated bets. This competes on return (70%) while keeping the 15-min Sharpe high, controlling drawdown, and **never concentrating enough to risk forced liquidation** (= no auto-elimination). All ceilings stay under the §13 discipline thresholds (leverage < 28×, margin < 90%, single-instrument < 90%, net-directional < 95%) and the many-small-trades book naturally clears the §17 ≥30-trade floor. **No forced liquidation = no auto-elimination — survival is a ranking edge by construction.**

---

## 5. Data usage (§9 deliverable)

| Source | What | How ingested |
|---|---|---|
| **Syphonix tick + L2 parquet** (provided, ~21 GB, FX/metals) | tick-level, ≥5-level order-book depth, 1 month pre-launch | `scripts/dev/parquet_resample.py` → M15 bars; `scripts/dev/parquet_l2_features.py` → L2 microstructure (book imbalance, microprice-vs-mid, spread, tick count) per 15-min bucket. Memory-safe, one daily file at a time. |
| **Native crypto price history** (Binance) | the 5 competition crypto (parquet has no crypto) | `scripts/dev/fetch-crypto-history.ts` → `data/momq/bars/<SYM>_M15.json` |
| **Funding** (Binance perpetual `fapi`) | 8-hourly funding rates | `scripts/dev/fetch-crypto-funding.ts` (read-only public, no auth) |
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
| **Northflank** | Linux container platform ($100 credit) | hosts Gordon's non-MT5 services (data fetch, dashboards); MT5 terminal stays on a Windows VPS | (deployment target; MT5 co-locates locally per §7.1) |

---

## 7. Demo plan + reproducibility (§9 deliverable)

**GitHub repo:** `[TBD — submission repo link]`

### Run the execution path (live trading)
1. Install the MT5 terminal + log in to the Syphonix account.
2. `pip install -r scripts/mt5-bridge/requirements.txt`
3. Set `MT5_LOGIN/MT5_PASSWORD/MT5_SERVER`, `MT5_BRIDGE_TOKEN`, `MT5_BRIDGE_ALLOW_TRADING=1`.
4. `python scripts/mt5-bridge/mt5_bridge.py` (localhost-only, deny-first guard).
5. `bun run scripts/dev/mt5-smoke.ts` — verify account / quote / L2 / place+cancel against the real account.

### Run the validation path (no venue, deterministic)
- **Strategy edge, cost-honest, IS/OOS:** `bun run scripts/dev/momq-edge-validate.ts`
- **Reversal validation:** `bun run scripts/dev/momq-reversal-validate.ts`
- **Risk-posture sweep:** `bun run scripts/dev/momq-risk-sweep.ts`
- **Data prep:** `parquet_resample.py` + `parquet_l2_features.py` (Syphonix parquet) · `fetch-crypto-history.ts` / `-funding.ts` / `-marketdata.ts` (crypto).
- **Scoring + dry-run tests:** `bun test src/core/risk-management/competition-scoring.test.ts src/backtest/competition-dry-run.test.ts`

### Live demo script (3 beats)
1. **The money-gate:** submit an oversized/over-leveraged order → the 15-dim risk classifier **blocks** it before it reaches the venue.
2. **The dry-run truth:** run `momq-edge-validate.ts` → show naive TA failing OOS after costs and reversal+maker persisting, scored on the *exact* competition metric.
3. **The audit + observability:** show the signed audit log capturing rationale, and the same run's spans landing in Logfire.

### Live results (fill post-competition)
- Final Sharpe (15-min, non-annualized): `[TBD post-comp]`
- Final return off the $1M baseline: `[TBD post-comp]`
- Max drawdown: `[TBD post-comp]`
- Overall rank / Top-50 status / red-line clean: `[TBD post-comp]`
- Trade count (§17 ≥30 floor): `[TBD post-comp]`
