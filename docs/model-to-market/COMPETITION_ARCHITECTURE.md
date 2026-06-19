# Gordon — Architecture (Model to Market, AI Engine Quantitative Hack)

*The Top-25 deliverable: judged on system design, AI integration, and execution approach. Also the artifact that travels to Anthropic / Optiver / Syphonix afterward.*

## One line

**Gordon is a governed multi-agent trading harness — an autonomous agent that structurally cannot trade wrong.** Most entrants bring a strategy script wired to an API. Gordon brings the *system around* the strategy: a capital-safety plane, an eval harness, and a self-correcting autonomy loop. The strategy is the easy 20%; the harness is the 80% that decides whether an AI agent can be trusted with real money.

## Why this shape wins a *Sharpe-judged, blind-phase* contest

The format rewards exactly what Gordon is built for: **survive-and-compound, robust over variance.** A two-week leveraged window with a blind final phase punishes leaderboard-gaming and rewards consistency. Gordon's defining property — risk gates that *cannot be overridden by the strategy* — is the asset, not the constraint.

## The five layers

### 1. Centralized multi-agent topology
`gordon` (orchestrator/router) → `executor` (has execution permissions) + `researcher` (does not) + bounded `delegate_subagent`. The split is a **security boundary**, not an efficiency choice: only the executor can touch capital, and every handoff is tracked. Tool surface is a deliberate **22-tool typed surface** (data / analytics / plan-exec / memory / workflow) plus two meta-dispatchers (`compute_indicator`, `compute_microstructure`) exposing ~60 quant ops — *explicit-over-meta on the safety-critical surface*. No code-execution tool by design: an LLM writing arbitrary code dissolves the per-action money-gate.

### 2. Capital-safety plane (the moat)
- **15-dimension pre-trade risk classifier** (8 base + 7 optional) → `auto_approve | prompt_user | require_confirmation | block` (vol-adjusted sizing, tail risk, correlation, venue MEV, …).
- **Deny-first permission engine** with a hard deny-list (`place_order`, `execute_trade`, `cancel_*`, `wallet_transfer`) that bypasses trust scoring.
- **Trading constitution** + **signed audit log** on every state-changing action (rationale required on `create/approve/execute_plan` and all `cancel_*`).
- **Idempotent execution** — `clientOrderId` on every slice (TWAP/VWAP/POV/iceberg), so a retried order never double-fills.
- **Kill-switch, drawdown guard, max-exposure timeout, wipeout-cap sizer.**

### 3. Eval harness (verification as a first-class discipline)
RULER-pattern LLM-as-judge over **generated** scenarios (derived from the constitution / risk dimensions / deny-list — provenance-stamped, auto-updating), a **tri-judge cross-family panel** (anti self-preference bias), **deterministic process checks** over the audit trace (`risk_gate_before_order`, `denylist_without_approval`), **pass^k** reliability (safety scenarios must pass on *every* run), a production-trace→regression loop (`promoteTraceToScenario`), and a CI gate. The writer is never the grader.

### 4. Autonomy loop (long-horizon, self-correcting)
`/goal` + autonomous loop with: token/cost budget governor (halts on daily-budget / max-iterations / token-budget), **doom-loop + A-B-A-B cycle detection**, **goal-progress stall detection** (halts when progress plateaus despite varied actions), **failure-class recovery escalation** (retry → narrow fix → handoff with full context), `report_blocked` self-signaling, and 5-stage context compaction. Memory is hot-tier-disciplined (durable trader profile only) + cold recall + a signed trade journal that compounds across sessions (ACE lessons).

### 5. Provider & robustness layer
Multi-provider routing with same-provider retry (exponential backoff), a **cross-provider failover chain** with degraded-mode signaling, a **structured-output repair loop** (schema-fail → re-ask → bounded → fallback), prompt-injection boundary on tool output, and prompt-cache reuse across sub-agents.

## Competition execution approach

- **Instruments:** FX, Gold/Silver, Crypto — symbols resolved from the Syphonix catalog at runtime (never hardcoded; FX/metals are structural).
- **Sizing:** the native barbell runner sizes the RV core through low per-pair fractions, inverse-vol/ring-fence controls, live spread gates, depth clamping, and a whole-book margin breaker. The older min-of-caps competition preset remains a tested reference/fallback object, not the selected live sizing path.
- **Signals:** the existing quant stack (regime detection, momentum incl. TSI, mean-reversion/cointegration, microstructure, A-S market-making) — systematic, not latency-arbitrage (this is **not** HFT; an LLM in the loop runs at human-to-second cadence, and MT5/chat are first-class trade methods).
- **Live entry point:** primary is `momq-python/run.py` over the native `MetaTrader5` Python client — RV-reversion core + ring-fenced sleeve + survival breaker + standing monitor + kill-switch. The TypeScript `scripts/competition/live-runner.ts` path remains the tested oracle/fallback; `core/pipeline/competition-runner.ts` is legacy prep scaffolding.

## What to demo

1. Place an oversized/leveraged order → the risk classifier **blocks** it before it reaches the venue (the money-gate the strategy can't override).
2. Run `/goal` on a trading objective → show the autonomy loop self-correcting, the stall guard halting a plateau, the audit log capturing intent.
3. Show the eval harness gating a regression — verification the agent can't talk its way past.

The point isn't "my bot made X%." The point is **an AI agent you can hand real capital to** — which is the layer every other entrant, and most of the public agent-harness landscape, is missing.
