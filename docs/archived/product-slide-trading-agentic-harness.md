# Gordon — Trading-Oriented Agentic Harness

Product slide prep / moat inventory.

**Anchor against Pear VC RFS #2** ("Financial-Grade Agent Infrastructure" — trust and policy layers for AI agents in financial contexts, identity/authorization frameworks, compliance enforcement, audit trails for irreversible actions). Gordon's trading-oriented agentic harness is a direct response to that RFS, vertical-first in retail trading.

Counts from `src/` (production code, test files excluded unless noted):

- **1,218 production TypeScript files**
- **221 test files**
- **60+ trading-domain primitives** (38 in `src/infra/trading/ops/` alone with 33 tests)
- **9 distinct harness layers** described below

---

## The harness in one sentence

> A vertical trust-and-policy substrate that runs every trade idea through a 12-primitive pre-trade chain — counterparty intelligence, edge attribution, risk bundle audit, sizing math, three-barrier survival check, operator-state gates, liquidity mapping, friction tracking — before any order touches a broker, with structured-observation traces of every verdict for audit and continuous calibration.

---

## The 9 harness layers

### Layer 1 — Trading-discipline library (the textbook compressed into code)

**Location:** `src/infra/trading/ops/`, `src/infra/trading/risk/`, `src/infra/trading/quant/`, `src/infra/trading/portfolio/`, `src/core/regime/`, `src/core/risk-kernel/`, `src/core/strategies/recipes/`

| Sub-area | Modules |
|---|---|
| **Wright port** (25 modules from *The Art & Business of Professional Trading*) | pathDependentSizer, absorbingBarrier, volatilityDrag, frictionTracker, dailyDecisionJournal, debriefMatrix, preExecKillList, convictionCalibrationGate, operatorEquation, weeklyRegimeCheck, shannonsDemonRebalancer, performanceDecomposition, riskBundleAuditor, hurstExponent, marginalParticipantClassifier, edgeAttribution, streakCircuitBreaker, giveBackStop, adverseSelectionDetector, correlationRegimeMonitor, liquidityMapper, edgeDecayMonitor, dailyRollup, backtestTax, traderArchetype |
| **TraderMorin port** | confluenceScorer (A*/A/B/C tier), executionPlaybook (scaled clips + ATR offsets), decisionLog lifecycle stages |
| **Anti-rot** | thesisCoherence, tradingUniverse, traderBehaviorPatterns, strategyMandates |
| **Quant primitives** | cointegration, grangerCausality, hurstExponent (separate from ops), kalmanFilter, marketEfficiency, markovRegime, reflexivity, scenarioValuation |
| **Risk surfaces** | correlationLimits, drawdownOverlay, riskClassifier (11 dimensions), tailRisk, volatilityPositionSizing |
| **Portfolio** | autoOptimizer, autoRebalance, blackLitterman, metaWeighting, optimizerEnhancements, portfolioDiff |
| **Signals** | marketContext, orderflowDelta, syntheticFutures |
| **Regime** | classifier, detector, indicators, watcher, types |
| **Risk kernel** | audit, config, correlation, kernel, portfolio-context |
| **Strategy recipes** | bounceCounter, maxExposureTimeout, regimeRsi, signalGate |

### Layer 2 — Agentic harness substrate (the runtime that makes agents safe)

**Location:** `src/infra/agents/harness/`, `src/infra/agents/cognition/`, `src/infra/agents/tooling/`, `src/infra/agents/processors/`, `src/infra/agents/middleware/`, `src/infra/agents/toolOutputFilters/`, `src/infra/agents/reminders/`, `src/infra/agents/orchestrator/`, `src/infra/hooks/`

