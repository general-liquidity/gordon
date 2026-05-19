# Gordon Harness Assessment

**Status as of:** end of the Wright port (commit `bbcb5723` and predecessors).
**Audience:** anyone deciding what to build next, or pitching what Gordon is.
**Bias:** honest. This document deliberately does not sell what isn't there.

---

## Executive summary

Gordon is at roughly **70–80% of what "great agentic harness for trading" means in practice**.

The trading-discipline *primitive library* is near-complete and unusually deep. The full execution stack — enforcement, executor instrumentation, portfolio state, integration tests, real data — is the remaining 20–30%.

A useful frame: Gordon today is an excellent **operator-shadow** (runs alongside a human, logs verdicts, builds calibration data). It is not yet a fully autonomous trading harness. The path between those two is well-defined and not blocked by missing knowledge — it is blocked by missing wiring, missing instrumentation, and missing data.

This document inventories what's built, what's shadow, what's cold, what's missing entirely, and what it would take to close each gap.

---

## 1. What Gordon is today

### 1.1 Primitive library

Gordon has approximately **60 trading-domain primitives** drawn from the major trading-literature traditions plus the AI-agent-harness literature:

**Trading-discipline primitives (25 from the Wright port alone, plus earlier work):**
- Position sizing (path-dependent tier system, fractional Kelly, volatility drag, backtest tax)
- Risk surfaces (absorbing barriers, risk-bundle audit, streak circuit breaker, give-back stop)
- Regime sensing (Hurst exponent, correlation regime, weekly regime check, Gordon's 6-value classifier)
- Counterparty intelligence (marginal participant classifier, adverse selection detector, liquidity mapper)
- Edge attribution (BAIT framework, 5-min articulation test, performance decomposition, edge decay)
- Operator psychology (daily decision journal, debrief matrix, kill list, conviction calibration, trader archetype, daily rollup)
- Performance math (operator equation, Shannon's Demon, expectancy with friction tax)

**Harness-engineering primitives (~35 from earlier batches):**
- Context management (4-stage summarizer, context-collapse projection)
- Loop control (doom-loop detection, runtime harness, recovery tiers)
- Tool orchestration (instrumented tools, output filtering, result caching, deferral)
- Permissions (deny-first engine, trust trajectory, rationale-on-cancel)
- Lifecycle hooks (PreToolUse, PostToolUse, UserPromptSubmit, SessionStart, SessionEnd, external runner)
- Memory (hot-tier discipline, write-time/query-time separation, ACE lessons, citation manifest, decision log)
- Reasoning (thinking phase, extended thinking, critique phase, adversarial evaluator, effort calibration)
- Observability (OTel tracing, audit log, structured observations, doctor surfaces)
- Eval harness (3 scenarios, tri-judge panel, categorical rubrics, regression detection)
- Safety (network allowlist, filesystem write guard, tool-design linter, claudeMd linter)

**Trading infrastructure (~25 modules):**
- Exchange connectors (Binance, Coinbase, Kraken, OKX, IBKR, Alpaca, Trading 212)
- Strategy DSL + interpreter (validated, no arbitrary code execution path)
- Backtest engine + credibility scoring (PSR/DSR, market impact, multiple-testing tracker)
- Proactive radar (news, regime flip, volatility, funding, stock events)
- Strategy generator (LLM → DSL, schema-validated)

**Tests:** 491+ across the trading-ops modules. Typecheck clean. CLAUDE.md-compliant code style (no comments, no over-abstraction, no backwards-compat shims).

### 1.2 What's actually invoked

Of the ~60 trading-domain primitives, ~40 are wired into call sites today. Of those wired, **almost all are shadow-mode** — they log verdicts to the structured-observation stream and the application logger, but their verdicts do not gate behavior.

The hard gating today is done by the older infrastructure: `riskClassifier.ts` (11-dimension scoring), the deny-list of safety-critical tools, the permission engine, and Gordon's daily-loss cap (`GORDON_RISK_DAILY_LOSS_USD`). Everything that came in via the Wright port and the harness-engineering ports is informational.

---

## 2. The shadow-vs-enforcing distinction (and why it matters)

When a module is "wired in shadow mode," it means:

- The function runs on the relevant event (e.g. `plan_ready`)
- Its verdict is computed and logged
- The downstream consumer (typically the executor or the termination check) does **not** read the verdict

When a module is "wired in enforcing mode":

- The function runs on the relevant event
- Its verdict is computed
- The downstream consumer **does** read the verdict and gates behavior on it

The difference is roughly 5–15 lines of code per module, but the policy implication is enormous. Shadow mode is risk-free observation. Enforcing mode is a hard gate on the operator's behavior.

The reason ~16 modules sit in shadow today is not laziness — it's data-discipline. Each shadow wire is meant to accumulate enough verdict-vs-outcome history that the operator can calibrate whether the gate would have helped or hurt. Promoting to enforcing before that calibration is complete is the exact failure Wright warns against in Ch 4 (overconfidence in untested models). The shadow tier is correct; the absence of accumulated data is the problem.

**Examples of the gap:**

| Module | Shadow today | Enforcing would mean |
|---|---|---|
| WW1 pathDependentSizer | Logs sized position alongside plan | Executor reads the sized result and refuses to place orders bigger than the sizer permits |
| WW2 absorbingBarrier | Logs nearest-barrier R-units | `shouldBlockNewTrades` short-circuits L1 pre-trade check |
| WW7 preExecKillList | Logs blockers | Order placement gated on `runKillList(...).pass === true` |
| WW8 convictionCalibration | Logs status + pearsonR | WW1's tier selection clamped via `clampTierToCalibration` |
| AR1 thesisCoherence | Returns null (not invoked) | Feed `gateCoherence(plan, thesis)` into `checkPreTrade.thesisCoherenceOk` |
| AR2 tradingUniverse | Returns true (hardcoded) | Feed `checkUniverse({ symbol, assetClass })` into `mandateScopeOk` |

All of these are ~10-line edits in `agent-subscriptions.ts` or `terminationLayers.ts`. None require new infrastructure. The blocker is "do we trust the verdict yet?" — and that requires paper-mode runs that haven't happened.

---

## 3. Gap inventory across 8 dimensions

### 3.1 Enforcement gap (highest leverage, lowest infrastructure cost)

**Current state:** ~16 modules log shadow verdicts; ~3 actually gate behavior (riskClassifier, daily-loss cap, deny-list).

**Closing it:** for each shadow wire, write the small piece of code that reads the verdict and short-circuits or modifies the downstream call. The mechanics are easy. The policy decision — when to flip the flag, based on what data — is the hard part.

**Sequencing the safest promotions first:**
1. **AR1 + AR2 (anti-rot)** — pipe their evaluators into `checkPreTrade`. Currently hardcoded inputs. Low risk because L1 itself is shadow-wired in the broader plan_ready pipeline; promoting these inputs only matters if/when L1 itself gets promoted.
2. **WW2 absorbingBarrier broker barrier** — promote to enforcing when current equity is within 2R of broker daily-loss cap. Easy gate. Very low false-positive rate.
3. **WW7 preExecKillList** — promote when 4+ of 5 booleans fire. Operator self-reports, so very low false-positive rate.
4. **WW8 convictionCalibration** — promote when `calibrated=true`, allow Type II/III. When `negatively_correlated`, force flat 1R hard.
5. **WW1 pathDependentSizer** — promote once executor reads the sized result. This is the central tier of the whole system.

The other ~10 shadow wires require more data before promotion makes sense.

**Estimated effort:** 1–2 days per promotion, ~2 weeks total for all 5.

### 3.2 Executor instrumentation gap (WW4 frictionTracker producers)

**Current state:** `frictionTracker.ts` ships with 9 typed event kinds (commission, exchange_fee, platform_fee, slippage, market_impact, hesitation, premature_exit, moved_stop, error). Zero of these have producers. The module is a complete sink with no source.

**Why it matters:** without realized friction capture, the entire "Operator Equation" framework (WW9, Ch 6) is theoretical. Edge measurement against realized cost is the most important diagnostic in retail trading. Wright's Ch 6 thesis ("in a negative-sum game, friction determines winners more than edge quality") is literally untestable without these producers.

**What's needed:**

| Producer | Where | Effort |
|---|---|---|
| Commission / fees | Order-confirmation callback from each exchange connector | ~1 day per exchange, ~5 days total |
| Slippage | Compute `planned_fill_price - actual_fill_price` at fill confirmation | ~3 days (needs fill-event emission across connectors) |
| Market impact | Larger fills only — composes with existing `marketImpact.ts` (Q3) which models it; producer just records when realized impact deviates | ~2 days |
| Hesitation | Measure `signal_emit_time - order_send_time` | ~2 days (needs latency capture at signal emission point) |
| Moved stop | Hook into cancel_replace_order tool calls; record old-stop vs new-stop diff | ~2 days |
| Premature exit | Detect take_profit hit before target ladder completes | ~3 days |

**Total: ~3 weeks of executor-side instrumentation.** Outside the Wright port's scope by design.

### 3.3 Portfolio-state gap

**Current state:** Gordon's data model is single-symbol, single-trade. `PositionOpenedEvent`, `PositionClosedEvent`, plan_ready events all reference one symbol. There's no aggregate "what does my book look like right now" surface.

**What this blocks:**
- **WW11 shannonsDemonRebalancer** — needs current allocations + target weights across multiple symbols
- **WW20 correlationRegimeMonitor** — needs returns matrix across the operator's open positions
- **WW19 adverseSelectionDetector** — needs fill events (different gap, related to executor instrumentation)
- **Multi-leg hedging** (Ch 10) — the "long AAPL, short SPY" example from riskBundleAuditor can't actually be constructed
- **Real correlation caps** — Wright Ch 9 explicit circuit breaker (10% max across correlated positions) — Gordon can't compute correlated exposure because it doesn't know what positions exist

**What's needed:** a `portfolioState.ts` module + a producer that polls the broker (or accumulates from PositionOpened/PositionClosed events) to maintain the current book in memory. The data is available from the exchange connectors; it just isn't aggregated centrally.

**Estimated effort:** ~1 week including event aggregation + a `/positions` slash surface.

### 3.4 Integration testing gap

**Current state:** every module has unit tests. The composition is untested.

**Examples of compositions not covered:**

1. plan_ready handler runs ~12 shadow wires in sequence. The handler doesn't fail if one throws (each is in its own try/catch), but the actual *cumulative latency* under realistic plan generation has never been measured. Each module adds 5–50ms. 12 modules × 30ms = 360ms of plan_ready overhead.

2. The composition `confluenceScorer (TM1) → pathDependentSizer (WW1) → convictionCalibrationGate (WW8) → absorbingBarrier (WW2) → preExecKillList (WW7)` is the intended trading pipeline. Each module is tested in isolation. Whether the *chain* produces a coherent output across all 32 combinations of upstream verdicts has never been tested.

3. The backtest formatter now displays 6 derived metrics (credibility, drag, Hurst, decomposition, edge-decay, operator-equation, backtest-tax). They aren't tested as a unit. A degenerate trade set could cause one to throw, and the try/catch around the whole block swallows the error silently.

**What's needed:** scenario tests that feed synthetic plan_ready events through the full subscription chain and verify the structured-observation stream contains all expected payloads. ~1 week.

### 3.5 Operator-state inference gap

**Current state:** several modules need to know "what state is the operator in." Today these inputs are env-var stubs.

| Module | Input today | Should come from |
|---|---|---|
| WW7 preExecKillList | `GORDON_OPERATOR_BORED=1` (manual) | Session-idle detection (no signals for N min but trades opening) |
| WW7 angry flag | `GORDON_OPERATOR_ANGRY=1` (manual) | WW6 debriefMatrix recent-loss-streak feed |
| WW7 rushing flag | `GORDON_OPERATOR_RUSHING=1` (manual) | Plan-emit-to-order-send latency below threshold |
| WW7 moved_stop flag | `GORDON_OPERATOR_MOVED_STOP=1` (manual) | Tracking active stop modifications on open positions |
| WW18 giveBackStop | `GORDON_SESSION_HWM_USD` (manual) | Live equity tracking across sessions |
| WW25 traderArchetype | 9 manual env booleans | Inferred from execution patterns over time |

**Why this matters:** the modules' shapes are correct; their inputs are stubs. Without inferred-state producers, the modules only work when the operator manually flips environment flags — which defeats the purpose of an autonomous harness.

**What's needed:** an `operatorState.ts` module that observes the event stream + log files and emits inferred state. Each individual inference (idle detection, latency tracking, etc.) is straightforward. The aggregation surface is the real work.

**Estimated effort:** ~1 week.

### 3.6 Real-data gap

**Current state:** zero dollars have moved through Gordon. Every module has been tested against synthetic data + Wright's worked examples. The behavior of the full stack under real market data has never been observed.

**What's needed:** paper-mode runs against live market data, with all shadow wires active and structured observations flowing to a queryable store. Two weeks of paper trading would produce enough data to begin promoting the safest shadow wires to enforcing.

**This is the highest-value next step** because everything else is gated on calibration data Gordon doesn't have yet.

**Estimated effort:** ~3 days to wire structured-observations to a queryable store (Axiom is already partially set up); 2–4 weeks of paper-mode runs to accumulate data.

### 3.7 Operator UX gap

**Current state:** slash commands exist piecemeal. No unified `/status`. The 60+ primitives surface their state through the log stream — which is excellent for an engineer reading the structured-observation logs, and basically opaque for an operator at the trading desk.

**Mercury "batteries included" gap MB3 noted this and it's still cold.**

**What's needed:**
- `/status` overview slash command (cycle status, mandate, active goal, recent verdicts, equity, drawdown)
- `/rollup` slash command surfacing WW23 dailyRollup output
- `/audit` slash command running WW13 riskBundleAuditor interactively
- `/tier` slash command showing WW8 calibration status and WW1 tier eligibility
- A unified "today" view that runs at session start

**Estimated effort:** ~2 weeks for a reasonable first version.

### 3.8 Reasoning-vs-execution asymmetry

**Current state:** the pre-trade reasoning surface is rich. The execution surface is leaner.

**Pre-trade has:** confluenceScorer (TM1), pathDependentSizer (WW1), riskClassifier (existing), absorbingBarrier (WW2), riskBundleAuditor (WW13), marginalParticipantClassifier (WW15), edgeAttribution (WW16), preExecKillList (WW7), convictionCalibrationGate (WW8), dailyDecisionJournal (WW5), traderArchetype (WW25), liquidityMapper (WW21), citationAgent, adversarialEvaluator, termination Layer 1.

**Execution has:** the executor's tool surface (place_order, cancel_order, cancel_replace_order, execute_plan), shadowMode for hypothetical PnL, executionPlaybook (TM2 — cold), strategyCheckpoint, atomicExecution.

**Post-execution has:** debriefMatrix (WW6), evals/tradeEvaluator, position:closed handler, shadow close-side worker (W1 — cold).

The middle is thin compared to the head. Specifically:
- No order-modification primitive (cancel-replace, partial-close, scale-in mid-trade)
- No position-management loop (Wright Ch 9's stop adjustments and partial closes are unimplemented)
- No order-state machine bridging plan_ready → broker-ack → fill-confirmation → close

This asymmetry is a consequence of Gordon's history (focus on signal-generation first), not a design flaw. But it shows up as: rich plans, lean order management.

**Estimated effort:** ~3–4 weeks for a proper order-state machine + position-management loop. Pair with WW4 producers and TM2 wiring.

### 3.9 Production-engineering bar gap (PE1–PE12 in deferred-wiring spec)

Surfaced by the "Missing Engineering Stack for Production AI Agents" piece. Maps the production-readiness checklist onto items Gordon doesn't yet have. The first two checklist primitives (tokens, skills composition) are ~90% in place; security and trust columns surface most of the gaps. Tracked in detail as PE1–PE12 in `docs/harness-deferred-wiring.md`.

The 12 items group into four areas:

- **Distribution surface.** Agent-native MCP server (PE1), per-agent OAuth tokens replacing env credentials (PE2), supply-chain attestation (PE4) — making Gordon reachable and verifiable by external agents and regulated reviewers.
- **Security plumbing.** Output content classifier scanning tool calls pre-execution for exfil patterns (PE3), DefenseClaw integration wrapping Skills Scanner / MCP Scanner / CodeGuard / Guardrail Proxy around the runtime (PE10).
- **Trust telemetry.** Drift detection on embeddings + behavioral metrics (PE5), behavioral canary harness running daily adversarial probes (PE6), integrity-chained Merkle audit log anchored to immutable storage (PE7), composite TrustScore rollup (PE8), OpenTelemetry GenAI semconv emission (PE9).
- **Compliance + structure.** TrustModel.ai GRC overlay mapping to NIST AI RMF / ISO 42001 / EU AI Act / SOC 2 / FedRAMP (PE11), skills refactor to trigger/action/restriction triples for safer policy evolution (PE12).

**Estimated effort:** PE9 is hours; PE4, PE12 are 3 days each; PE3, PE7, PE8 are ~1 week each; PE2, PE5, PE6, PE10, PE11 are 1-2 weeks each; PE1 (MCP server) is 1-2 weeks and already on the critical path. Roughly 8-12 weeks total if pursued in full.

**Relevance gate:** these items are required only if Gordon pursues the enterprise / regulated-finance / agent-firm-treasury positioning the strategic articles point at. For retail-only operator-shadow product, most are over-engineering at the current usage stage. Pick the lane before building.

---

## 4. Realistic sequencing

Rough order of value:

**Wave A (~2 weeks) — get data flowing**
1. Wire structured-observations to Axiom (~3 days)
2. Start paper-mode runs with all shadow wires active
3. Build `/status` slash command for in-the-moment operator visibility (~1 week)
4. Build `operatorState.ts` inference module (~1 week)

**Wave B (~3 weeks) — promote the safe shadows**
1. Promote AR1 + AR2 anti-rot to enforcing (~2 days)
2. Promote WW2 absorbingBarrier broker leg to enforcing (~1 day)
3. Promote WW7 preExecKillList to enforcing when 4+ flags fire (~2 days)
4. Promote WW8 convictionCalibrationGate to clamp WW1 sizer tiers (~3 days)
5. Promote WW1 pathDependentSizer to executor-read (~1 week)
6. Add integration tests for the promoted chain (~3 days)

**Wave C (~3 weeks) — executor instrumentation**
1. WW4 frictionTracker producers across exchanges (~2 weeks)
2. Fill-event emission across connectors (~1 week)
3. WW19 adverseSelectionDetector wire on top of fill events (~2 days)

**Wave D (~3 weeks) — portfolio surface**
1. `portfolioState.ts` aggregation (~1 week)
2. WW20 correlationRegimeMonitor wire (~3 days)
3. WW11 shannonsDemonRebalancer wire as opt-in surface (~1 week)
4. Real correlation caps in pre-trade (Wright Ch 9 10% rule)

**Wave E (~3 weeks) — execution side**
1. TM2 executionPlaybook wire (planner picks playbook, executor schedules clips)
2. Position-management loop (stop adjusts, partial closes per TM2 + WW18)
3. W3 termination Layers 2 + 3 (broker-ack + post-fill reconciliation)

**Wave F (~2 weeks) — operator UX**
1. `/rollup`, `/audit`, `/tier` slash commands
2. Unified daily overview
3. Plan-card displays for the shadow verdicts that aren't promoted yet

**Total estimated effort to "great harness":** ~16 weeks of focused work. Roughly 4 months.

---

## 5. The viable interim product: operator-shadow

Even before all the above lands, Gordon today is a credible **operator-shadow** product:

- Run alongside a discretionary trader
- Plug in their existing broker via the connector layer
- Subscribe to their plan_ready events (or have them post plans via slash command)
- Shadow-evaluate every plan against the full 60-primitive library
- Surface verdicts in a sidebar / log / structured-observation stream
- Build the calibration data that would eventually justify enforcing-mode

This frame has real product-market fit for the "I want a second opinion on my trades" user. It's also the natural ramp toward fully autonomous trading: every shadow run is calibration data; every calibration run validates a gate; every validated gate becomes enforcing.

The operator-shadow frame requires very little additional work to ship. The full autonomous-harness frame is the 16-week roadmap above.

---

## 6. What the Wright port did and didn't accomplish

### Did

- Brought the trading-discipline primitive library from "comprehensive" to "near-complete vs the best literature"
- Filled real gaps: path-dependent sizing, three-barrier model, regime sensing math, performance decomposition, edge attribution, friction tracking, debrief matrix, conviction calibration, give-back stop, marginal-participant classifier
- Documented 6 deliberate skips with reasons
- Produced 22 modules + 491 tests in ~3 days of focused work
- Established the pattern (cold module → shadow wire → enforcing promotion) that the rest of Gordon should follow

### Didn't

- Make Gordon autonomous (most wires are still shadow)
- Solve the executor-instrumentation gap (book is about epistemology, not order routing)
- Solve the portfolio-state gap (book is single-trade focused, like Gordon)
- Provide real-world calibration (no trades have happened)
- Build operator-facing UX (book doesn't discuss this)

This is exactly what you'd expect from a *book*. Books contain knowledge. Harnesses contain infrastructure. The Wright port closed the knowledge gap nearly fully; the infrastructure gap remains.

---

## 7. Honest framing for outside audiences

**For investors / partners:** Gordon has the most comprehensive trading-discipline primitive library in any open agentic-trading system, drawn from the canonical literature. The primitive library is roughly 80–90% complete vs the best practitioner standards. The operational harness — enforcement, executor instrumentation, portfolio state, integration tests, real data — is roughly 50–60% complete and is the focus of the next quarter.

**For engineers:** ~60 trading-domain primitives, ~35 harness-engineering primitives, ~25 trading infrastructure modules. 491+ tests passing. Typecheck clean. ~16 shadow wires running on plan_ready, ~3 enforcing gates active. WW4 producers (executor instrumentation) is the most consequential missing piece. Paper-mode data is the gate on promotion to enforcing.

**For traders:** Gordon today is an excellent shadow / second-opinion system. Plug it in alongside your existing workflow and it will tell you (a) what tier this trade should be, (b) what risks you're not pricing, (c) whether your counterparty is sophisticated or constrained, (d) whether your edge attribution survives Lebron's 5-minute test, (e) what your give-back floor is for the session, (f) whether your post-trade debrief lands in the dumb-luck quadrant. It will not yet place or manage orders for you autonomously.

---

## 8. Module inventory (appendix)

### Wright port (25 modules)

| WW | Module | Source | Wired |
|---|---|---|---|
| WW1 | pathDependentSizer | Ch 9 + 16 | shadow |
| WW2 | absorbingBarrier | Ch 13 | shadow |
| WW3 | volatilityDrag | Ch 13 | formatter |
| WW4 | frictionTracker | Ch 6 + 16 | cold (no producers) |
| WW5 | dailyDecisionJournal | Ch 16 | shadow |
| WW6 | debriefMatrix | Ch 15 | close-hook |
| WW7 | preExecKillList | Ch 16 | shadow |
| WW8 | convictionCalibrationGate | Ch 9 | shadow |
| WW9 | operatorEquation | Ch 6 | formatter |
| WW10 | weeklyRegimeCheck | Ch 16 | shadow |
| WW11 | shannonsDemonRebalancer | Ch 13 | cold (no portfolio state) |
| WW12 | performanceDecomposition | Ch 11 | formatter |
| WW13 | riskBundleAuditor | Ch 10 | shadow |
| WW14 | hurstExponent | Ch 14 | formatter |
| WW15 | marginalParticipantClassifier | Ch 1/7/12 | shadow |
| WW16 | edgeAttribution | Ch 7 | shadow |
| WW17 | streakCircuitBreaker | Ch 8/9 | shadow |
| WW18 | giveBackStop | Ch 8 | shadow |
| WW19 | adverseSelectionDetector | Ch 3 | cold (no fill events) |
| WW20 | correlationRegimeMonitor | Ch 14 | cold (no portfolio state) |
| WW21 | liquidityMapper | Ch 12 | shadow |
| WW22 | edgeDecayMonitor | Ch 7 | formatter |
| WW23 | dailyRollup | Ch 2 | session-start |
| WW24 | backtestTax | Ch 9 | formatter |
| WW25 | traderArchetype | Ch 8 | shadow |

Deliberate skips: full Kelly, TPO indicators, emotion-journaling workflow, morning briefing aggregation, key-levels watchlist, per-field "Why?" enforcement, Pro/Counter checklist, GIPS compliance.

### TraderMorin port (3 modules)

| TM | Module | Wired |
|---|---|---|
| TM1 | confluenceScorer | cold |
| TM2 | executionPlaybook | cold |
| TM3 | decisionLog lifecycle stages | partial (field added, no producers populate) |

### Anti-rot trio (3 modules)

| AR | Module | Wired |
|---|---|---|
| AR1 | thesisCoherence | cold (terminationLayers hardcodes null) |
| AR2 | tradingUniverse | cold (terminationLayers hardcodes true) |
| AR3 | traderBehaviorPatterns | cold |

### 5-wire batch follow-ups

| W | Item | Status |
|---|---|---|
| W1 | shadow close-side worker | cold (open side wired, close side missing) |
| W2 | citation evidence enrichment | cold (pipeline wired, no producers) |
| W3 | termination Layers L2 + L3 | cold |
| W4 | L1 promotion shadow → enforcing | data-blocked |
| W5 | adversarial critique calibration | data-blocked |

### Earlier harness-engineering ports (selection)

Effective harnesses: A1 tradingFeatureList, A2 initializerAgent, A3 initProbe, A4 safetyConfigGuard — all wired
GAN evaluator: V1 adversarialEvaluator (wired), V2 evaluatorCalibration, V3 contextAnxietyDetector, V4 sprintContractNegotiation
Durable execution: R1 durableStep (wired), R2 errorOnlyOutputFilter (wired)
Multi-agent research: MA1 citationAgent (wired plan_ready), MA2 effortCalibration (wired)
Sandbox / tool hygiene: S1 networkAllowlist (wired doctor), S2 filesystemWriteGuard (wired doctor), S3 toolDesignLinter (importable)
Context engineering: C1 kvCacheHitMetric, C2 silentToolResultFormatter, C3 claudeMdLinter, C4 recitationCheckpoint
12-Factor F7: humanInputTool (wired slash commands)
Hooks H1/H2/H3: UserPromptSubmit, SessionEnd, externalHookRunner

### Backtest credibility (Q1–Q4)

| Q | Module | Wired |
|---|---|---|
| Q1 | featurePipeline | wired |
| Q2 | strategyCodeValidator | wired |
| Q3 | marketImpact | wired |
| Q4 | multipleTestingTracker | wired |

### Goal mode + harness evolution

G1 goalMode — wired (slash commands, autonomous-loop, TUI)
H1 harnessEvolution — cold

---

## 9. Conclusion

Gordon is a deeply-instrumented retail-trading agent with the best primitive library available in any open system. It is not yet a fully-autonomous trading harness. The path between those two states is mapped, scoped, and not blocked by missing knowledge.

The Wright port — and the larger harness-engineering port project that preceded it — closed the knowledge gap. The remaining gap is operational: enforcement promotion, executor instrumentation, portfolio state, integration tests, real data, operator UX.

Sixteen weeks of focused work would close that gap. Two weeks of focused work would make Gordon a credible commercial operator-shadow product.

Either path forward is well-defined.