| Sub-area | Modules |
|---|---|
| **Runtime harness** | contextAnxietyDetector, lifecycleHooks, recitationCheckpoint, runtimeHarness (doom-loop detection w/ MD5 fingerprinting + sliding window), runtimeRecovery (tiered: Notify → Redirect → ForceStop), subagentCoordination, subagentProfiles |
| **Cognition** | adversarialEvaluator (hostile critic), citationAgent (evidence trail), critiquePhase (HIGH thinking pass), effortCalibration (match effort to complexity), evaluatorCalibration (anti-drift), extendedThinking (Anthropic budget_tokens), reflection, thinkingPhase (tool-free pre-pass), transcriptValidator, workflowPhase |
| **Tool plumbing** | instrumentedTools (single registration point — wraps every tool with metrics + spill), toolDeferral (hide tools from schema until activated; ~50% schema-token savings), toolErrorNormalizer, toolResultCache (delta envelope on hit), toolTimeouts |
| **Tool output filters** | getCandles, getOrderbook, scanMarket — semantic compression of noisy market-data tool outputs |
| **Lifecycle hooks** | engine (PreToolUse, PostToolUse, UserPromptSubmit, SessionEnd, PreOrderPlacement, etc), externalHookRunner (shell scripts at lifecycle points) |
| **Middleware** | access-control, guardrails |
| **Orchestrator** | HandoffCoordinator, RequestContextFactory, Security, StreamCoordinator, StreamLifecycle, streamProcessor, summarization, toolAgentMap, UsageTracker |
| **Reminders** | reminderScheduler (turn-cadence injection), traderReminders (daily loss limit, mandate scope, open positions) |
| **Processors** | input-guard, output-sanitizer |

### Layer 3 — Permissions + safety gates (the "won't do dumb things" layer)

**Location:** `src/runtime/permissions/`, `src/infra/safety/`, plus trading-specific gates in `src/infra/trading/ops/`

| Sub-area | Modules |
|---|---|
| **Permissions** | PermissionEngine (deny-first; exposes registerHook / prependHook), trustTrajectory (adaptive auto-approval with safety-critical deny-list), permissionBubble (fork-originated tag) |
| **Safety primitives** | absorbingBarrier (three-barrier model: broker / prop-firm trailing / psychological), assetClassInference, cleanStateGate, filesystemWriteGuard, networkAllowlist, planRubric, safetyConfigGuard, sprintContract, sprintContractNegotiation, wipLimit |
| **Anti-trap defense** | anti-trap/ (record_user_thesis, record_supervision_outcome, set_trading_universe, set_running_thesis, set_strategy_mandate) |
| **Trading-specific gates** | terminationLayers (3-layer: pre-trade / runtime ack / post-fill reconciliation), riskBundleAuditor (8-category Yes/No/Neutral audit), strategyCodeValidator, tradingFeatureList (edit-only-passes enforcement) |
| **Rationale enforcement** | `execute_plan` and all `cancel_*` order tools require `rationale: string (min 10)` — logged via recordStructuredObservation with `eventType: "*.rationale_recorded"` |
| **Deny-list bypass** | `place_order`, `execute_trade`, `cancel_order`, `wallet_transfer`, etc. — these bypass trust-trajectory scoring; never auto-approved |

### Layer 4 — Memory + context engineering

**Location:** `src/infra/domain/memory/`, `src/infra/agents/memory/`, `src/infra/agents/ace/`

| Sub-area | Modules |
|---|---|
| **Compaction** | summarizer (4-stage: masking 70% → pruning 80% → aggressive 90% → full summary 99%, with recent-observation preservation 6/6/3/3), contextCollapse (5th stage — non-destructive read-time projection), turnSummary |
| **Memory tiers** | aceMemory, decisionLog (JSONL audit), mastraStorage, memory, memoryFactory, memoryGate (cap working memory at 2200 chars; truncates on write), threadManager |
| **Hot-tier discipline (Hermes pattern)** | Working memory holds ONLY durable trader-profile fields (risk prefs, venue, account type). Semantic recall is **off by default** — cold recall via `searchMemoryTool` / `getMemoryContextTool` / `getLessonsTool` (model-decides, not ambient injection) |
| **ACE** | Reflector → Curator pipeline for distilling lessons into the shared system prompt across sessions |

### Layer 5 — Observability + audit trail (the "compliance" part of Pear RFS #2)

**Location:** `src/infra/platform/observability/`

| Module | Role |
|---|---|
| `structured.ts` | Axiom integration; every gate verdict → structured observation (eventType, workflow, source, component, outcome, controllability, symbol, toolName, reason, details) |
| `tracing.ts` | OTel tracer with span attributes per tool call |
| `metrics.ts` | Counter / gauge / histogram emission |
| `alertAuditMirror.ts` | Audit-grade mirror of alert stream |
| `alertEmitter.ts` | Cross-channel alert dispatch |

**Coverage:** every safety-critical decision (sizing, barrier check, kill-list, conviction calibration, termination L1) emits a structured observation. The audit trail for irreversible actions is built in, not bolted on.

### Layer 6 — Eval harness (RULER pattern, anti-bias by design)

**Location:** `src/infra/domain/evals/`

| Module | Role |
|---|---|
| `harness/runner.ts` | Trajectory-agnostic eval runner |
| `harness/panelJudge.ts` | Tri-judge panel (Anthropic + OpenAI + Google via Dedalus) — failing judges drop from consensus; cross-family averaging removes ~0.3 self-preference bias |
| `harness/categoryRubrics.ts` | Per-category red-flags + good-signals (scan / analysis / planning / execution / education / recovery) — "good planning" and "good analysis" scored against different checklists |
| `harness/trajectoryJudge.ts` | Scores final answer quality (not path efficiency — unusual paths penalized only if final degrades) |
| `harness/regression.ts` | Baseline-vs-candidate diff with hasBlockingRegression gate |
| `harness/reviewQueue.ts` | Append regressions to `~/.gordon/eval-failures.jsonl` for grep / promote into gold set |
| `harness/scenarios/` | Hand-curated reference scenarios (plan-card-btc, regime-flip, risk-gate) |

### Layer 7 — Diagnostics + introspection

**Location:** `src/infra/diagnostics/`

| Module | Role |
|---|---|
| `doctor.ts` | Surfaces all wired safety/diagnostics primitives in one snapshot |
| `agentReadiness.ts` | Session-start gate: are tools, memory, permissions, hooks all green? |
| `boundaries.ts` | Architectural boundary check (CI hook) |
| `claudeMdLinter.ts` | Static analysis on agent-instruction markdown |
| `coldStartAudit.ts` | Audit at first-run setup |
| `initProbe.ts` | E2E boot probe exercising Gordon's runtime |
| `qualityDocument.ts` | Per-feature quality status doc |
| `toolDesignLinter.ts` | Static analysis on the tool registry (well-named, well-typed, well-described) |

### Layer 8 — Backtest credibility (filter the lies before they become strategies)

**Location:** `src/backtest/`, `src/infra/trading/ops/`

| Module | Role |
|---|---|
| `backtestCredibility.ts` | PSR + DSR + minTRL credibility scoring |
| `backtestTax.ts` | Wright's 15%/25% discount on backtest win-rate + payoff before sizing math |
| `marketImpact.ts` | Realistic cost model + capacity sweep (Q3) |
| `multipleTestingTracker.ts` | DSR with dynamic trial-count bar (Q4) |
| `volatilityDrag.ts` | R_geo = R_arith − σ²/2 |
| `performanceDecomposition.ts` | Return = Beta + Factors + Alpha (4-class verdict: skill / factor_harvester / leveraged_beta / noise) |
| `edgeDecayMonitor.ts` | Rolling expectancy vs baseline → stable / degraded / retire |

### Layer 9 — Operator-facing surface (the product layer)

**Location:** `src/infra/agents/tools/runtime/`, `src/infra/agents/skills/`, `src/app/slash/`

| Surface | What it does |
|---|---|
| `/shadow` (shadowPlan tool) | Runs hypothetical trade through full 12-primitive pre-trade chain. No orders placed. Returns markdown verdict. |
| `/rate +/-` (feedbackRating tool) | Explicit feedback against most recent shadow plan → JSONL + Axiom |
| `/status` (statusOverview tool) | Unified snapshot: equity, session PnL, recent debriefs, friction, mandate, active flags |
| `/skill` (skill-loader tool) | 11 built-in markdown playbooks (morning brief, exit review, risk check, swing entry, weekend review, etc) |
| Implicit retry detection | Re-running `/shadow` on same symbol+direction+entry within 60s and 2% tolerance fires dissatisfaction signal |
| Rationale-required tools | `execute_plan`, all `cancel_*` orders — operator (or agent) must provide ≥10-char rationale, logged for audit |

---

## Direct mapping to Pear VC RFS #2 — "Financial-Grade Agent Infrastructure"

Pear is explicit about three pillars. Gordon has them all:

| Pear's pillar | Gordon's implementation |
|---|---|
| **Identity & authorization frameworks** | PermissionEngine (deny-first), trustTrajectory (adaptive auto-approval with safety-critical deny-list bypass), permissionBubble (fork tagging), per-tool `requiresApproval` flags |
| **Compliance enforcement** | Anti-rot trio (thesis coherence + universe scope + behavior patterns), terminationLayers (3-layer), riskBundleAuditor (8-category yes/no/neutral), riskClassifier (11-dim), rationale-required safety-critical tools, planRubric, safetyConfigGuard |
| **Audit trails for irreversible actions** | recordStructuredObservation → Axiom for every gate verdict; decisionLog JSONL with lifecycle stages; citationAgent evidence manifests per plan; risk-kernel audit; alertAuditMirror; the rationale field on cancel/execute is logged with `*.rationale_recorded` event type |

---

## The moat — what makes this defensible

### 1. Trading-literature compression is one-time work

The canonical trading-discipline literature (Wright, TraderMorin, Lebron, Carver, Donnelly, Thorp, Lo, Taleb) is finite. We've encoded ~25 chapters of Wright + the harness-engineering canon (Anthropic / OpenDev / Fowler / LangChain / Manus / HumanLayer / 12-Factor / Inngest) into ~95 modules. A new entrant has to redo that work; it took us ~3 days per major book port at sprint pace because we have the pattern. Total moat = months of focused engineering, encoded as composable primitives.

### 2. The pre-trade chain depth is unique in retail

Counting the modules that fire on a single `plan_ready` event:

```
marginalParticipantClassifier → edgeAttribution → riskBundleAuditor →
confluenceScorer (tier) → convictionCalibrationGate (clamp tier) →
pathDependentSizer → absorbingBarrier → preExecKillList →
liquidityMapper → streakCircuitBreaker → giveBackStop → traderArchetype
```

12+ primitives. Most retail-trading agents have 0-2 (a single risk-check). This depth is the difference between "an LLM that places trades" and "a trust-and-policy substrate for trading."

### 3. Shadow-by-default with structured observation per verdict

Every gate logs its verdict to Axiom before it enforces anything. Two weeks of paper-mode runs produce calibration data that justifies promoting gates one at a time. Without this discipline, an agentic trader becomes a confident overfit; with it, every gate carries its own evidence trail. This is the "policy layer" Pear RFS #2 asks for, operationalized.

### 4. Vertical-first beats horizontal-fintech

Horizontal "agent infrastructure for finance" companies (e.g. agentic banking, agentic payments) treat the problem as authentication + payment-rails. We treat it as encoded *judgment*. The trading vertical demands every layer (counterparty intelligence + sizing math + regime sensing + operator psychology) that a horizontal play has to invent from scratch. Vertical-first → first-mover insight → horizontal expansion through proven primitives.

### 5. Cold-module + flag pattern as deployment discipline

~50 of the ~60 trading primitives ship cold (behind `GORDON_*` env flags). Promotion to enforcing is gated on data. This is the opposite of YOLO-LLM trading agents. It's also a competitive moat: anyone trying to catch up has to also build the gate-promotion calibration infrastructure, not just the primitives.

### 6. Eval harness with tri-judge anti-bias panel

3 LLM judges from different families (Anthropic + OpenAI + Google) via Dedalus router, with categorical rubrics + outcome-over-trajectory scoring. The CREAO anti-bias frame is built in. Most agentic startups have no eval harness at all; the ones that do typically use a single-judge setup with the ~0.3 self-preference bias unaccounted for.

### 7. Verifiable in commits, not in slides

Every primitive lands in `git log` with a conventional commit, a corresponding test file, a section in `docs/harness-deferred-wiring.md`, and (for ~16 of them) a wired shadow verdict in `agent-subscriptions.ts`. The work is auditable, not just claimed.

---

## What's intentionally NOT in this slide

- Strategy generation (LLM → DSL). Strategy is downstream of the harness; the harness is the moat.
- Exchange / broker connectors. Plumbing, not the value.
- The autonomous-loop / radar / proactive producers. Useful, but not the trust layer.
- The eval scenarios themselves. Method matters more than 3 examples.

---

## One-sentence frame for the slide

> Gordon is the trust-and-policy substrate for AI-powered retail trading: a 60-primitive pre-trade chain encoding the trading-discipline literature into runnable code, with structured-observation audit trails on every verdict and shadow-by-default deployment discipline.

## Three-sentence frame

> AI agents are coming to financial markets, but the infrastructure to make them safe doesn't exist yet — current retail-trading bots are LLMs gluing together order-placement APIs with no policy layer between intent and execution. Gordon is the missing substrate: 60+ trading-discipline primitives (sizing, regime, edge attribution, friction, three-barrier survival, operator-state gates) compiled from the canonical literature, composed into a 12-step pre-trade chain that every order must pass through, with structured-observation audit trails for every verdict. Vertical-first in retail trading because that's where the trust gap is most acute; the same substrate ports to RIAs, prop firms, and ultimately any agentic-finance vertical.
