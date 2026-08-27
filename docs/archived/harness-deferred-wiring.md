# Harness-Engineering Deferred Wiring

Working punch list for turning cold harness modules into hot-path enforcement.
All modules below already exist, are tested, and ship behind feature flags
(`GORDON_*`). What's deferred is the **integration** — connecting each module
to the runtime callsites that would make it fire.

Status: each section captures what's ready, what's missing, and the rollout
posture. None of these are urgent — they're tracked here so the work isn't
lost between sessions. Pick by signal, not by schedule.

## Source crosswalk

Harness primitives were ported from two related sources:

- **walkinglabs.github.io/learn-harness-engineering** — lecture series (L01–L12, 6 projects, 7 templates)
- **hands-on-harness-engineering.com** — module-based lab course building `noted-cli` through 11 modules + capstone

The crosswalk lives in `~/.claude/projects/.../memory/project_harness_engineering_mapping.md`.

---

## Tier 1 — already-shipped primitives, deferred wiring

### A1. Plan rubric in plan card UI

**Module:** `src/infra/safety/planRubric.ts`
**Flag:** `GORDON_PLAN_RUBRIC` (default off)
**Status:** Module + tests ship. `runCritiqueWithRubric` returns 6-dimension
0-2 scores + verdict (accept/revise/block) + blocking dimensions list.

**Wire point:** `src/tui/components/messages/PlanApprovalMessage.tsx`. Today
this component only renders `message.content` as a string. Adding a rubric
display requires changing the message shape carried on the event bus so the
rubric scores reach the TUI.

**What's needed:**
1. Extend the message shape used by plan-approval rendering to optionally
   carry a `PlanRubric` payload.
2. Either run the rubric in-band during plan synthesis (cheap dimensions
   only) or attach an existing rubric result from the critique pass.
3. Render the 6 dimensions as compact 0-2 bars under the plan card with the
   verdict tag (`accept` / `revise` / `block`) and the blocking dimensions
   list.

**Risk:** Low. UI-only; failure means no rubric display.
**Acceptance:** A plan-approval card shows the 6 dimensions, total, verdict, and the blocking dimensions when verdict ≠ `accept`.

---

### A2. `/sprint-status` slash command

**Module:** `src/infra/safety/sprintContract.ts` + `src/core/pipeline/autonomous-loop.ts:getCurrentSprintContractView`
**Flag:** `GORDON_SPRINT_CONTRACT` (default off)
**Status:** Inspector `getCurrentSprintContractView()` already exposed.
Returns `{ contract, symbolsTouched, cycleCount }`.

**Wire point:** `src/app/slashCommands.ts`. Add a `/sprint-status` command
that calls the inspector and formats the result + diff between contract
scope and actuals.

**What's needed:**
1. Define `/sprint-status` entry in `slashCommands.ts`.
2. Format using `formatSprintContract()` + `diffToPayload()` from the
   sprint-contract module.
3. If no contract is active (autonomous loop not running), say so cleanly.

**Risk:** Low. Read-only command.
**Acceptance:** Typing `/sprint-status` during an autonomous-loop session prints the active contract scope, what's touched so far, and the diff if any.

---

### A3. Working-memory flush signal ✅ wired

`isWorkingMemoryDurable()` from `memoryGate.ts` is already wired into
`gracefulShutdown.ts`'s clean-state-gate. No further work.

---

## Tier 2 — already-shipped primitives, deferred wiring

### B1. `recordDecision` capture points

**Module:** `src/infra/agents/memory/decisionLog.ts`
**Flag:** `GORDON_DECISIONS_LOG` (default off)
**Status:** Module + tests ship. JSONL at `~/.gordon/decisions.jsonl` via
`recordDecision({ threadId, category, summary, ... })`. Categories:
`plan | mandate | risk-override | venue | strategy | entry-timing | exit | other`.

**Wire points:**
1. **Planner** (`src/infra/agents/definitions/executor.ts` plan synthesis):
   when a plan is finalized, capture `category: "plan"` with the chosen
   alternative + rejected alternatives.
2. **Mandate selection** (`src/infra/safety/anti-rot/strategyMandates.ts:selectMandateForPlan`):
   capture `category: "mandate"` with the mandate chosen + why over others.
3. **Risk-override flow** (wherever a human approves a `block` verdict):
   capture `category: "risk-override"` with the dimensions overridden + reason.
4. **Entry/exit timing decisions** during execution.

**What's needed at each callsite:**
1. Construct `RecordDecisionInput` with `threadId`, `category`, `summary`,
   optional `symbol`, optional `alternatives`, optional `evidence`.
2. Call `recordDecision(input)` (returns null if flag off — no-op safe).

**Read side:** No consumer yet. The log only earns priority once something
*reads* it (resume-summary, `/decisions` command, or ACE prompt enrichment).
Build the reader alongside the first capture point that needs it.

**Risk:** Low at write side. Decision log is append-only.
**Acceptance:** Decisions log contains one entry per plan synthesis when the flag is on; entries include rejected alternatives and rationale.

---

### B2. `checkAgentReadiness` at session start

**Module:** `src/infra/diagnostics/agentReadiness.ts`
**Flag:** `GORDON_AGENT_READINESS_GATE` (default off; `GORDON_AGENT_READINESS_OVERRIDE=1` bypasses)
**Status:** Module + tests ship. Four conditions: `can_start`, `can_test`,
`can_see_progress`, `can_hand_off`. Returns `{ ready, conditions, blockingMessage }`.

**Wire point:** `src/app/setup/setup-runtime.ts` — somewhere early in the
boot sequence, after env is loaded but before any agent tool can fire.

**What's needed:**
1. Construct `ReadinessInputs` — Gordon home dir, mastra db path, ACE
   lessons path, session-handoff path, probes for paper-mode + eval-harness
   reachability, action-log entry count.
2. Call `checkAgentReadiness(input)`.
3. If `verdict.ready === false` and override is not set, surface
   `verdict.blockingMessage` in the TUI and refuse to start the loop.
4. Always record the readiness payload via `recordStructuredObservation`.

**Risk:** Low if behind flag. Could be loud at startup if condition probes
are slow — keep probes synchronous and cheap.
**Acceptance:** First agent action of a session is preceded by a readiness check; failures present remediation text per failing condition.

---

### B3. Termination layers in `execute_plan` ⚠ highest risk — Layer 1 shadow-wired

**Module:** `src/infra/trading/ops/terminationLayers.ts`
**Flag:** `GORDON_TERMINATION_LAYERS` (default off)
**Status:** Module + tests ship. Three layers: pre-trade / runtime / system.
Each returns a `LayerResult` with `status`, `message`, and an L10-style
`fixInstruction` on fail.

**Wire point:** The `execute_plan` tool (`src/infra/agents/tools/trading/execute-plan.ts` or wherever the canonical execution handler lives) — wrap the existing reconciliation/ack/post-fill logic.

**What's needed:**
1. **Pre-trade gate (Layer 1):** Already partially exists today via
   `riskClassifier` + constitution + mandate-scope checks. Convert those
   verdicts into `PreTradeInput` and call `checkPreTrade()`. If fail, abort
   before order submission.
2. **Runtime gate (Layer 2):** After order submission, populate
   `RuntimeInput` from broker ack + latency + reject reason. Call
   `checkRuntime()`. On fail, do **not** retry blindly — `fixInstruction`
   says why.
3. **System gate (Layer 3):** After reconciliation worker reports
   actual fill, populate `SystemConfirmationInput`. Call
   `checkSystemConfirmation()`. On fail, record but the trade is already
   filled — the verdict goes to audit + a follow-up cancel/hedge decision.
4. Aggregate via `runTerminationLayers()` and emit
   `terminationToPayload()` to the action log.

**Rollout posture:** **Shadow mode first.** Even with the flag on, run the
gates in observation-only mode for a week of paper trading. Compare
`runTerminationLayers().verdict` against actual outcomes to calibrate
thresholds (slippage tolerance, ack-timeout) before enabling block-on-fail.

**Risk:** Highest of any item on this list. Trade execution is the hot
path. False-positive blocks on Layer 1 = missed trades; false negatives on
Layer 3 = uncaught risk events.

**Acceptance:**
- Phase 1 (shadow): Every `execute_plan` call also produces a termination payload in the action log. No block-on-fail behavior.
- Phase 2 (enforce): Layer 1 fail blocks order submission. Layer 2 fail prevents naive retry. Layer 3 fail triggers a recorded reconciliation alert.

---

## Tier 3 — already-shipped primitives, deferred wiring

### C1. `shadowMode` subscription to `strategy:plan_ready` ✅ wired (open side)

**Module:** `src/infra/trading/ops/shadowMode.ts`
**Flag:** `GORDON_SHADOW_MODE` (default off)
**Status:** Module + tests ship. `recordShadowOpen` / `recordShadowClose` /
`readShadowFills` / `summarizeShadowFills` / `compareShadowVsReal`. JSONL at
`~/.gordon/shadow-fills.jsonl`.

**Wire points:**
1. **Open:** Subscribe to `strategy:plan_ready` (see `src/events/agent-subscriptions.ts:440`). For each event, call `recordShadowOpen` with current market mid as `entryPrice`.
2. **Close:** A new background worker polls open shadow fills against
   current market prices and emits `recordShadowClose` when stop/target hit
   or after a configurable max-hold window.
3. **Compare:** Periodic (e.g. daily) job runs `compareShadowVsReal` against
   the existing trade-evaluator output and surfaces the divergence in the
   TUI status area.

**What's needed:**
1. **Dedup guard:** the module deliberately does not dedupe planIds. The
   subscriber must track which planIds have been shadowed and skip
   duplicates (autonomous loop can re-fire the same plan).
2. **Close-worker:** new module under `src/infra/trading/ops/` that ticks
   every N seconds, reads open shadow fills, pulls current market data
   (use existing `get_candles` / quote infra), and resolves via stop/target/timeout.
3. **Storage cap:** JSONL is unbounded; either rotate weekly or compact
   closed fills into a summary table.

**Risk:** Medium. New background loop adds load. False shadow PnL is
better than missing shadow data — favor over-recording.

**Acceptance:** Every plan that fires produces a shadow fill; closed
shadow fills accumulate; a weekly `compareShadowVsReal` shows divergence
between shadow PnL and realized PnL.

---

### C2. OpenTelemetry into `instrumentedTools.ts`

**Module:** `src/infra/observability/otel.ts`
**Flag:** `GORDON_OTEL` (default off)
**Status:** Module + tests ship. `startSpan` / `withSpan` /
`getActiveTraceContext`, AsyncLocalStorage parent propagation, pluggable
backends, JSONL default.

**Wire point:** `src/infra/agents/instrumentedTools.ts` — the single
registration point that already wraps every tool with metrics + spill.

**What's needed:**
1. Inside the existing wrapper, replace or augment the metrics call with
   `withSpan(toolName, { toolName, threadId, args: redacted }, fn)`.
2. Span attributes: tool name, family (market/account/order/...), thread,
   permission verdict (auto_approve / prompt_user / ...), success boolean.
3. Add `recordError` on thrown exceptions.
4. (Optional) Add a span around each agent message turn in
   `orchestrator.ts` so tool spans nest under turn spans.

**Risk:** Low. Additive. JSONL backend writes to `~/.gordon/otel-traces.jsonl`
which can grow unbounded — same rotation concern as shadow fills.

**Acceptance:** With `GORDON_OTEL=1`, every tool call produces a span
record; nested calls share a traceId; one-line `jq` against the JSONL gives
latency histograms per tool.

---

### C3. `WipLimit` gate on plan acceptance

**Module:** `src/infra/safety/wipLimit.ts`
**Flag:** `GORDON_WIP_LIMIT_ENABLED` (default off). Per-symbol/strategy/global
caps via `GORDON_WIP_LIMIT_PER_SYMBOL` / `..._PER_STRATEGY` / `..._GLOBAL`.
**Status:** Module + tests ship. `gatePlan(input, limits)` pure check;
`createWipRegistry(limits)` for stateful tracking.

**Wire point:** `src/core/pipeline/autonomous-loop.ts` — at plan acceptance
(after risk classifier + before execution), gate on the WIP registry.

**What's needed:**
1. Instantiate one `WipRegistry` per autonomous-loop session.
2. On `plan_ready`: call `registry.gate(symbol, strategy)`. If
   `!allowed`, queue the plan (or drop) instead of executing.
3. On execution start: `registry.markActive(...)`.
4. On position close / plan cancel: `registry.markInactive(planId)`.
5. Surface registry state in `/wip-status` slash command (queued behind
   X, active by symbol/strategy).

**Risk:** Medium. Mis-tuned limits starve real signals. Default
`perSymbol=1` is sensible for spot trading, may be wrong for hedged
positions. Start with the flag off and `perSymbol=2` once enabled.

**Acceptance:** With flag on, a second `plan_ready` for an already-active
symbol queues instead of firing; `markInactive` after exit allows the
next queued plan to proceed.

---

## Diagnostics — already-shipped, deferred wiring

### D1. `/quality` slash command

**Module:** `src/infra/diagnostics/qualityDocument.ts`
**Flag:** `GORDON_QUALITY_DOC` (default off)
**Status:** Module + tests ship. `createQualitySnapshot`,
`recordQualitySnapshot`, `readQualitySnapshots`, `computeTrend`,
`computeTrendSeries`, `formatQualitySnapshot`.

**Wire point:** `src/app/slashCommands.ts`. Add `/quality` to score the
current state across Instructions/Tools/Environment/State/Feedback (0-2
each) with rationale per layer.

**What's needed:**
1. **Scoring inputs** — these come from doctor.ts probes plus heuristics:
   - Instructions: CLAUDE.md present + size + skill count
   - Tools: registered tool count + permission boundaries set
   - Environment: provider health checks (`checkProviderHealth`)
   - State: action-log entry count + memory wired + decision log presence
   - Feedback: riskClassifier active + doom-loop wired + termination layers flag
2. Build a `QualitySnapshotInput`, call `createQualitySnapshot`, persist
   via `recordQualitySnapshot`, render via `formatQualitySnapshot`.
3. Optionally render the trend if ≥2 snapshots exist using
   `computeTrendSeries`.

**Risk:** Low. Read-only command.
**Acceptance:** `/quality` outputs current 5-layer scores + total + weakest layers; second run shows delta from prior.

---

### D2. `runColdStartAudit` at setup-runtime

**Module:** `src/infra/diagnostics/coldStartAudit.ts`
**Flag:** `GORDON_COLD_START_AUDIT` (default off)
**Status:** Module + tests ship. `GORDON_DEFAULT_QUESTIONS` covers 5
canonical questions. `runColdStartAudit(questions)` returns
`{ visibility, gaps, questions }`.

**Wire point:** `src/app/setup/setup-runtime.ts` — after boot, before
first agent action. Same hook as `agentReadiness`.

**What's needed:**
1. Call `runColdStartAudit(GORDON_DEFAULT_QUESTIONS)`.
2. If `visibility < 0.8`, surface the gap list to the user with the
   missing source paths.
3. Record the audit payload via `recordStructuredObservation`.

**Risk:** Low. Diagnostic-only.
**Acceptance:** Each session start logs a visibility percentage; gaps surface specific missing files/patterns.

---

### D3. Boundary check as CI hook

**Module:** `src/infra/diagnostics/boundaries.ts`
**Flag:** `GORDON_BOUNDARY_CHECK` (default off; CI usage is direct)
**Status:** Module + tests ship. `GORDON_DEFAULT_RULES` covers
`core/`, `events/`, `tui/`, `indicators/` purity.

**Wire point:** New `scripts/check-boundaries.ts` invoked from CI.

**What's needed:**
1. Write `scripts/check-boundaries.ts` that imports `checkBoundaries` +
   `GORDON_DEFAULT_RULES`, runs against the repo, prints
   `formatBoundaryResult`, exits non-zero on violations.
2. Add to CI (`.github/workflows/...` if present) as a separate job from
   typecheck.

**Risk:** Low. CI failure is loud but non-destructive. Existing violations
should be inventoried before the first enforcement run — likely several
fixes needed before CI can be made strict.
**Acceptance:** `bun scripts/check-boundaries.ts` exits 0 on a clean tree, non-zero on a forbidden-edge violation; CI fails on PRs that introduce one.

---

## Quant research credibility — backtest hardening

Ported from the AI-Quant article (https://github.com/zostaff/ai-quant-researcher). Most of the article's stack (PSR, DSR, CPCV, walk-forward, performance metrics, kill-switch) was already in Gordon — see `src/infra/trading/ops/backtestCredibility.ts` (363 LOC), `src/backtest/analysis/walk-forward.ts` (646 LOC), `src/backtest/metrics.ts` (771 LOC), `src/backtest/engine.ts` (1107 LOC), `src/core/safety/emergency-liquidation.ts`, `src/gateway/circuit-breakers/`. These four are the gaps that did not already exist.

### Q1. `featurePipeline.ts` — leakage-proof feature builder ✅ wired

**Module:** `src/backtest/features/featurePipeline.ts`
**Flag:** none — the pipeline is just a primitive; use or don't
**Status:** Module + tests ship. Pure-TS, generic over row type.

**Wired:** Exported from `src/backtest/index.ts` via `src/backtest/features/index.ts` barrel. Callers can `import { FeaturePipeline, momentum, realizedVol, zscore, range } from "src/backtest"`. Built-ins available; signal-recipe migration in `src/core/strategies/recipes/` is the next mile.

**Risk:** Low. Pure compute, no I/O.
**Acceptance reached:** Module is now part of the public backtest API surface; one or more recipes can be migrated without touching the import path.

### Q2. `strategyCodeValidator.ts` — anti-pattern scanner for LLM-generated strategy code ✅ wired

**Module:** `src/infra/trading/ops/strategyCodeValidator.ts`
**Flag:** `GORDON_STRATEGY_CODE_VALIDATOR` (default off)
**Status:** Module + tests ship. Regex-based scanner with 10 default rules covering 6 leakage families (centered windows, missing shift, full-sample normalization, survivorship, restated fundamentals, future references). Block vs warn severity.

**Wired:** Note that the original wire-point assumption (`strategySandbox.ts`) was wrong — that's a virtual-portfolio sandbox, not an LLM-code execution sandbox. The real wire is in `src/infra/agents/strategy-generator.ts`'s iteration loop. After each `validateStrategyDSL` success, the loop calls `validateStrategyCode(JSON.stringify(strategy))` and logs anti-pattern hits at warn level. The DSL schema is the primary gate; the validator is defense-in-depth against expression strings inside DSL fields.

**Risk:** Low. Lexical scan, no execution. Currently warn-only — does not block the loop.
**Acceptance reached:** When `GORDON_STRATEGY_CODE_VALIDATOR=1`, the iteration loop emits a warning if the DSL serialization contains anti-pattern strings.

### Q3. `marketImpact.ts` — realistic cost model + capacity sweep ✅ wired

**Module:** `src/backtest/analysis/marketImpact.ts`
**Flag:** none — module-level
**Status:** Module + tests ship. `realisticCostBps(...)` decomposes cost into half-spread + sqrt-impact + venue fee. `capacitySweep(...)` sweeps order size against ADV and returns the largest size where net Sharpe stays above a threshold.

**Wired:** Exported from `src/backtest/index.ts`. `GenerationOptions` in `strategy-generator.ts` now accepts an optional `adv` field (and optional `turnoverPerDay`); when supplied, the iteration loop computes a capacity sweep and logs the capacity-at-min-Sharpe alongside the backtest. Dormant when ADV is not provided.

**Risk:** Low. Pure compute. Surfaces optional information; never blocks.
**Acceptance reached:** Strategy generation with `adv` set produces a "capacity sweep" log entry showing the order size beyond which the strategy stops working.

### Q4. `multipleTestingTracker.ts` — DSR with dynamic trial-count bar ✅ wired

**Module:** `src/infra/trading/ops/multipleTestingTracker.ts`
**Flag:** `GORDON_MULTIPLE_TESTING_TRACKER` (default off)
**Status:** Module + tests ship. JSONL persistence at `~/.gordon/strategy-attempts.jsonl`. `recordAttempt`, `readAttempts`, `countTrials` (distinct codeHashes per family), `dynamicDeflatedThreshold` extends the per-strategy DSR in `backtestCredibility.ts` to a per-portfolio-of-attempts test.

**Wired:** `src/infra/agents/strategy-generator.ts`'s iteration loop now calls `recordAttempt` after each backtest (family = `${intent.style}/${options.symbol}`, codeHash = stable hash of the DSL JSON) and runs `dynamicDeflatedThreshold` alongside the existing static threshold check. Both `staticPasses` and `dynamicPasses` are logged on every iteration; the loop still uses the static threshold for accept/reject so this is observation-only. Promotion to enforcement is a separate later decision.

**Risk:** Low at this wiring stage (observation only). Becomes medium if promoted to a hard gate — strategies that pass static DSR at attempt #1 may fail dynamic DSR at attempt #1000, which is the point.
**Acceptance reached:** When `GORDON_MULTIPLE_TESTING_TRACKER=1`, each backtest iteration writes an attempt to `~/.gordon/strategy-attempts.jsonl` and the log shows both static and dynamic verdicts side-by-side, so the operator can see when they diverge before flipping the dynamic threshold to be load-bearing.

---

## Goal mode — `/goal` pattern

Trading-domain port of the `/goal` slash command Codex, Claude Code, and Hermes have all shipped in 2026. The user supplies one line — `/goal <work> until <measurable end state> without <constraints>` — and an autonomous loop runs toward the goal until met, paused, or failed.

### G1. `goalMode.ts` — parse, score, persist ✅ wired

**Module:** `src/core/pipeline/goalMode.ts`
**Flag:** `GORDON_GOAL_MODE` (default off)
**Status:** Module + tests ship. Pure functions for parsing (Sharpe / win rate / drawdown / trade count / time horizon / checklist / custom end states), scoring per iteration, lifecycle transitions (active / paused / achieved / failed / cleared), and persistence to `~/.gordon/goal-state.json` plus a human-readable `~/.gordon/goal-progress.md` log.

**Wires (all in place):**
1. **Slash command surface ✅.** `/goal`, `/goal-status`, `/pause-goal`, `/goal-clear` registered in `src/app/slash/slashCommands.ts` (added to DIRECT_MENU_TARGETS, plus four command descriptors next to `/autonomous`). Dispatcher routes the four targets to `handleGoalMenuCommand` in `src/tui/bridge/menuHandlers.ts`. Handler enforces the `GORDON_GOAL_MODE` flag and prevents setting a second goal while one is active.
2. **Autonomous-loop integration ✅.** `src/core/pipeline/autonomous-loop.ts` loads the active goal each cycle (when the flag is on), builds a `GoalObservation` from cycle data (`elapsedHours` from session age, `trades` from opportunities count this cycle, `constraintViolations` from mandate-breach check), scores it via `scoreGoal`, records via `recordGoalProgress`, appends to `goal-progress.md` via `appendProgressLog`, and persists state. If `isGoalComplete` after recording, the loop stops itself. Failures in goal-mode scoring are caught and logged at warn level so they never break the trading loop.
3. **TUI surface ✅.** Menu handler responds via `addMessage` directly into the chat surface (Gordon's standard TUI output channel). `formatGoalState` renders the human-readable summary inline. A dedicated status panel can read the same state file later if needed.

**Risk:** Low. Goal-mode does NOT bypass termination layers, risk classifier, or permission engine — those remain authoritative for trade safety. Goal mode is observation-only at the loop level (it scores what it can observe, can stop the loop on completion, but does NOT influence trade decisions).

**Acceptance reached:** With `GORDON_GOAL_MODE=1`, typing `/goal trade ETH until for 7 days without mandate breach` sets a goal that the autonomous loop scores each cycle. Progress accumulates in `~/.gordon/goal-progress.md`. When the time horizon is reached the loop stops itself. Sharpe/win-rate/drawdown goals currently score as "not observed this cycle" — wiring a richer GoalObservation from portfolio state is a separate follow-up.

---

## Harness evolution (inner-loop primitive)

Trading-domain port of Algorithm 1 from Seong/Yin/Zhang/Shi — "The Last Harness You'll Ever Build" (arXiv 2604.21003v3). The paper proposes a two-level framework; this section captures the **inner loop only**. The meta-loop is parked (see P3).

### H1. `harnessEvolution.ts` — inner-loop primitive

**Module:** `src/infra/agents/harness-evolution/harnessEvolution.ts`
**Flag:** `GORDON_HARNESS_EVOLUTION` (default off)
**Status:** Module + tests ship. Pure-functional `runHarnessEvolutionLoop(initialHarness, hooks, task, opts)` with caller-supplied `BlueprintHooks` (`execute` / `evaluate` / `evolve`). Five-subsystem `HarnessConfig` mirrors Gordon's CLAUDE.md framing (instructions / tools / environment / state / feedback). Convergence on `passed=true` + optional `targetScore`; early-stop on `patience`; full iteration history persisted as JSONL at `~/.gordon/harness-evolution.jsonl`.

**Wire points (all deferred):**
1. **Hook implementations.** Build three Gordon-native hooks: (a) `execute` runs the executor agent with the harness's prompts + tool whitelist + env flags; (b) `evaluate` calls `critiquePhase.ts` + `planRubric.ts` for score + diagnostics + `terminationLayers.ts` for pass/fail; (c) `evolve` calls the ACE Reflector→Curator (`src/infra/agents/ace/`) to propose harness mutations from history.
2. **Slash command** `/evolve <task>` — entry point that runs the loop with Gordon's default hooks.
3. **Action-log integration.** Emit `resultToPayload` per loop completion + per-iteration records.

**Risk:** Module-level zero — pure compute with caller-supplied hooks. At wire time: medium because evolved harnesses can change prompts/tools/flags, and the loop will explore configurations the operator never authorised. Mitigation: evolved harnesses still go through Gordon's safety stack (riskClassifier / terminationLayers / permissionEngine) at execution time. The loop optimises the *config*, not the *execution permission*.

**Acceptance reached at module level:** 31 tests cover convergence, max-iterations, patience, best-tracking, error capture, persistence, input isolation, and callback hooks. Loop never throws; all hook errors are captured into the history record with `terminationReason="error"`.

---

## Anthropic effective-harnesses port (trading-domain)

Ported from Anthropic's "Effective harnesses for long-running agents" (2026). The article shipped a Claude.ai clone at 200-feature scale; we mirror the shape of the primitives that don't already exist in Gordon and adapt them to trading.

### A1. `tradingFeatureList.ts` — JSON contract with `passes: bool` and edit-only-passes enforcement ✅ wired

**Module:** `src/infra/trading/ops/tradingFeatureList.ts`
**Flag:** `GORDON_TRADING_FEATURE_LIST` (default off)
**Status:** Module + tests ship. JSON schema mirrors Anthropic: `{ id, category, description, steps[], priority, passes, paperModeVerifiedAt, failedAt, failedReason }`. Categories tuned for trading: `venue | analysis | execution | risk | monitoring | operational`. The `applyEdit` function rejects any diff that mutates a non-mutable field (only `passes` + the three timestamp/reason fields can change). Adds and removes are also rejected.

**Wire points (deferred):** load the list at autonomous-loop start; call `pickHighestPriority` to choose the next capability to work on; flip `passes` via `markPass` after paper-mode verification. Slash command `/features` for inspection.

### A2. `initializerAgent.ts` — one-shot first-session marker state machine ✅ wired

**Module:** `src/infra/agents/initializerAgent.ts`
**Flag:** `GORDON_INITIALIZER_AGENT` (default off)
**Status:** Module + tests ship. Marker file at `~/.gordon/initialized.json` with `{ initializedAt, version, configHash, artifactsWritten }`. `runInitializer(payload)` is a no-op on subsequent calls unless `force=true`. Module is the state machine only — caller writes the actual artifacts (sprint contract, mandate, feature list) before calling.

**Wire points (deferred):** call `isInitialized()` at session start; if false, run a one-shot initializer routine (caller-defined) that produces an initial sprint contract / mandate / trading feature list, then `runInitializer(payload)`. Subsequent sessions skip the routine entirely.

### A3. `initProbe.ts` — E2E boot probes that exercise Gordon's runtime ✅ wired

**Module:** `src/infra/diagnostics/initProbe.ts`
**Flag:** `GORDON_INIT_PROBE` (default off)
**Status:** Module + tests ship. Goes deeper than `agentReadiness.ts` (B2): readiness checks that components exist; init-probe runs them end-to-end. `runInitProbes(probes, opts)` is caller-supplied — the primitive orchestrates, captures per-probe timing + errors, aggregates verdicts + red-pen fix instructions. Supports `failFast` and per-id skip.

**Wire points (deferred):** in `setup-runtime.ts`, define a default probe set (venue connectivity, permission-engine boot, riskClassifier verdict on synthetic plan, terminationLayers verdict on synthetic inputs, safety-file writability, kill-switch dry-fire) and call `runInitProbes` before the first agent action. Fail closed.

### A4. `safetyConfigGuard.ts` — "unacceptable to weaken safety" enforcement ✅ wired

**Module:** `src/infra/safety/safetyConfigGuard.ts`
**Flag:** `GORDON_SAFETY_CONFIG_GUARD` (default off)
**Status:** Module + tests ship. Validates a current `SafetyConfig` against a baseline. Blocks on: deny-list shrinkage, maxPositionUsd raised, maxLeverage raised, dailyLossLimitPct raised, killSwitch disabled, allowedSymbols expanded. `GORDON_DEFAULT_BASELINE` mirrors the deny-list from CLAUDE.md + the trading-constitution defaults. `validateDiff(prev, next)` for in-flight modification gating.

**Wire points (deferred):** call `validateAgainstBaseline` at session start (after `agentReadiness`); call `validateDiff` before persisting any config mutation proposed by the agent. Block on any `severity: "block"` violation.

---

## Anthropic harness-design port (GAN evaluator pattern)

Ported from Anthropic's "Harness Design for Long-Running Application Development" (2026). Coding-specific bits (Playwright self-verification, the three-agent full-stack architecture) deliberately skipped — Gordon's trading domain doesn't render UIs. The four primitives below are the trading-applicable ones.

### V1. `adversarialEvaluator.ts` — combat self-evaluation bias ✅ wired (critiquePhase)

**Module:** `src/infra/agents/cognition/adversarialEvaluator.ts`
**Flag:** `GORDON_ADVERSARIAL_EVALUATOR`
**Status:** Module + tests ship. `buildAdversarialPrompt` wraps an existing evaluator prompt with the "assume broken until proven otherwise" framing Anthropic uses. `acceptIfAdversarial` is the gate — a `passed: true` verdict is only honoured when the review identifies ≥3 failure modes across ≥2 categories AND (for failed verdicts) has at least one finding at the required severity. A passing review that found zero issues is rejected as "insufficiently adversarial."

**Wire points (deferred):** integrate into `critiquePhase.ts` so the HIGH-thinking critique pass runs through the gate; integrate into `planRubric` consumers so passing-rubric verdicts must also clear the adversarial threshold.

### V2. `evaluatorCalibration.ts` — few-shot anchoring to reduce score drift

**Module:** `src/infra/agents/cognition/evaluatorCalibration.ts`
**Flag:** `GORDON_EVALUATOR_CALIBRATION`
**Status:** Module + tests ship. JSONL persistence at `~/.gordon/evaluator-calibration.jsonl`. `registerCalibrationExample` adds a gold-standard input → expected-score example. `selectRelevantExamples` picks top-K by tag overlap (+2) + keyword match (+1), with recency as tiebreaker. `buildCalibrationBlock` formats few-shot examples for splicing into evaluator system prompts. `detectDrift` compares the evaluator's actual score on a known input against the gold answer per-dimension.

**Wire points (deferred):** plug `buildCalibrationBlock` into the evaluator-prompt builders in `critiquePhase.ts` and `planRubric.ts`; run `detectDrift` periodically against the calibration set to detect when prompt or model changes have shifted scoring.

### V3. `contextAnxietyDetector.ts` — premature wrap-up detection

**Module:** `src/infra/agents/harness/contextAnxietyDetector.ts`
**Flag:** `GORDON_CONTEXT_ANXIETY_DETECTOR`
**Status:** Module + tests ship. Four heuristic signals: wrap-up phrases ("to summarize", "in conclusion", "wrapping up") mid-task, context self-references ("running low on context", "to save tokens"), sharp output-length drop relative to baseline, tool-call density drop. Aggregate anxiety score with breadth bonus when multiple signal types fire. Recommendation routing: self-ref → force clean context; wrap-up → interrupt before summary settles.

**Wire points (deferred):** call `detectAnxiety(recentTurns)` in `orchestrator.ts` per turn; on `isAnxious=true` either (a) inject a "you have plenty of context" assertion + continue, or (b) signal the operator. Pair with `runtimeHarness.ts`'s doom-loop detector since both monitor the same agent stream.

### V4. `sprintContractNegotiation.ts` — agent-negotiated contracts (extends T1)

**Module:** `src/infra/safety/sprintContractNegotiation.ts`
**Flag:** `GORDON_SPRINT_CONTRACT_NEGOTIATION`
**Status:** Module + tests ship. Extends T1's operator-authored sprint contract with the Anthropic generator/evaluator negotiation step. `runNegotiation(hooks, intent, opts)` runs propose → review → revise rounds; terminates on `accept`, `reject`, or `maxRounds` exhaustion. Caller-supplied Proposer + Reviewer hooks (same posture as `harnessEvolution`). The accepted draft is the input to existing `createSprintContract` — this module does not duplicate persistence.

**Wire points (deferred):** invoke before `createSprintContract` when an operator wants the contract drafted by an agent rather than typed by hand. The Proposer hook wraps an executor-style agent; the Reviewer hook wraps a researcher-style or critique-style agent.

---

## Durable execution + back-pressure (Inngest + HumanLayer ports)

### R1. `durableStep.ts` — checkpoint-and-replay ✅ wired (barrel + export)

**Module:** `src/infra/agents/runtime/durableStep.ts`
**Flag:** `GORDON_DURABLE_STEP`
**Status:** Module + tests ship. `executeStep({ stepId, input, fn })` persists input hash + result to `~/.gordon/durable-steps.jsonl` keyed by stable `stepId`. On replay (same `stepId` + same `inputHash`), returns the cached result without re-executing `fn`. Input-hash mismatch is treated as a *new* step (cache miss). Failed steps are NOT replayed from cache — re-executes so transient failures can recover. Includes in-flight dedupe via in-memory promise registry (closest Gordon gets to Inngest's singleton concurrency without a separate primitive).

**Wired:** Exported via `src/infra/agents/runtime/index.ts` barrel — callers do `import { executeStep } from "src/infra/agents/runtime"`. The autonomous-loop cycle is NOT wrapped because cycles have side effects (scan + emit + record) that don't roundtrip cleanly through cache-and-replay. Honest wire surfaces (deferred to callers): historical data fetches in `src/backtest/data/historical.ts`, backtest runs in `src/backtest/engine.ts`, risk classifier on a synthetic plan in `src/infra/trading/riskClassifier.ts`, news sentiment classification — all deterministic given input. Wrap each with `executeStep({ stepId: stableHash(input), input, fn })` for crash-recovery + repeated-call dedupe.

### R2. `errorOnlyOutputFilter.ts` — surface only errors ✅ wired

**Module:** `src/infra/agents/runtime/errorOnlyOutputFilter.ts`
**Flag:** `GORDON_ERROR_ONLY_FILTER`
**Status:** Module + tests ship. Line-level success/error classification with priority-resolved rules. `DEFAULT_ERROR_PATTERNS` covers `Error|FAIL|Exception` keywords, broker-reject vocabulary (`reject|denied|insufficient|timeout`), failure glyphs (✗/❌), stack-trace frames, and exception class names. Suppress rules for `passed|OK|✓` + test-summary `N passing`. `contextBefore` / `contextAfter` keep N lines of context around each surfaced line so "what was being attempted?" survives. `maxLines` cap prevents runaway error logs from re-flooding context. `filterOutputForAgent` collapses all-success runs to a single OK line.

**Wired:** `src/infra/agents/harness/runtimeHarness.ts:optimizeToolResultForContext` now runs `filterOutputForAgent` before the byte-limit check when (a) `GORDON_ERROR_ONLY_FILTER=1` and (b) the tool name is in a conservative allow-list (`run_test`, `run_verification`, `run_typecheck`, `run_lint`, `reconcile_position`, `reconcile_orders`, `validate_strategy`, `verify_plan`, `check_balances`). Market-data and strategy tools are NOT filtered — the agent needs the full signal there. Filter uses `contextBefore=2, contextAfter=1` so error messages keep their "what was being attempted?" context. Filter failures fall through to raw result — they cannot break the tool-result path.

---

## Anthropic multi-agent research-system port

Ported from Anthropic's "How we built our multi-agent research system" (2026). Two trading-applicable patterns; the rest of the article validates Gordon's existing architecture (orchestrator-worker, parallel subagents, memory persistence, structured task descriptions).

### MA1. `citationAgent.ts` — evidence-trail manifest for recommendations ✅ wired (plan_ready hook)

**Module:** `src/infra/agents/cognition/citationAgent.ts`
**Flag:** `GORDON_CITATION_AGENT`
**Status:** Module + tests ship. Exposed via `src/infra/agents/cognition/index.ts` barrel. `buildCitationManifest({ recommendationId, claims, evidence })` links each claim string to ranked tool-call evidence via ticker / indicator / numeric / token overlap. `detectUnsupportedClaims` surfaces claims with zero evidence — the "agent made this up" cases. Persistence at `~/.gordon/citation-manifests.jsonl`.

**Honest wire surface (deferred to callers):** the planner/executor at the point of plan finalization. The caller has the recent tool-call list in structured form (action log entries with toolName + observations); wrap `buildCitationManifest` around that. Not auto-wired because Gordon's action-log → citation-evidence bridge is its own focused PR (translate JSONL action-log entries into `EvidenceRef`s).

### MA2. `effortCalibration.ts` — calibrate effort to query complexity ✅ wired

**Module:** `src/infra/agents/cognition/effortCalibration.ts`
**Flag:** `GORDON_EFFORT_CALIBRATION`
**Status:** Module + tests ship. `classifyComplexity(hints)` maps task signals (task text, fanout, isRouting, isLiveExecution, isMultiStep) to `trivial | normal | deep`. `budgetFor(level)` returns token/subagent-fanout/tool-call/reasoning-depth budgets. `buildCalibrationBlock(level, taskType?)` formats a prompt block ready to splice. Anthropic's fix for "agent spawned 50 subagents for trivial query" — trivial budget is 0 subagent fanout, deep is up to 5 (capped well below 50).

**Wired:** `src/infra/agents/prompt-sections/shared.ts` now includes a `shared.effort-calibration` section (priority 35) that emits `buildCalibrationBlock("normal")` when `GORDON_EFFORT_CALIBRATION=1`. Every agent that consumes shared prompt sections sees the calibration block by default. Per-task overrides (call `buildCalibrationBlock("deep")` when classifying a live-execution task as deep) are caller-driven.

---

## Sandbox + tool hygiene (Anthropic sandboxing + OpenHands + Anthropic tool-design ports)

### S1. `networkAllowlist.ts` — outbound domain allowlist ✅ wired (doctor surface)

**Module:** `src/infra/safety/networkAllowlist.ts`
**Flag:** `GORDON_NETWORK_ALLOWLIST`. Mode env: `GORDON_NETWORK_ALLOWLIST_MODE` = `warn | block` (default `warn`).
**Status:** Module + tests ship. `checkOutbound({ url, caller })` returns `{ allowed, host, matchedRule, reason, mode }`. `enforceOutbound` throws `BlockedOutboundError` in block mode. `GORDON_DEFAULT_ALLOWLIST` covers Gordon's canonical hosts (LLM providers, crypto exchanges, equity brokers, on-chain RPCs, observability backends, localhost). `addAllowedHost` for runtime extension.

**Wired:** doctor report surfaces `sandbox.network_allowlist` info-check when the flag is on, showing mode + host count. Per-tool enforcement is caller-driven — wrap HTTP-client calls with `enforceOutbound({ url, caller: toolName })`. Auto-wiring into Gordon's HTTP clients is a separate hot-path PR.

### S2. `filesystemWriteGuard.ts` — path-write allowlist ✅ wired (doctor surface)

**Module:** `src/infra/safety/filesystemWriteGuard.ts`
**Flag:** `GORDON_FILESYSTEM_WRITE_GUARD`. Mode env: `GORDON_FILESYSTEM_WRITE_GUARD_MODE` = `warn | block`.
**Status:** Module + tests ship. Defaults allow `~/.gordon/*`, `/tmp/gordon-*`, and the current working directory (mirroring Claude Code's cwd rule). `checkWrite({ path, caller })` + `enforceWrite` for block mode + `BlockedWriteError`. `addAllowedPath` for runtime extension.

**Wired:** doctor report surfaces `sandbox.filesystem_write_guard` when the flag is on, showing mode + allowed-path count. Per-write enforcement is caller-driven — wrap `writeFile` / `appendFile` calls with `enforceWrite({ path, caller })`.

### S3. `toolDesignLinter.ts` — static analysis on the tool registry ✅ wired (importable)

**Module:** `src/infra/diagnostics/toolDesignLinter.ts`
**Flag:** `GORDON_TOOL_DESIGN_LINTER`
**Status:** Module + tests ship. Rules encode Anthropic's "Writing Tools for Agents" anti-patterns: namespacing (no shared prefix), generic params (`id`/`user`/`data`), description-length minimum (≥20 chars), missing `response_format` enum on large-output tools, low-level identifier exposure (`uuid`/`mime_type`). `lintTool` for single, `lintToolRegistry` for batch.

**Wire surface (caller-driven):** import `lintToolRegistry` from `src/infra/diagnostics/toolDesignLinter`, feed it Gordon's actual `ToolDescriptor[]` (extracted from Mastra tool defs), surface findings in a `/lint-tools` slash command or CI script. Auto-extraction of Gordon's tool registry into `ToolDescriptor` form is its own focused PR.

---

## Context engineering port (Manus + HumanLayer + Anthropic context articles)

Four primitives ported from the seven-article batch on context engineering. The rest validated Gordon's existing architecture (compaction, sub-agents, file-as-memory, append-only) or are pure-philosophy pieces (Fowler "Context Engineering for Coding Agents").

### C1. `kvCacheHitMetric.ts` — measure the 10x lever ✅ wired (doctor surface)

**Module:** `src/infra/agents/runtime/kvCacheHitMetric.ts`. Flag `GORDON_KV_CACHE_METRIC`.
**Status:** Module + tests ship. `recordCacheCall` appends one record per LLM call to `~/.gordon/kv-cache-metrics.jsonl`. `summarizeHitRate` computes hit rate + cached-token ratio + estimated USD savings (using the Manus anchor: cached tokens cost 1/10 of uncached, so each cached token saves 90% of the uncached price). Doctor surface in `harness-checks.ts:collectKvCacheCheck` reports hit rate over last 100 calls when the flag is on. **Per-call recording is caller-driven** — wrap LLM-client calls and record (hit, cachedTokens, totalInputTokens) on response. Auto-wiring into `sharedPrefixCache.ts` is a focused follow-up PR.

### C2. `silentToolResultFormatter.ts` — `run_silent`-style ✓/✗ formatting ✅ wired (barrel)

**Module:** `src/infra/agents/runtime/silentToolResultFormatter.ts`. Flag `GORDON_SILENT_TOOL_FORMATTER`.
**Status:** Module + tests ship via the runtime barrel (`src/infra/agents/runtime/index.ts`). `formatSilent({ description, output, exitCode })` collapses success to `✓ description` and shows full output on failure. `formatSilentPipeline` chains multiple steps. Extends R2's filter posture for the specific case where a tool produces exit-code + output. Trading-domain wire: verification scripts, paper-mode runs, reconciliation reports. Caller-driven invocation.

### C3. `claudeMdLinter.ts` — static analysis on agent-instruction markdown ✅ wired (doctor surface)

**Module:** `src/infra/diagnostics/claudeMdLinter.ts`. Flag `GORDON_CLAUDE_MD_LINTER`.
**Status:** Module + tests ship. Rules encode HumanLayer's "Writing a Good CLAUDE.md" guidance: line count (warn >300, error >500), estimated instruction count (warn >200), code-style guidance in prompt (warn — "never send an LLM to do a linter's job"), exhaustive command lists (info), large code snippets (info). Doctor surface lints `CLAUDE.md` and `AGENTS.md` at the repo root when the flag is on; findings surface as `claude_md_lint.*` checks.

### C4. `recitationCheckpoint.ts` — combat lost-in-the-middle on long runs ✅ wired (barrel + cadence helper)

**Module:** `src/infra/agents/harness/recitationCheckpoint.ts`. Flag `GORDON_RECITATION_CHECKPOINT`.
**Status:** Module + tests ship. `shouldRecite({ currentTurn, currentToolCalls, state })` gates by cadence (default every 8 turns OR every 20 tool calls). `markRecited` returns the updated state. `buildRecitationBlock({ goal, progressLines, blockers, checklist })` formats a `todo.md`-style reminder Manus uses to push active state to the end of context. Wire surface: in the autonomous-loop cycle, when goal-mode is active and the cadence threshold is hit, append the recitation block to the agent's next prompt and `markRecited` the state. Caller-driven because goal-mode state lives in a separate module.

---

## 12-Factor Agents port

The "12 Factor Agents" article (HumanLayer, 2026) maps 7 of 12 factors directly to Gordon's existing architecture. Of the remaining 5, only F7 yields a self-contained primitive worth building; F3/F11/F12 are refactors or product features, not harness primitives.

### F7. `humanInputTool.ts` — agent asks operator content questions ✅ wired (slash commands)

**Module:** `src/infra/agents/runtime/humanInputTool.ts`
**Flag:** `GORDON_HUMAN_INPUT_TOOL`
**Status:** Module + tests ship. Distinct from `PermissionEngine` (safety gates) — this asks *content* questions: "close ETH or hold?", "two strategies tied on backtest — pick one", "this trade hits mandate edge — confirm?". `createRequest` opens a pending question; `waitForAnswer` returns a Promise that resolves on operator answer (with optional timeout). Survives session boundary via JSONL at `~/.gordon/human-input-requests.jsonl` — a question opened in session A can be answered in session B.

**Wired:**
- Slash commands `/pending` (list open questions) and `/answer <request-id> <text>` (resolve a question) in `slashCommands.ts`.
- New `handleHumanInputMenuCommand` in `menuHandlers.ts` routed via `runtime.ts` dispatcher.
- `GORDON_HUMAN_INPUT_TOOL` flag enforcement at the handler boundary.
- Wire to agent-side (registering as a Mastra tool the agent can call) is deferred — that's a focused PR that touches the tool registry.

---

## Hook extensibility (dabit3/agent-hooks-in-depth port)

Three additions from the dabit3 hook patterns. The seven example hooks in the demo repo (protect-paths, quality-gate, stop-if-quality-failed, command-policy, session-context, session-end-audit, prompt-router) all map to existing Gordon primitives under different names. The genuinely new contributions are at the lifecycle / runner layer.

### H1. `UserPromptSubmit` hook type ✅ added

**File:** `src/infra/hooks/types.ts`
**Status:** Type added to `HookPoint` union; `UserPromptSubmitPayload` interface defined (prompt text, threadId, sessionId, submittedAt, source); registered in `HookPayloadMap`. Use cases for trading: inject portfolio context into routing decisions before the model sees the prompt; block known-bad inputs at the boundary; pre-process slash-command-style inputs with mandate scope.

### H2. `SessionEnd` hook type ✅ added

**File:** `src/infra/hooks/types.ts`
**Status:** Type added to `HookPoint` union; `SessionEndPayload` interface defined (sessionId, threadId, reason, endedAt, turnCount, toolCallCount, summary); registered in `HookPayloadMap`. Use cases for trading: flush daily PnL summary, emit OTel session-end span, archive session-handoff.

**Engine dispatch wire (deferred):** the hook engine's emit path needs to fire these two new events at the right runtime moments. Type-level integration is complete; emission sites are in `runtime/session/SessionRuntime` (UserPromptSubmit on user-input dispatch) and `gracefulShutdown.ts` (SessionEnd). Both are focused follow-up PRs.

### H3. `externalHookRunner.ts` — invoke shell scripts at lifecycle points ✅ wired (importable primitive)

**Module:** `src/infra/hooks/externalHookRunner.ts`
**Flag:** `GORDON_EXTERNAL_HOOK_RUNNER`
**Status:** Module + tests ship. `runExternalHook(config, payload)` spawns an external command handler, writes the JSON payload to stdin, captures exit code + stderr + stdout, and produces a structured `HookResult`. Wire-protocol (matches dabit3): exit 0 → allow, exit 2 → block with stderr as reason, any other non-zero → block (fail-closed), valid JSON on stdout → parsed `HookResult` overrides the exit-code decision. Timeout-as-block defaults 5s. Supports args + env-var passthrough.

**Wired:** Importable from `src/infra/hooks/externalHookRunner`. Hook engine integration is the natural next step — extend `HookDefinition` to support an external-script flavor that delegates to `runExternalHook`. Right now operators with custom policy needs (e.g. "block all orders within 2h of a CPI release") can call this primitive directly from a `HookHandler` they register.

**Trading scenarios covered in test:**
- Pre-order CPI-release check — operator wires a shell script that reads `CPI_TODAY` env var and blocks orders when set
- Modify-action support — handler returns `{"action":"modify","replacement":{"qty":0.05}}` to scale down quantity
- Metadata propagation — handler returns `{"action":"allow","metadata":{"reviewedBy":"compliance"}}` for audit trail

---

## TraderMorin workflow port — remaining gaps

Three primitives from the trader's 5-step workflow shipped in commit `261c1592`. The wires + skipped items are tracked here.

### TM1. `confluenceScorer.ts` ✅ shipped, ⚠ not invoked

**Module:** `src/infra/trading/ops/confluenceScorer.ts`. Flag `GORDON_CONFLUENCE_SCORER`.
**Status:** Primitive + tests + composability with adversarialEvaluator. **No call site yet** — currently nothing in Gordon invokes `scoreConfluences` on a generated plan and feeds the tier into risk sizing. Wire point: in `planner.ts` (or wherever plans get finalized into `strategy:plan_ready` events), enumerate the active confluences for the symbol (divergence detector + regime fit + key-level proximity + EMA alignment), build `ConfluenceObservation[]`, call `scoreConfluences`, multiply base risk by `riskMultiplier`, attach tier to the emitted plan. ~1 week of focused work, all in the planner path.

### TM2. `executionPlaybook.ts` ✅ shipped, ⚠ not invoked

**Module:** `src/infra/trading/ops/executionPlaybook.ts`. Flag `GORDON_EXECUTION_PLAYBOOK`.
**Status:** Primitive + 5 built-in playbooks + tests. **No call site yet** — Gordon's executor today is single-shot at the broker layer. Wire points (in priority order):
1. Plan field: extend `PlanReadyEvent` with optional `executionPlaybookId: string`.
2. Planner picks a playbook based on the trading playbook (mean-reversion → `scaled-thirds`, breakout → `breakout-confirm`, etc.).
3. Executor consults `attachExecution` to resolve absolute prices, then schedules N broker orders instead of 1.
4. Position-management layer honors the exit ladder + stop rules.

Item 4 is the biggest sub-piece — Gordon doesn't currently have a position-management loop that adjusts stops or fires partial closes. Pair this with termination Layer 3 wiring (post-fill reconciliation), since both touch the same execution-state machine.

### TM3. `decisionLog` lifecycle stages ✅ field added, ⚠ no callers populate it

**Module:** `src/infra/agents/memory/decisionLog.ts`.
**Status:** Optional `stage: TradeLifecycleStage` added to `DecisionEntry`. `groupDecisionsByStage` + `formatStageReport` exist. **No existing `recordDecision` callsite populates `stage`** — all pre-this-PR decisions remain unstaged (which the report tolerates). Wire point: every existing/future `recordDecision` call gets a stage tag based on where in the trade lifecycle it fired. The natural mapping:
- Planner / risk-classifier verdicts → `"planning"`
- Order placement / cancel / scale-in decisions → `"execution"`
- Stop adjustments / partial closes / scale-out → `"management"`
- Final close + post-trade review → `"closure"`

~2-3 hours of grep-and-tag work across existing callsites. Low risk.

### Items deliberately skipped from the article

- **TPO / market-profile indicators (1E).** Niche, big indicator build, useful only to traders running market-profile theory. Revisit if a user explicitly asks.
- **Emotion journaling during trade lifecycle (5A).** `humanInputTool` (just wired) is the right substrate — Gordon could prompt mid-trade "how are you feeling about this?" — but turning it into a workflow assumes Gordon owns the human's full trading day, a product-shape decision not yet made.
- **Morning briefing assembly (1A + 1C + 1D combined).** UI/aggregation work. The components exist (regime detector, Finnhub econ, indicators); the gap is a daily-routine surface. Wait until there's a daily-summary product surface to assemble against.
- **Key-levels persistent watchlist (1D).** Overlaps with what indicators already compute; surfacing differently is mostly UX, not a missing primitive.
- **Position-sizing "Why?" enforcement field (3B).** The citation-manifest pipeline (wired at plan_ready) covers the spirit at the plan level. Per-field rationale enforcement would be overkill given that.
- **Pro-Trend / Counter-Trend explicit checklist (1A).** Already implicit in `regime` detector + plan rationale. No primitive needed; could be surfaced as a plan-card section.

---

## Mercury "batteries included" gaps

From the Mercury Agent piece (cosmicstack-labs, 2026) gap analysis. Gordon has the safety/governance batteries (more than Mercury describes) but is missing several generalist capability batteries. These remain for super-agent scope; trading-only operators can mostly skip.

### MB1. Generic `fetch_url` tool ❌ not built

Required for: news pulls beyond current sources, on-chain reads via arbitrary RPC, public-API access for trade-relevant data, bank-OAuth callbacks (when expanding scope). Should consult `networkAllowlist` (already shipped) before each call so the safety wire activates automatically. ~1 day to build. Defer until first concrete trading need arises (news ingest expansion is the likely trigger).

### MB2. Generic `schedule_task` primitive ❌ not built

Recurring user intents: "rebalance every Friday at close," "tax-loss-harvest review in November," "settle the AWS subscription on the 1st." Distinct from `autonomous-loop`'s mandate-driven schedule. A small primitive: `scheduleTask({ id, cron, taskPrompt, scope })` + a tick loop that fires queued tasks at their cron time. ~3 days. Defer until traders ask for non-mandate scheduling.

### MB3. Unified status / control surfaces ⚠ partial

`/status` (aggregating cycle + mandate + active goal + pending human-input + shadow verdicts + KV-cache hit rate), `/tasks` (open features + decisions + pending), `/budget` (with hard enforcement on `kvCacheHitMetric`, not just observability), `/progress` (autonomous-loop visibility). Mercury's argument: the data is already tracked, just not surfaced as one place. Slash commands exist for some (`/features`, `/goal-status`, `/pending`) but no consolidated overview. ~2-3 days.

### MB4. Budget enforcement (not just metric) ⚠ partial

`kvCacheHitMetric` (shipped) is observation-only. Add a hard daily-USD cap that triggers `auto-concise` behavior (force shorter responses + skip optional sub-agent calls) when threshold hit. Mercury enforces; Gordon currently observes. Same flag — promote to enforcement. ~2 days.

### MB5. Telegram / mobile surface ❌ not built — deferred hard

Multi-week build. CLI/TUI-only is fine for development; super-agent / wider-distribution mode needs mobile entry-point. Wait for traction signal first. The webhook trigger pattern (12-Factor F11) sets up the substrate when bandwidth permits.

### MB6. Aggressive default memory ❌ deliberate philosophical choice

Mercury auto-extracts and persists memory aggressively. Gordon's Hermes pattern (per CLAUDE.md memory note) keeps working memory minimal — semantic recall disabled by default; cold recall via model-decides `searchMemoryTool` / `getMemoryContextTool` / `getLessonsTool`. This is the "broad memory makes agents worse" finding from the Hermes ChatGPT-taxonomy survey. **Not a gap — a deliberate choice.** For super-agent scope, the cold layer gets more entries (positions + bills + subscriptions etc.) but the always-inject layer stays small.

---

## Remaining wires from the 5-wire batch (commit `1c8209ef`)

The 5 wires shipped earlier in this session were observation-only at the plan_ready hook. Each has a follow-up wire that completes the loop.

### W1. Shadow-mode close-side worker ⚠ open side wired, close side missing

`recordShadowOpen` fires on every `plan_ready` event. Without a close-side reconciliation worker, shadow fills accumulate forever as "open" — no hypothetical-PnL data ever materializes. Background worker polls current market price for open shadow fills, calls `recordShadowClose` when stop/target/timeout hit. ~3 days. **This is the most important follow-up of the entire shipped set** — without it, the most important company-level signal ("do Gordon's plans beat market in the alternate universe?") can't be computed.

### W2. Citation evidence enrichment (action-log → EvidenceRef adapter) ⚠ pipeline wired, no evidence

`buildCitationManifest` is called on every `plan_ready` event, but the `evidence: []` array is empty (we synthesize claims from plan fields, nothing else). The adapter that walks the recent action-log entries for the plan's symbol + time window and emits `EvidenceRef[]` is the missing piece. ~3 days. After it ships, every previously-recorded manifest is back-fillable.

### W3. Termination layers L2 + L3 ⚠ L1 wired in shadow, L2+L3 deferred

L1 (pre-trade) observation wired at plan_ready. L2 (runtime ack/reject) needs the broker-ack callback hook — fires when an order submission returns. L3 (system-confirmation) needs post-fill reconciliation data — fires after fill report arrives. Both touch Gordon's actual execution path, which today is leaner than a full broker-ack lifecycle. Pair with TM2 (executionPlaybook wiring) since both need the same execution-state machine.

### W4. Promotion of L1 from shadow to enforcing ⏳ data-blocked

After 1-2 weeks of paper-mode data, compare L1 verdicts against actual outcomes. If catch rate is high and false-positive rate is low, promote to enforcing (block trades when L1 fails). Pure config flip in `agent-subscriptions.ts` once the data justifies it.

### W5. Adversarial critique calibration ⏳ data-blocked

`adversarialEvaluator` is active in `critiquePhase` when flag is on. Compare critique-pass / critique-fail rate before vs after the adversarial flag flip. If the new framing catches more real issues, it stays default-on; if it just produces noise, it gets gated to high-stakes-only.

---

## Ryan Wright port (Wave 1 — survival math)

From Ryan Wright's *The Art and Business of Professional Trading* (Wiley 2026). Wave 1 ports four math/state primitives that fill genuine gaps in Gordon's sizing + survival surface. All cold behind flags, same pattern as confluenceScorer + executionPlaybook.

### WW1. `pathDependentSizer.ts` ✅ shipped, ✅ wired (shadow mode)

**Module:** `src/infra/trading/ops/pathDependentSizer.ts`. Flag `GORDON_PATH_DEPENDENT_SIZER`.
**Status:** Ch 9 Type I/II/III tier system + Ch 16 Protocol 5 sizing matrix. Anti-Martingale is structural via Type II variable component. Replicates Wright's WTI crude example end-to-end.
**Wire:** plan_ready observation handler in `agent-subscriptions.ts` reads `GORDON_INITIAL_RISK_CAPITAL_USD` + `GORDON_YTD_PNL_USD` + `GORDON_EQUITY_FRACTION_OF_PEAK` from env, computes performance state, calls `sizePosition` with tier="I" by default, logs sized result alongside plan. Currently shadow — promotion to enforcing requires (a) confluence-driven tier selection (pair with TM1) and (b) WW8 calibration gate to safely allow Type II/III.

### WW2. `absorbingBarrier.ts` ✅ shipped, ✅ wired (shadow mode)

**Module:** `src/infra/safety/absorbingBarrier.ts`. Flag `GORDON_ABSORBING_BARRIER`.
**Status:** Ch 13 three-barrier classifier (broker margin / prop-firm trailing / psychological tilt). Outputs distance in BOTH dollars and R-units with 5-tier alert level. `shouldBlockNewTrades` returns true at warn-or-worse.
**Wire:** plan_ready subscription in `agent-subscriptions.ts` calls `distanceToBarriers` alongside the existing L1 shadow verdict. Inputs read from env (`GORDON_CURRENT_EQUITY_USD`, `GORDON_EQUITY_HIGH_WATER_MARK_USD`, `GORDON_PROP_FIRM_TRAILING_DD_USD`, `GORDON_PSYCHOLOGICAL_TILT_USD`, `GORDON_BASE_R_PER_TRADE_USD`). Logs `wouldBlock` + nearest-barrier R-units. Currently observational — promotion to enforcing (pipe `shouldBlockNewTrades` directly into `checkPreTrade.mandateScopeOk`) is data-blocked, waiting for paper-mode runs to validate the calibration.

### WW3. `volatilityDrag.ts` ✅ shipped, ✅ wired

**Module:** `src/infra/trading/ops/volatilityDrag.ts`. Flag `GORDON_VOLATILITY_DRAG`.
**Status:** Ch 13 geometric-vs-arithmetic math: `R_geo = R_arith - σ²/2`, recovery-return table, leverage privilege gate (Sharpe ≥ 1.5 default), strategy comparison (surgeon-vs-gunslinger). Pure compute.
**Wire:** `formatBacktestSummary` in `reporting/formatter.ts` computes σ from per-trade returns and appends `Drag: arith 30% → geo 22% (σ=40%, drag 8%)` line when ≥10 trades AND flag on. Composes with Q4 multipleTestingTracker (DSR/PSR) on the same summary block, not duplicative. Leverage-privilege output not yet surfaced — defer until backtest summary needs the additional line.

### WW4. `frictionTracker.ts` ✅ shipped, ⚠ no producers yet

**Module:** `src/infra/trading/ops/frictionTracker.ts`. Flag `GORDON_FRICTION_TRACKER` + path `GORDON_FRICTION_TRACKER_PATH`. Persists to `~/.gordon/friction.jsonl`.
**Status:** Ch 6 + Ch 16 Protocol 3 three-component friction model (explicit / implicit / psychological). 9 kinds auto-classified to components. `auditFriction` produces verdict with Wright's 20%-of-gross fail threshold (warn at 10%). **No producers wired yet** — Gordon has `marketImpact.ts` (Q3) which models the implicit half theoretically but doesn't record realized slippage. Wire points: (a) order-execution path records `slippage` event with `planned_fill - actual_fill` after fill confirmation; (b) cancel/modify-stop tool records `moved_stop` event with diff; (c) executor records `hesitation` event when `order_send_time - signal_emit_time` > threshold. Monthly audit surface via slash command. ~1 week total across all three producers.

### WW5. `dailyDecisionJournal.ts` ✅ shipped, ✅ wired (auto-populated shadow mode)

**Module:** `src/infra/trading/ops/dailyDecisionJournal.ts`. Flag `GORDON_DECISION_JOURNAL` + path.
**Status:** Ch 16 Protocol 1 structured pre-trade form: Thesis + Math + 5-Q pre-mortem.
**Wire:** plan_ready handler auto-populates thesis from strategy/symbol/entry, math from `e.positionSizePct` + `GORDON_FREE_CAPITAL_USD`, pre-mortem all-false. Records JSONL with verdict. Promotion to operator-interactive (operator fills pre-mortem via slash command, gates order placement on go) is a UX surface decision deferred — current shape captures the discipline as a passive audit trail.

### WW6. `debriefMatrix.ts` ✅ shipped, ✅ wired (auto-debrief on position:closed)

**Module:** `src/infra/trading/ops/debriefMatrix.ts`. Flag `GORDON_DEBRIEF_MATRIX` + path.
**Status:** Ch 15 process-score × outcome-score 4-quadrant classifier + toxicAlphaAlarm.
**Wire:** new position:closed handler in `agent-subscriptions.ts` auto-scores process from close reason (plan-defined exit → 8, manual/liquidation → 4) and outcome from pnlPercent banded 1-9. Records JSONL debrief. Promotion to operator-interactive (operator overrides auto-scores via slash command) is the natural next UX surface. Toxic-alpha alarm surfacing to weekly review is deferred.

### WW7. `preExecKillList.ts` ✅ shipped, ✅ wired (shadow mode, env-driven)

**Module:** `src/infra/trading/ops/preExecKillList.ts`. Flag `GORDON_PRE_EXEC_KILL_LIST`.
**Status:** Ch 16 Protocol 6 five-question gate. Pure compute, no persistence by design.
**Wire:** plan_ready handler reads 5 env booleans (`GORDON_OPERATOR_BORED`, `GORDON_OPERATOR_ANGRY`, `GORDON_OPERATOR_RUSHING`, `GORDON_OPERATOR_MOVED_STOP`, `GORDON_OPERATOR_SCARED_MONEY`) and logs verdict + blockers. Currently shadow with env-driven inputs (operator self-reports via flags). Auto-inference for each boolean (idle detection, debriefMatrix streak feed, plan-to-send latency, stop-modification tracking, position-size-vs-tilt comparison) is the natural promotion path — each input source is independently buildable.

### WW8. `convictionCalibrationGate.ts` ✅ shipped, ✅ wired (shadow, reads decisionLog)

**Module:** `src/infra/trading/ops/convictionCalibrationGate.ts`. Flag `GORDON_CONVICTION_CALIBRATION`.
**Status:** Ch 9 mandate — flat 1R until 100+ trades show Pearson r ≥ 0.30.
**Wire:** plan_ready handler reads decisionLog JSONL, extracts (convictionRating, rMultiple) tuples from `context` field, calls `evaluateCalibration`, logs status + tradesSeen + pearsonR + allowsConvictionSizing. Currently shadow — promotion to enforcing means feeding `clampTierToCalibration` into WW1's tier selection. Producer for the source tuples (decisionLog entries with conviction + rMultiple in their context) is the next step.

### WW9. `operatorEquation.ts` ✅ shipped, ⚠ not invoked

**Module:** `src/infra/trading/ops/operatorEquation.ts`. Flag `GORDON_OPERATOR_EQUATION`.
**Status:** Ch 6 derived metric `Performance = (EV × Exposure) − Friction` with 5-class failure-mode diagnostic (edge_chaser / size_junkie / penny_pincher / underexposed / negative_after_friction). Pure compute.
**Wire point:** roll-up metric in eval harness reports + backtest summary. Caller assembles EV from backtest expectancy stats, exposure from sizer output, friction from frictionTracker audit. Useful when comparing two strategies side-by-side. ~2-3 days for backtest formatter integration once frictionTracker has producers.

### WW10. `weeklyRegimeCheck.ts` ✅ shipped, ⚠ not invoked

**Module:** `src/infra/trading/ops/weeklyRegimeCheck.ts`. Flag `GORDON_WEEKLY_REGIME_CHECK`.
**Status:** Ch 16 Protocol 4 translator: Gordon's 6-value regime enum × volatility level → Wright's 4-quadrant operator-facing classification (quiet_trend / volatile_trend / quiet_range / volatile_chop) with sizing multiplier and favored/avoided strategy families per quadrant.
**Wire point:** weekly cron tick that reads current regime from `regimeClassifier`, computes volatility level from VIX/ATR percentile, calls `evaluateRegimeCheck`, posts result to a regime-status surface (slash command `/regime` or a startup banner). Composes with WW1 sizer — `sizingMultiplier` feeds into the path-dependent sizer's final dollar-risk computation. ~3 days.

### WW11. `shannonsDemonRebalancer.ts` ✅ shipped, ⚠ not invoked

**Module:** `src/infra/trading/ops/shannonsDemonRebalancer.ts`. Flag `GORDON_SHANNONS_DEMON`.
**Status:** Ch 13 periodic rebalance-to-target primitive. Computes deltaUsd per allocation given current values + target weights. `simulateDoubleHalfPath` reproduces Wright's exact 12.5% example. Pure compute.
**Wire point:** specialty primitive — most useful for the user-managed portfolio surface (carry strategies, sideways crypto exposure with USD cash leg). Wire point: scheduled rebalance cron that reads positions from broker, computes trades, posts to operator for approval. No automatic execution — Wright explicitly says the demon dies if you cross an absorbing barrier mid-cycle, so pair with WW2 absorbingBarrier as a precondition gate. ~1 week including portfolio-state plumbing. Lower priority than WW1-WW10.

### Gap-fill batch (WW12–WW22) — wired in shadow mode

11 additional primitives surfaced from the full second-pass scan of Wright's book. All shipped behind flags. Wires landed via `agent-subscriptions.ts` plan_ready handler + `formatBacktestSummary` extension.

| WW | Module | Wired? | Wire surface |
|---|---|---|---|
| WW12 | `performanceDecomposition.ts` | ✅ | `formatBacktestSummary` — emits beta+factors+alpha breakdown when `GORDON_BENCHMARK_RETURN` + `GORDON_PORTFOLIO_BETA` env set |
| WW13 | `riskBundleAuditor.ts` | ✅ | plan_ready — auto-populates 8 categories, logs verdict |
| WW14 | `hurstExponent.ts` | ✅ | `formatBacktestSummary` — H + regime appended when ≥64 trades |
| WW15 | `marginalParticipantClassifier.ts` | ✅ | plan_ready — reads `GORDON_MARGINAL_DRIVERS` + `GORDON_VIX_ZSCORE` + `GORDON_CORRELATION_ZSCORE` env, logs typical/opportunity/uncertain verdict |
| WW16 | `edgeAttribution.ts` | ✅ | plan_ready — reads `GORDON_EDGE_TYPE`/`_COUNTERPARTY`/`_CONSTRAINT`/`_ARTICULATION` env, falls back to auto-articulation from plan fields |
| WW17 | `streakCircuitBreaker.ts` | ✅ | plan_ready — reads last 10 debriefMatrix entries (WW6) to derive win/loss/scratch sequence, logs state + would-block verdict |
| WW18 | `giveBackStop.ts` | ✅ | plan_ready — reads `GORDON_SESSION_START_EQUITY_USD` + `_SESSION_HWM_USD` + `_CURRENT_EQUITY_USD` env, logs session state |
| WW19 | `adverseSelectionDetector.ts` | ⚠ cold | Needs fill-event capture (order submit time + post-fill mid) outside current event taxonomy |
| WW20 | `correlationRegimeMonitor.ts` | ⚠ cold | Needs multi-symbol return matrix — no producer at plan_ready scope |
| WW21 | `liquidityMapper.ts` | ✅ | plan_ready — synthesizes structural levels from plan stop + take-profit ladder, logs nearest zones above/below |
| WW22 | `edgeDecayMonitor.ts` | ✅ | `formatBacktestSummary` — recent vs baseline expectancy verdict when ≥60 trades |

Plus WW9 `operatorEquation` wired into `formatBacktestSummary` (EV × Exposure − Friction line when flag on).

**Still cold (data-blocked, not Wright-port-scope):**
- WW4 frictionTracker producers — need executor instrumentation (planned-vs-actual fill capture, hesitation latency measurement, stop-modification hook)
- WW11 shannonsDemonRebalancer — needs portfolio-state plumbing
- WW19 adverseSelectionDetector — needs fill-event capture
- WW20 correlationRegimeMonitor — needs multi-symbol return matrix

All shadow-mode wires log verdicts; promotion to enforcing waits for paper-mode data validation per the same pattern as WW2/WW7/WW8.

### Closing-the-last-5% batch (WW23–WW25) — implicit primitives surfaced as modules

After full chapter scan, 3 implicit Wright primitives were called out as missing-as-separate-modules. Built + wired:

| WW | Module | Source | Wired? |
|---|---|---|---|
| WW23 | `dailyRollup.ts` | Ch 2 — 12-12 framework (Donnelly) | ✅ `system:session_start` handler — aggregates last 24h decisionLog + debriefMatrix + frictionTracker, emits reinforce/fix recommendations + toxic-alpha alarm |
| WW24 | `backtestTax.ts` | Ch 9 — backtest-tax discount | ✅ `formatBacktestSummary` — applies 15%/25% default discount, emits taxed EV alongside raw stats |
| WW25 | `traderArchetype.ts` | Ch 8 — flaw audit (3 archetypes) | ✅ plan_ready — env-driven 9 behavior booleans (`GORDON_TRADER_HESITATES` / `_CHASES` / `_PARALYSIS` / `_BORED` / `_INVENTS` / `_FAST_CLICK` / `_VISCERAL` / `_CROWD` / `_MOODY`) → archetype + recommended guardrails |

This closes the Wright port. 25 modules across 17 chapters + 6 explicit skips. Every load-bearing primitive identified in the book is now shipped, tested, and wired (or explicitly cold with documented data-blocking dependency).

---

## Anti-rot trio — already-shipped guards, deferred wiring

The three anti-rot guards (`a4244f95`, pre-dates this spec) ship with flags, tests, and exports, but no non-test code invokes the evaluators. `terminationLayers.ts:77-99` is plumbing-ready — it accepts `thesisCoherenceOk` and `mandateScopeOk` as inputs of the pre-trade check — but `agent-subscriptions.ts:478` currently hardcodes `thesisCoherenceOk: null` and `mandateScopeOk: true`, defeating the gate. Same "shipped, ⚠ not invoked" shape as TM1–TM3.

### AR1. `thesisCoherence.ts` ✅ shipped, ⚠ not invoked

**Module:** `src/infra/safety/anti-rot/thesisCoherence.ts`. Flag `GORDON_THESIS_COHERENCE` + threshold `GORDON_THESIS_COHERENCE_THRESHOLD`.
**Status:** `scoreCoherence` + `gateCoherence` + persistent `RunningThesis` loader exist. **No call site** — the L1 wire in `agent-subscriptions.ts:478` passes `null`. Wire point: in the plan_ready subscription, load the running thesis (`loadRunningThesis`), call `gateCoherence(plan, thesis, threshold)`, pass the boolean into `checkPreTrade.thesisCoherenceOk`. ~half-day. The persistence layer expects callers to write/maintain the running thesis — that's a separate UX surface (slash command `/thesis set`, autonomous-loop update on regime flip).

### AR2. `tradingUniverse.ts` ✅ shipped, ⚠ not invoked

**Module:** `src/infra/safety/anti-rot/tradingUniverse.ts`. Flag `GORDON_TRADING_UNIVERSE` + path `GORDON_TRADING_UNIVERSE_PATH`.
**Status:** `checkUniverse({ symbol, assetClass })` + persistent universe loader exist. **No call site** — `mandateScopeOk: true` is hardcoded in the L1 wire. Wire point: same handler, `loadUniverse()` + `checkUniverse({ symbol: plan.symbol, assetClass: inferAssetClass(plan.symbol) })`, pass `result.allowed` into `checkPreTrade.mandateScopeOk`. ~half-day. Universe persistence is operator-managed (`/universe add BTCUSDT crypto` or similar).

### AR3. `traderBehaviorPatterns.ts` ✅ shipped, ⚠ not invoked

**Module:** `src/infra/safety/anti-rot/traderBehaviorPatterns.ts`. Flag `GORDON_TRADER_BEHAVIOR_PATTERNS`.
**Status:** `detectTraderBehaviorPatterns` over recent decisions returns a report of patterns (revenge-trading, over-trading, drift, etc.). **No call site** — runs nowhere in production. Different shape from AR1/AR2: this is a *post-hoc observation*, not a pre-trade gate. Two reasonable wire points: (a) call after each `recordDecision` and feed high-severity patterns into the next plan_ready's adversarial findings (composes with `applyAdversarialDowngrade`), or (b) run on a session-end hook and surface to operator. ~1-2 days. Pair with TM3 (lifecycle stages) since the pattern detector reads recent decisions and would benefit from stage tagging.

---

## Quant signal combination (SC1–SC4)

Surfaced by the "IR = IC × √N" article. Four primitives that upgrade Gordon's signal-combination math from naive count to participation-ratio + bootstrap-uncertainty discipline. Sequenced by data readiness:

### SC1. `signalCombinationEngine.ts` ⏳ planned (data-blocked)

**Module path:** `src/infra/trading/quant/signalCombination.ts` (not yet built). Flag `GORDON_SIGNAL_COMBINATION`.
**Status:** the article's 11-step pipeline (serial demean → normalize → cross-sectional demean → regress for independent residuals → weight by independent edge / sigma → normalize to unit weights). Replaces TM1's naive confluence count with proper independent-residual weighting. **Needs ≥40 closed trades per signal to compute meaningful regression** — gated on paper-mode realized-outcome data. ~1 week once data exists.

### SC2. `informationCoefficient.ts` ⏳ planned (data-blocked)

**Module path:** `src/infra/trading/quant/informationCoefficient.ts` (not yet built). Flag `GORDON_IC_TRACKER`.
**Status:** rolling Pearson correlation per signal between prediction strength at fire-time and realized R-multiple. Same data dependency as SC1 — gated on TM3 stage population + paper-mode outcomes. ~3 days once data exists.

### SC3. `effectiveN.ts` ✅ shipped, ✅ wired

**Module:** `src/infra/trading/quant/effectiveN.ts`. Flag `GORDON_EFFECTIVE_N`.
**Status:** participation-ratio + simple-approximation formulas; Jacobi eigenvalue solver for symmetric correlation matrices; pairwise redundant-pair detection with configurable threshold; raw signal series → correlation matrix convenience. 21 tests covering orthogonal / identical / mixed / negative-correlation / 12-primitive-chain scenarios.
**Wire:** exposed as `compute_effective_n` tool registered in `src/infra/agents/tools/index.ts`; `/effective-n` (alias `/effn`) slash command in `src/app/slash/slashCommands.ts`. Tool accepts either a correlation matrix or raw signal series; emits structured observation `effective_n.requested`. Operator-callable today on any data they provide.

### SC4. `empiricalKelly.ts` ✅ shipped, ✅ wired

**Module:** `src/infra/trading/quant/empiricalKelly.ts`. Flag `GORDON_EMPIRICAL_KELLY`.
**Status:** standard Kelly + bootstrap-resampling for edge variance; 4-class uncertainty classification (low / medium / high / untradable at CV ≥ 1); deterministic via LCG seed; complementary to WW24 backtestTax (heuristic) — both shrink raw estimates from different angles. 18 tests covering Kelly correctness across (p, b) combinations, uncertainty shrink behavior, seed determinism, boundary cases.
**Wire:** `formatBacktestSummary` in `reporting/formatter.ts` emits `Empirical Kelly: f_kelly X% → f_empirical Y% (CV Z, uncertainty K)` line when ≥10 trades AND `GORDON_EMPIRICAL_KELLY=1`. Composes with the existing drag / decomposition / decay / backtest-tax lines on the same summary block.

### Composition note

SC3 + SC4 ship now because neither needs realized-outcome data — SC3 computes from any correlation matrix (synthetic or live), SC4 computes from existing backtest returns. SC2 + SC1 wait for paper-mode runs to produce paired (prediction, realized R-multiple) tuples, which gates the per-signal IC measurement that SC1's combination engine depends on.

---

## Kalman hidden-state estimation (KF1–KF2)

Surfaced by the "How Hedge Funds Use The Kalman Filter" article. Two specific applications of the Kalman math beyond Gordon's existing generic `kalmanFilter.ts` (which does univariate price smoothing). Both ship now — they consume raw price data Gordon already has, not realized-outcome data.

### KF1. `kalmanBeta.ts` ✅ shipped, ✅ wired

**Module:** `src/infra/trading/quant/kalmanBeta.ts`. Flag `GORDON_KALMAN_BETA`.
**Status:** time-varying regression coefficient between asset and market returns via Kalman filter with time-varying H = market return. Replaces OLS-over-fixed-window with live current-state beta + one-sigma uncertainty band. 11 tests covering constant-beta recovery, time-varying step-change tracking, uncertainty band shrinkage, boundary cases, range reporting.
**Wire:** exposed as `compute_kalman_beta` Mastra tool registered in `src/infra/agents/tools/index.ts`; `/kalman-beta` (aliases `/dynbeta`, `/kbeta`) slash command. Tool accepts asset + market return series, returns current beta, sigma, and range. Emits structured observation `kalman_beta.requested`.
**Future composition:** WW12 performanceDecomposition currently takes a static `marketBeta` input — KF1's `currentBeta` is the natural producer for that value when running on live data.

### KF2. `kalmanVolatility.ts` ✅ shipped, ✅ wired

**Module:** `src/infra/trading/quant/kalmanVolatility.ts`. Flag `GORDON_KALMAN_VOLATILITY`.
**Status:** log-variance state-space filter with bias correction for E[log(χ²(1))] = −1.27. Replaces backward-looking GARCH/EWMA/rolling-realized with current-state annualized vol estimate. Configurable Q controls responsiveness; periodsPerYear configurable for non-daily frequencies. 10 tests covering low/high vol recovery, regime-shift tracking, Q-responsiveness behavior, boundary cases.
**Wire:** `formatBacktestSummary` in `reporting/formatter.ts` emits `Kalman vol: current X% annualized, range [Y%, Z%]` when ≥60 trades AND `GORDON_KALMAN_VOLATILITY=1`. Sits alongside drag / decomposition / decay / backtest-tax / empirical-kelly on the same summary block.
**Future composition:** WW3 volatilityDrag computes σ from raw sample stddev — KF2's `currentAnnualVol` is the time-varying replacement. SC4 empiricalKelly's bootstrap could condition on KF2's vol estimate for vol-targeted Kelly sizing.

### Hidden-state-estimation framing

Beyond the code: KF1 + KF2 make explicit the pattern Gordon's harness already implements implicitly. Several existing primitives are hidden-state estimators using non-Kalman math — WW14 hurstExponent (market memory), WW20 correlationRegimeMonitor (correlation regime), WW10 weeklyRegimeCheck (regime quadrant), WW15 marginalParticipantClassifier (counterparty type). The Kalman filter is the canonical and provably-optimal solution to the same class of problem. Positioning move: describe Gordon as a hidden-state estimation substrate, with KF1/KF2 as the literal demonstrators of the framing.

### HMM upgrade to `markovRegime.ts` — debated design choice, not a gap

Surfaced when the Jurafsky & Martin (2026 draft) HMM appendix was reviewed alongside Gordon's existing `src/infra/trading/quant/markovRegime.ts`. Gordon's module uses a **visible-state Markov chain** (Bull / Neutral / Bear are classified directly from observable price/return features), estimates the transition matrix from observed state-sequence frequencies with Laplace smoothing, and produces signals like `stay / reversal_likely / transition_uncertain`. It deliberately does NOT use Forward / Viterbi / Baum-Welch (Forward-Backward).

The HMM machinery would matter only if a true *hidden* regime were modeled: emission distributions per state, joint estimation of transitions + emissions via Baum-Welch, regime-estimate smoothing via Forward-Backward. That's a different design, not strictly an upgrade. The quant literature is mixed — HMM regime detectors over-fit easily with 3+ states, and the visible-state simplification is defensible (fewer free parameters, interpretable, easier to debug, better fit for the operator-shadow use case). **Do not file as a deferred build.** If a future session proposes "upgrade markovRegime to a real HMM with Baum-Welch," the answer is: only if the operator-shadow / fund-prospect use case develops a need to recover a genuinely hidden regime variable — which it has not.

---

## Microstructure / quote-stuffing detection (MS1–MS12)

Surfaced by the "Quote Stuffing in 2026" piece. The article enumerates the manipulation patterns and the defensive-architecture controls a serious trading environment has to satisfy. Items split by data dependency: MS1–MS7 and MS10–MS12 are L2-buildable (top-of-book depth + cross-venue mids); MS8–MS9 require full L3 order-by-order feeds and are explicitly parked.

### MS1. `microstructureToxicity.ts` ✅ shipped, ✅ wired
**Module:** `src/infra/trading/signals/microstructureToxicity.ts`. Flag `GORDON_MICROSTRUCTURE_TOXICITY`.
**Status:** composite scorer rolling up MS3 + MS4 + MS5 + displayed half-life + depth turnover. Outputs continuous [0,1] score + regime (`quiet`/`elevated`/`active`). Configurable thresholds.
**Wire:** MS7 consumes via shadow chain.

### MS2. `manipulationContext.ts` ✅ shipped, ✅ wired
**Module:** `src/infra/trading/signals/manipulationContext.ts`. Flag `GORDON_MANIPULATION_CONTEXT`.
**Status:** maps toxicity regime → trade posture (`trade_normal` / `size_down` / `refuse`) with size multiplier. Identifies dominant driver.
**Wire:** MS7 shadow chain folds posture into blocker set; `refuse` → no_go.

### MS3. `crossVenueDivergence.ts` ✅ shipped
**Module:** `src/infra/trading/signals/crossVenueDivergence.ts`. Flag `GORDON_CROSS_VENUE_DIVERGENCE`.
**Status:** rolling cross-venue mid divergence + quote-vs-execution flip detection. Inputs L2 quotes + trades per venue.

### MS4. `manufacturedImbalance.ts` ✅ shipped
**Module:** `src/infra/trading/signals/manufacturedImbalance.ts`. Flag `GORDON_MANUFACTURED_IMBALANCE`.
**Status:** buildup→peak→vanish OBI signature detection at L2. Verdict: `clean` / `suspicious` / `manufactured` with confidence.

### MS5. `touchDynamics.ts` ✅ shipped
**Module:** `src/infra/trading/signals/touchDynamics.ts`. Flag `GORDON_TOUCH_DYNAMICS`.
**Status:** touch-level update rate, size flicker CV, spread volatility, mid jitter. State: `quiet` / `elevated` / `hot`.

### MS6. WW19 adverseSelectionDetector + microstructure prior ✅ shipped
**Module:** `src/infra/trading/ops/adverseSelectionDetector.ts` — extended.
**Status:** accepts optional `toxicityPriorBeforeFill` + `toxicityManipulationThreshold`. When toxicity is high (≥0.6 default) before a fast fill, the verdict is promoted from `neutral` → `adversely_selected` with `manipulationUpgraded=true`. Captures the article's claim that fast fills against elevated microstructure noise are manipulation evidence even when the post-fill move hasn't yet materialized.

### MS7. preTradeMicrostructureGate via shadow chain ✅ shipped
**Module:** `src/infra/trading/ops/shadowChain.ts` — extended with optional `microstructureToxicity` input.
**Status:** when caller supplies a `ToxicityResult`, the chain runs `classifyManipulationContext` and folds the posture into the blocker set. `refuse` is a hard blocker → no_go. `size_down` is a soft caution. Markdown summary surfaces the regime and dominant driver. Structured observation captures `microstructureRegime` + `microstructurePosture`.

### MS8. Quote lifetime distribution — **L3 required, parked**
Needs per-message order-by-order events with append/cancel/modify timestamps. Not available from standard L2 feeds.

### MS9. Cancel-to-fill ratio — **L3 required, parked**
Same data dependency as MS8. Requires order-event stream, not just top-of-book.

### MS10. `preTradeRateControls.ts` ✅ shipped
**Module:** `src/infra/safety/preTradeRateControls.ts`. Flag `GORDON_PRETRADE_RATE_CONTROLS`.
**Status:** sliding-window rate limits for messages/sec, cancels/sec, modifications/sec, order-to-trade ratio, open orders per instrument. Designed to be called BEFORE outbound order submit. Conservative retail-trader defaults.

### MS11. `killSwitches.ts` ✅ shipped
**Module:** `src/infra/safety/killSwitches.ts`. Flag `GORDON_KILL_SWITCHES`.
**Status:** 8-scope kill-switch hierarchy (`strategy → trader → account → client → instrument → venue → gateway → firm`). `tripKillSwitch` / `resetKillSwitch` / `resetAllKillSwitches` / `isExecutionAllowed` / `listTrippedSwitches`. Composes with permission engine.

### MS12. `lifecycleReconstruction.ts` ✅ shipped
**Module:** `src/infra/diagnostics/lifecycleReconstruction.ts`. Flag `GORDON_LIFECYCLE_RECONSTRUCTION`.
**Status:** per-correlation-id forensic timeline reconstruction from already-flowing audit events. Detects 5 anomalies: rapid_cancel_after_submit, excessive_modifications, cancel_without_intermediate_fill, missing_permission_check, fill_before_submit_event. Surfaces toxicity hints when patterns match quote-stuffing or layered-stuffing signatures.

### Microstructure framing
MS1–MS5 are signal producers; MS6–MS7 are consumers; MS10–MS12 are safety + forensics. The set covers the L2-achievable half of the article's checklist. MS8–MS9 stay parked until Gordon ingests an L3 venue feed (no current plan — retail-trader scope doesn't justify the data cost).

---

## Claude Code source-dump port (CC1)

Surfaced by a gap-analysis pass over four reverse-engineered Claude Code source dumps (`claude-code-source-code-full-main`, `claude-code-working-main`, `claude-multimodel-main`, `open-claude-code-main`). Most items either don't apply to trading (file-edit tools, LSP, IDE bridge, ad-hoc coordinator team-spawning) or are already shipped (hooks, permissions, slash commands, multi-agent, memory, compaction, doom-loop, plugin manager, skills, proactive radar, eval harness). Three items downgraded to "not yet": remote session manager (speculative — needs distributed deployment first), policy limits (waits for second user), migrations system (overhead until persistent-data drift).

### CC1. `structuredOutputEnforcement.ts` ✅ shipped
**Module:** `src/infra/hooks/structuredOutputEnforcement.ts`. Flag `GORDON_STRUCTURED_OUTPUT_ENFORCEMENT`.
**Status:** Zod-schema validation as a hook. Two factories: `createPostToolOutputSchemaHook` validates tool results, `createPreToolInputSchemaHook` validates tool inputs. On mismatch, blocks by default; with `repromptInsteadOfBlock: true`, modifies the payload with a structured reprompt the orchestrator can feed back to the model. Standalone `validateStructuredOutput(value, schema)` helper available for non-hook callsites (plan-card emitters, risk verdicts, kill-list payloads). 15 tests covering validation correctness, hook gating, modify-vs-block semantics, custom extractors, regex filters, and failure observers.
**Pattern port:** maps Claude Code's `registerStructuredOutputEnforcement` (utils/hooks/hookHelpers.ts) onto Gordon's hook engine. Claude Code uses a `SyntheticOutputTool` + Stop hook to verify the agent called a typed completion tool; Gordon uses Zod-schema validation at PostToolUse / PreToolUse since trading payloads already have strict typed shapes everywhere.
**Future composition:** apply to high-stakes tool emitters — `execute_plan` rationale, plan_ready cards, structured backtest summaries — where a malformed payload propagating into the order layer is worse than a refusal. Use `repromptInsteadOfBlock` for advisory paths (e.g. researcher-agent outputs) where the orchestrator can retry; use plain block for execution paths.

---

## ai-quant-researcher port (AQ1–AQ2)

Surfaced by a gap-analysis pass over the `ai-quant-researcher-main` Python project. Most items either don't apply (Python sandboxing, Jupyter notebooks) or are already shipped (kill switches, walk-forward, overfitting detection, leakage validation, deflated Sharpe). Three items downgraded: meta-labeling (worth a follow-up batch on its own), cross-sectional portfolio engine (waits for multi-instrument book state Gordon doesn't have), TCA with calibrated fills (needs realized fill data from live trading).

### AQ1. `rangeVolatility.ts` ✅ shipped, ✅ wired
**Module:** `src/infra/trading/quant/rangeVolatility.ts`. Flag `GORDON_RANGE_VOLATILITY`.
**Status:** Parkinson (1980) + Garman-Klass (1980) range-based annualized volatility estimators on OHLC bars. Roughly 7× more efficient than close-to-close at the same bar frequency. Returns Parkinson + GK + close-to-close + efficiency-gain ratio. Assumes continuous price path with no overnight gaps (matches crypto; usable on equities with a caveat). 11 tests covering GBM-vol recovery, efficiency gain, annualization scaling, invalid-bar skipping, edge cases.
**Wire:** `compute_range_volatility` Mastra tool registered in `src/infra/agents/tools/index.ts`; `/range-vol` slash command (aliases `/parkinson`, `/garman-klass`). Emits structured observation `range_volatility.requested`. Tool accepts OHLC bars + optional `periodsPerYear`.
**Future composition:** WW3 volatilityDrag computes σ from close-only sample stddev — AQ1's GK is a tighter replacement at the same lookback. Regime detector's vol classifier could use AQ1 instead of realized vol from the equity curve. KF2 kalmanVolatility filters log-variance over time; AQ1 is the spot estimator, complementary not redundant.

### AQ2. `pcaConcentration.ts` ✅ shipped, ✅ wired
**Module:** `src/infra/trading/quant/pcaConcentration.ts`. Flag `GORDON_PCA_CONCENTRATION`.
**Status:** PCA on strategy return covariance matrix. Verdict (`diverse` / `concentrated` / `critical`) based on PC1 explained-variance ratio (default thresholds 0.5 / 0.75). Reports eigenvalues, explained-variance ratios, cumulative-explained, top-loading strategies on PC1, and high-correlation pairs. Jacobi eigendecomposition for symmetric covariance. 11 tests covering diverse-vs-concentrated discrimination, eigenvalue properties, threshold sensitivity, edge cases.
**Wire:** `compute_pca_concentration` Mastra tool; `/pca-concentration` slash command (aliases `/pca`, `/concentration`). Emits `pca_concentration.requested` observation with verdict-driven outcome (`failure` for critical, `info` for concentrated, `success` for diverse). Tool accepts strategy return series + configurable thresholds.
**Why this matters:** complement to SC3 effectiveN. effectiveN counts independent signals via correlation-matrix participation ratio; pcaConcentration checks whether one PC absorbs most variance even when pairwise correlations look fine. Two strategies with r ≈ 0 can both load heavily on PC1 — independently exposed to the same hidden factor (long crypto beta, short USD, momentum). PCA catches that; effectiveN doesn't.
**Future composition:** wire into the strategy-acceptance gate alongside SC3 + multipleTestingTracker. Reject "diversified" books that are actually critical-concentration single-factor bets. When Gordon gains multi-strategy book-state tracking, this becomes a continuous monitor rather than an operator-invoked diagnostic.

---

## Kaufman TSaM port (TS1–TS14)

Surfaced by reading Perry Kaufman's *Trading Systems and Methods* 5th edition (full book). Most of the book covers material Gordon already has; this batch is the subset of chapter 9–20 primitives that grep-verified absent and have plausible trading-domain consumers. All modules cold (flag-gated) by default. Wiring (tools / slash commands / formatBacktestSummary integration) deferred to a follow-up pass when concrete consumers surface.

### TS1. `efficiencyRatio.ts` ✅ shipped, ❌ unwired
**Module:** `src/infra/trading/quant/efficiencyRatio.ts`. Flag `GORDON_EFFICIENCY_RATIO`.
Standalone trendiness gauge. `|net change| / Σ|individual changes|` over a configurable window. Classifies regime (trending / mixed / choppy). Building block for TS2 KAMA; also useful on its own as a regime-detector input.

### TS2. `kaufmanAdaptiveMA.ts` ✅ shipped, ❌ unwired
**Module:** `src/infra/trading/quant/kaufmanAdaptiveMA.ts`. Flag `GORDON_KAUFMAN_ADAPTIVE_MA`.
The book's namesake. EMA with a smoothing constant that varies each period: `sc = [ER × (fastSC − slowSC) + slowSC]²`. Default fast 2-period / slow 30-period. Squaring collapses the slow end into ~900-period flat behaviour, producing KAMA's signature "stop and wait" lag during noisy regimes. Outputs full KAMA series + trend direction + trend-change index.

### TS3. `marketProfile.ts` ✅ shipped, ❌ unwired
**Module:** `src/infra/trading/quant/marketProfile.ts`. Flag `GORDON_MARKET_PROFILE`.
Steidlmayer's TPO / value-area construction. Distinct from Gordon's existing volume-profile (`src/core/indicators/volume-profile.ts`) — Market Profile measures *time* at price (TPO letters), volume-profile measures *volume* at price. Reports POC, value-area high/low (70% default), day-type (normal / trending / non-trending), POC skew.

### TS4. `tripleScreen.ts` ✅ shipped, ❌ unwired
**Module:** `src/infra/trading/quant/tripleScreen.ts`. Flag `GORDON_TRIPLE_SCREEN`.
Elder's three-frame composition gate. Caller supplies major-trend direction (long frame), oscillator state (mid frame), and entry trigger (short frame); module returns long-entry / short-entry / wait / no-trade with the blocking screen identified. Pure composition primitive — no signal calculations of its own.

### TS5. `fisherTransform.ts` ✅ shipped, ❌ unwired
**Module:** `src/infra/trading/quant/fisherTransform.ts`. Flag `GORDON_FISHER_TRANSFORM`.
Maps non-Gaussian price distribution onto an approximately Gaussian one, producing sharper turning points than RSI/stochastic. Includes both Fisher Transform (price → bipolar) and Inverse Fisher Transform (RSI-shaped input → bipolar [-1, +1] snap-extreme oscillator).

### TS6. `hilbertTransform.ts` ✅ shipped, ❌ unwired
**Module:** `src/infra/trading/quant/hilbertTransform.ts`. Flag `GORDON_HILBERT_TRANSFORM`.
Ehlers's 7-tap truncated Hilbert Transform for instantaneous phase extraction with minimal lag. Outputs Quadrature, InPhase, phase angle in degrees, and a cyclic/non-cyclic verdict from advancing-phase monotonicity over the last few bars.

### TS7. `vidya.ts` ✅ shipped, ❌ unwired
**Module:** `src/infra/trading/quant/vidya.ts`. Flag `GORDON_VIDYA`.
Chande's Variable Index Dynamic Average. Effective smoothing constant scales with `stdev(returns, fast) / stdev(returns, slow)` — higher relative volatility → slower trend. Alternative to KAMA with a different "what does adaptive mean" theory (vol ratio vs. trendiness ratio).

### TS8/9. `elderMomentum.ts` ✅ shipped, ❌ unwired
**Module:** `src/infra/trading/quant/elderMomentum.ts`. Flag `GORDON_ELDER_MOMENTUM`.
Force Index (`volume · (close − prevClose)`, EMA-smoothed) and Elder-Ray (`Bull Power = High − EMA`, `Bear Power = Low − EMA`). Both are middle-frame oscillators in Elder's Triple Screen, so a future wire would route them into TS4.

### TS10. `trix.ts` ✅ shipped, ❌ unwired
**Module:** `src/infra/trading/quant/trix.ts`. Flag `GORDON_TRIX`.
Triple Exponential Smoothing with rate-of-change. Three cascaded EMAs followed by `(E3[t] − E3[t-1]) / E3[t-1]`. Signal-line crossover (3-period MA of TRIX) generates entries.

### TS11. `divergenceIndex.ts` ✅ shipped, ❌ unwired
**Module:** `src/infra/trading/quant/divergenceIndex.ts`. Flag `GORDON_DIVERGENCE_INDEX`.
Appel's volatility-adjusted MACD variant. Numerator is `fastMA − slowMA`; denominator is variance of price changes over the slow period; stdev-scaled bands self-adjust to volatility. Bands track DI's own volatility, so false-signal rate stays roughly constant across regimes.

### TS12. `kstIndex.ts` ✅ shipped, ❌ unwired
**Module:** `src/infra/trading/quant/kstIndex.ts`. Flag `GORDON_KST_INDEX`.
Pring's Know Sure Thing: four smoothed rates-of-change at progressively longer horizons (default 10/15/20/30), weighted 1/2/3/4, summed. Signal line is the 9-period MA of KST. Designed to capture intermediate-horizon momentum while filtering high-frequency noise.

### TS13. `hedgeFundReplication.ts` ✅ shipped, ❌ unwired
**Module:** `src/infra/trading/quant/hedgeFundReplication.ts`. Flag `GORDON_HEDGE_FUND_REPLICATION`.
Constrained OLS that recovers the allocation weights minimizing tracking error against a target return series. Returns weights, tracking-error stdev, R², and residuals. Detects singular factor matrices and refuses with a `singular` reason. Useful when Gordon wants to mimic a published-track fund or sector basket.

### TS14. `seasonalPattern.ts` ✅ shipped, ❌ unwired
**Module:** `src/infra/trading/quant/seasonalPattern.ts`. Flag `GORDON_SEASONAL_PATTERN`.
Aggregates daily returns by calendar bucket (month, weekday) and reports per-bucket mean / stdev / fraction-up / 95% CI. Companion `computeHolidayEffect` scans pre/post-holiday windows around a supplied calendar. Output is intentionally honest about sample-size limits — buckets with < 5 samples are excluded from the strongest-bias scan.

### TS15. `mesaSpectrum.ts` ✅ shipped, ❌ unwired
**Module:** `src/infra/trading/quant/mesaSpectrum.ts`. Flag `GORDON_MESA_SPECTRUM`.
Maximum Entropy Spectral Analysis via Burg's autoregressive method. Fits an AR(p) model to a (mean-detrended) price series, then computes power at a grid of candidate periods. Returns the dominant period and a peak-strength ratio (peak / median power) so callers can judge whether the input is genuinely cyclic. Works on small samples (~16-50 bars) where Fourier methods fail.

### TSaM framing
TS1–TS2 are the Kaufman-signature adaptive pair (efficiency ratio → KAMA). TS3–TS4 are Steidlmayer's Market Profile and Elder's Triple Screen — frameworks Gordon could compose its existing signal primitives into. TS5–TS12 are standard momentum / oscillator / adaptive-MA additions. TS13–TS15 are Ehlers/regression cycle and fund-mimic primitives. Everything ships cold; the next pass exposes the highest-utility subset (TS1+TS2 expected) as tools / slash commands / `formatBacktestSummary` lines.

---

## Production-engineering bar (PE1–PE12)

Surfaced by the "Missing Engineering Stack for Production AI Agents" piece. Maps the 4-primitive checklist (tokens / skills / security / trust) onto items Gordon doesn't yet have. The first two primitives are already ~90% in place (sharedPrefixCache, model routing, structured outputs, plan-then-execute, small idempotent tools); the security and trust columns surface most of the gaps below. None of these are core capability work — all are production-readiness plumbing. Relevant primarily if Gordon pursues the enterprise / regulated-finance / agent-firm-treasury positioning the strategic articles point at.

### PE1. MCP server (agent-native distribution surface)

**Status:** not built. Already tracked across MB-series (Mercury batteries) and Vellum article notes.
**Wire point:** expose `shadow_plan`, `status_overview`, `rate_response` (and eventually the rest of the runtime tools) via an MCP server with StreamableHTTP transport. List on MCP marketplace, Claude Desktop integration, Cursor, skills.sh. ~1-2 weeks.

### PE2. Per-agent OAuth tokens + per-session scoping

**Status:** Gordon's credentials are env-based (provider API keys via `GORDON_*_API_KEY`). No per-agent identity, no per-session scoping, no OAuth 2.1 + PKCE flow.
**Wire point:** introduce a token-issuance layer keyed on agent identity. Per-tool principal scoping. Keychain storage (libsecret / Keychain / DPAPI — partial via `GORDON_KEYRING_LEGACY`). Required precondition for exposing Gordon to multiple external agents safely. ~1 week.

### PE3. Output content classifier (pre-execution exfil scan)

**Status:** not built. networkAllowlist + filesystemWriteGuard catch some surfaces; nothing scans the *content* of outbound tool calls.
**Wire point:** small LLM (Haiku-class) running over each tool call before execution, flagging known exfil patterns — suspicious destinations, base64 blobs, sensitive-field references, prompt-injection echoes. ~3-5 days.

### PE4. Supply-chain attestation (SLSA L3 + sigstore + distroless)

**Status:** Gordon ships as a Bun-runtime CLI; no signing of artifacts, no SBOM emitted, no provenance attestation.
**Wire point:** add sigstore signing to release pipeline, distroless container images for any hosted variant, SBOM into artifact registry, cosign-verified deploys. Mostly CI/CD work. ~3 days.

### PE5. Drift detection (embeddings + behavioral)

**Status:** not built.
**Wire point:** track cosine distance of input embeddings from a reference centroid; track behavioral metrics (tool-call mix, escalation rate, refund rate equivalent → cancel rate, average size, rejection rate at each gate). Alarm at 2σ. Composes naturally with WW22 edgeDecayMonitor on the trading side. ~1 week.

### PE6. Behavioral canary harness

**Status:** 5 scenarios queued in `project_queued_adversarial_security_evals.md` memory note (credential-leak / permission-bypass / deny-list-circumvention / cross-agent-tool-boundary / injection-resilience). Not yet implemented.
**Wire point:** scheduled job firing the canary inputs daily through the agent stack, recording pass rate. Add new attack classes to the canary set as they appear in the wild. Composes with existing eval harness in `src/infra/domain/evals/`. ~1 week.

### PE7. Integrity-chained audit log + immutable anchoring

**Status:** Gordon emits structured observations to Axiom and has `GORDON_AUDIT_HMAC_KEY` for per-event HMAC. No hash chain across events; no anchoring to immutable storage.
**Wire point:** chain each audit event's hash to the previous (Merkle structure), periodically anchor the head into S3 Object Lock / GCS Bucket Lock. Required for the "what did the agent do at 14:22 UTC on March 12" guarantee that regulated audits demand. ~1 week.

### PE8. Composite TrustScore rollup

**Status:** not built. The underlying signals (eval pass rate, HITL approval rate, gate verdict counts, structured observation streams) all exist; no rolled-up score per agent / per skill / per day.
**Wire point:** scheduled aggregator that joins eval pass rate × drift score × canary survival × HITL approval rate × shadow-vs-realized agreement into a single weighted TrustScore. Per-agent, per-skill, per-day. ~3-5 days. The score is operationally meaningful only if its underlying signals are queryable — so PE5 + PE6 + PE7 are precursors.

### PE9. OpenTelemetry GenAI semconv

**Status:** Gordon emits OTel tracing via `src/infra/platform/observability/tracing.ts`. Does not yet emit standard `gen_ai.*` span attributes (`gen_ai.system`, `gen_ai.request.model`, `gen_ai.usage.input_tokens`, `gen_ai.response.model`, etc).
**Wire point:** decorate existing model-call spans with the standard semconv attributes. Hours of work. Makes Gordon's traces compatible with every enterprise OTel-backend out of the box. Pure pluses.

### PE10. Cisco DefenseClaw integration

**Status:** not integrated. DefenseClaw shipped March 23, 2026 from RSAC keynote — Apache 2.0, four components (Skills Scanner, MCP Scanner, CodeGuard, Guardrail Proxy). Go gateway sidecar + Python CLI + TypeScript plugin for OpenClaw framework.
**Wire point:** wrap DefenseClaw around `place_order` and the deny-first permission engine. Skills Scanner over Gordon's 11 markdown playbooks. MCP Scanner over PE1's MCP server when it ships. CodeGuard in CI. Guardrail Proxy in front of the agent runtime. ~1 week including ops. Highest-leverage single integration for credibly enterprise-grade positioning.

### PE11. TrustModel.ai GRC overlay

**Status:** not integrated.
**Wire point:** feed Gordon's existing structured observations into TrustModel.ai's control library. Produces auditor-ready reports against NIST AI RMF, ISO 42001, EU AI Act Article-by-Article, SOC 2, FedRAMP. Only useful if pursuing the regulated-finance angle. Likely 1-2 weeks for clean integration. Lower priority than PE10.

### PE12. Skills refactor to trigger/action/restriction triples

**Status:** `src/infra/agents/skills/` contains 11 markdown playbooks (best-practices, dd, exit-review, morning-brief, quick-scan, radar, rebalance, research, risk-check, swing-entry, weekend-review). They function as skill fragments but aren't in the `{ trigger, action, restriction }` shape the article proposes.
**Wire point:** convert each playbook to a JSON triple. Version per skill. Attach eval suites per skill. Enables swapping policies (e.g. "refund window changed from 30 to 60 days") without re-blessing the entire agent. ~3-5 days for the eleven existing playbooks; ongoing for new ones.

### Sequencing recommendation

If the enterprise/regulated lane is chosen, prioritize: **PE9 (hours), PE1 (already on critical path), PE10 (highest single-integration leverage), PE7 (audit integrity), PE8 (TrustScore needs PE5+PE6+PE7 to be meaningful)**. PE2 / PE3 / PE4 / PE5 / PE6 / PE11 / PE12 fill in over the following 1-2 months. If retail-only is chosen, none of these are required for the immediate product — they become noise until usage justifies them.

---

## Parked (depends on signal not yet available)

### P1. Verified Completion Rate (VCR)

The Module 11 capstone defines VCR as `green verifications / total tasks`.
Computing it for Gordon needs:
- A fixed benchmark task list (3-5 trading scenarios)
- A pass/fail verification per task (uses existing `terminationLayers`)
- Repeated runs to establish a baseline

Parked until we have enough paper-mode usage to define a benchmark task
list. Not a code blocker — a data blocker.

### P2. Capstone ablation runner

A/B running the same task list with all `GORDON_*` flags off vs all on,
measuring VCR delta + attributing failures to one of 5 layers
(task-spec / context / environment / verification / state).

Requires:
- VCR (P1)
- Trajectory capture per run (the eval harness already supports this)
- Failure-attribution heuristic mapping termination-layer failures to
  harness layer

Parked alongside P1. When both unblock, this is the highest-leverage
build remaining.

### P3. Meta-Evolution Loop (Algorithm 2 from arXiv 2604.21003v3)

The outer loop that learns a blueprint Λ across a meta-training set 𝒯_train so a single learned blueprint converges fast on any new task.

Parked for two reasons:
1. The paper itself has **no experimental results** — Section 3.3 defines the evaluation metric but never runs it. Building a meta-loop on top of unvalidated theory is the AI-quant article's "amplifier of statistical garbage" pattern.
2. Gordon has no 𝒯_train — a validated benchmark set of trading tasks. Same dependency that parks VCR (P1) and the ablation runner (P2).

When P1/P2 unblock and the paper publishes results, revisit. The inner-loop primitive (H1) is the necessary precursor and is already shipped.

---

## Kissell TCA port (KS1–KS5)

Source: Kissell, "Algorithmic Trading Methods" (Academic Press, 2nd ed., 2020), chapters 3, 14-15, 18. Triggered by the dual-edition strategy shift (see `project_dual_edition_strategy.md`): the institutional credibility surface needs canonical TCA vocabulary in the feature matrix even when the retail user doesn't touch it. Three primitives shipped; the remaining wires depend on event-schema or customer-data preconditions.

### KS1. Implementation Shortfall decomposition

**Status:** ✅ shipped — `src/infra/trading/quant/implementationShortfall.ts` + test. Mastra tool wrapper at `src/infra/agents/tools/runtime/implementationShortfallDiagnostic.ts`. Agent-callable as `compute_implementation_shortfall`.

### KS2. POV execution algorithm

**Status:** ✅ shipped — `src/core/execution/algorithms/pov.ts`. Wired into `types.ts` enum + `POVConfig` + `DEFAULT_POV_CONFIG`, dispatched by `session-manager.ts`, exported from `index.ts`, detected by `intent-parser.ts` keyword scan ("pov", "percentage of volume", "participation rate"). Surfaced through the existing `execute_with_algorithm` tool (POV added to the algorithm enum + description). No separate diagnostic tool — POV is an *execution* primitive, not a *compute* primitive.

### KS3. Efficient Trading Frontier

**Status:** ✅ shipped — `efficientTradingFrontier` in `src/backtest/analysis/marketImpact.ts` + tests. Mastra tool wrapper at `src/infra/agents/tools/runtime/efficientTradingFrontierDiagnostic.ts`. Agent-callable as `compute_efficient_trading_frontier`. Sweeps execution horizons for a fixed order size and returns the Almgren-Chriss cost-vs-timing-risk curve plus the horizon that minimizes `J = impact + λ·timing_risk`.

### KS4. Plan-lifecycle TCA breadcrumbs (precondition for /tca slash command)

**Status:** not built. KS1 (Implementation Shortfall) is plumbed as a pure-compute primitive — it accepts decision price, arrival price, fill VWAP, and close price as inputs. The agent can supply these today only if it derives them at call time (e.g. last-tick price as decision-price proxy). The institutional version requires real breadcrumbs.

**Wire point:**
- `src/events/market-events.ts` `strategy:plan_ready` event — add `decisionPriceSnapshot: { price: number; bid: number; ask: number; capturedAt: ISO8601 }` field.
- `src/runtime/permissions/PermissionEngine.ts` order-submit path — capture `arrivalPriceSnapshot: { price: number; bid: number; ask: number; capturedAt: ISO8601 }` at the moment the order leaves the permission gate.
- Persist both alongside the order record (`frictionTracker` or order log — verify the right surface before wiring).
- New helper at `src/infra/trading/quant/loadShortfallInputs.ts` that resolves a closed-trade id to a fully-populated `ImplementationShortfallInput` (decision, arrival, fills VWAP, close, qty decided, qty filled, fees) by joining `plan_ready` snapshot + permission-gate snapshot + frictionTracker fills + market close.

**Gating:** non-trivial event-schema change. Land behind a flag (`GORDON_TCA_BREADCRUMBS`) and validate with one design partner before turning on by default. Approx 3-5 days of careful work — touches plan event, permission engine, friction tracker, and persistence layer; risk surface is "are we double-snapshotting and skewing the IS decomposition by 1-2 bps".

### KS5. `/tca` slash command (gated on KS4)

**Status:** not built. Deliberately deferred. Adding it before KS4 ships would force the operator to type seven numerical arguments (decision/arrival/fill/close + qty decided/filled + fees), which violates the slash-command discipline (slash commands work best when the agent can auto-fill context).

**Wire point:** after KS4 lands, add `/tca [tradeId]` to `src/app/slash/slashCommands.ts`. With no argument: target the most recently closed trade. Tool agent resolves trade id → `loadShortfallInputs` → `compute_implementation_shortfall` → narrative output with the four-bucket breakdown and dominant-bucket callout.

**Gating:** depends entirely on KS4. Without breadcrumbs, this is a parameter dumping ground that nobody types. With breadcrumbs, it's a strong demo moment for fund prospects ("show me where my edge leaked on that BTC exit").

### KS6. Pretrade-of-pretrades calibration loop

**Status:** not built, deferred until real customer order volume exists. Pretrade-of-pretrades is the meta-analysis that compares forecasted execution cost (from `realisticCostBps` + `efficientTradingFrontier`) against realized IS (from KS1 once KS4 is live), per venue / per regime / per size bucket — detecting model drift in the cost forecast.

**Wire point:** scheduled job that reads the trade log + the IS decomposition log, joins them on order-id, and reports forecast-vs-realized cost deltas grouped by (venue, regime, advFraction bucket). Alarm at 2σ drift. Likely lives next to `calibrationTools.ts` once the order log has 100+ trades to fit against.

**Gating:** real customer order log. Building this for paper-mode synthetic flow gives misleading calibration — paper mode doesn't carry the realistic adversarial-fill component that production fills do. Park until a design partner has ~30 days of realized trades.

### KS7. FIX connectivity (institutional execution protocol)

**Status:** not built. Mentioned in `project_dual_edition_strategy.md` as a known fund-diligence gap. Every institutional OMS speaks FIX 4.2/4.4/5.0 SP2; Gordon's retail-broker integrations don't. Not buildable speculatively — different fund prospects use different FIX gateways (Goldman SIGMA-X, MS Speedway, IB FIX CTCI, custom prime-broker gateways), and each requires session-config + cert exchange.

**Wire point:** after first design-partner LOI specifies their FIX gateway. Wrap one specific gateway as a new `Exchange` interface implementation under `src/infra/exchange/fix/`. Don't generalize the abstraction layer until two gateways are integrated. Likely 4-6 weeks per gateway including session-tuning.

**Gating:** LOI + named gateway from a specific prospect. Speculative build = wasted effort because the gateway-specific quirks are the actual work.

### KS8. Almgren-Chriss closed-form optimal liquidation trajectory

**Status:** not built. Considered immediately after KS3 (Efficient Trading Frontier) shipped; deferred for lack of a consumer. The closed-form gives `x(t)` for `t ∈ [0, T]` — the shares-to-trade-at-time-t schedule that minimizes `E[cost] + λ·Var[cost]` under linear permanent + temporary impact. Complements KS3 (which picks `T*`) by picking the slice shape *within* `T*`.

**Wire point:** new pure-compute primitive in `src/infra/trading/quant/almgrenChrissTrajectory.ts`. ~150 LOC + test. Function signature: takes order size, horizon T, risk aversion λ, impact + vol parameters; returns `Array<{ t: number; sharesRemaining: number; sliceQuantity: number }>`.

**Gating:** **no consumer in Gordon today.** None of the existing execution algos (TWAP=uniform, VWAP=historical profile, POV=adaptive on realized tape, Iceberg=non-temporal) ride a parametric trajectory. Building speculatively = museum piece. Only wire when an execution algo is added that consumes a trajectory input — e.g. a future "AC" execution mode that follows the closed-form schedule, or a backtest tool that compares realized vs AC-optimal cost. ~150 LOC build + ~50 LOC consumer; do them together.

### Sequencing recommendation (Kissell stack)

KS1-KS3 shipped together in the institutional-credibility-primitives commit. KS4 is the highest-value next wire — unblocks both KS5 and KS6, and is the breadcrumb foundation for any real TCA story to a fund prospect. KS7 is gated on commercial signal. KS6 is gated on customer data signal. KS5 is purely UX sugar on top of KS4. KS8 is gated on an execution-algo consumer.

If a fund design-partner conversation surfaces, prioritize: **KS4 → KS5 → KS7 (their gateway only) → KS6 (after 30 days of fills)**.

---

## Cartea-Jaimungal-Penalva optimal execution (CJ1–CJ4)

Source: Cartea, Jaimungal & Penalva, *Algorithmic and High-Frequency Trading* (CUP, 2015), reinforced by Drissi's HT 2024 Oxford lecture notes. The canonical academic stack for stochastic-optimal-control execution. Four pure-compute primitives shipped to expand Gordon's institutional credibility surface alongside KS1–KS3. Same gating logic as MM1: no current execution-algo consumer in Gordon, but the primitives are mathematically self-contained, agent-callable as diagnostics, and would compose into a future "CJ execution mode" if a design partner asks.

All four follow the same shape as the KS series: pure-compute module + test + Mastra tool wrapper registered in `src/infra/agents/tools/index.ts`. No slash commands — same discipline as KS / MM.

### CJ1. Cartea-Jaimungal signal-driven execution speed ✅ shipped

**Module:** `src/infra/trading/quant/carteaJaimungalSignal.ts`. Flag `GORDON_CARTEA_JAIMUNGAL_SIGNAL`.
**What:** Closed-form optimal trading speed ν*(t, q, μ) for a parent order with constant drift signal μ, linear impact k, and optional Almgren-Chriss-style running penalty φ. Reduces to TWAP when φ=0, μ=0. For BUY orders, positive drift speeds up execution; for SELL orders, positive drift slows it down. Speed floored at zero (no reversal of parent intent).
**Mastra tool:** `compute_cartea_jaimungal_signal_speed` in `src/infra/agents/tools/runtime/carteaJaimungalSignalDiagnostic.ts`.
**Test coverage:** 12 tests — validation, TWAP reduction (φ=0, μ=0), AC reduction (φ>0, μ=0), drift directionality across 4 (side × drift-sign) combinations, terminal-time pressure, drift floor at zero speed, payload shape.
**Plausible consumer:** future "CJ execution mode" alongside TWAP/VWAP/POV/Iceberg that accepts a drift estimate from the signal layer (Kalman beta, regime detector, market profile) and outputs a parametric trade schedule. Not wired today.

### CJ2. Transient impact (Obizhaeva-Wang) ✅ shipped

**Module:** `src/infra/trading/quant/transientImpact.ts`. Flag `GORDON_TRANSIENT_IMPACT`.
**What:** Computes residual transient + permanent market impact at current time given a fill history and an exponential-decay half-life. Generalizes Gordon's existing permanent sqrt-impact in `marketImpact.ts` to a decaying-impact model. Pedigree: Obizhaeva & Wang (2013).
**Mastra tool:** `compute_transient_impact` in `src/infra/agents/tools/runtime/transientImpactDiagnostic.ts`.
**Test coverage:** 16 tests — validation, empty history, single fill at t=now / age=halfLife / age=2·halfLife, sign symmetry, additivity, permanent component non-decay, effective fill count, decay rate identity.
**Plausible consumer:** more realistic cost model for `marketImpact.ts` capacity sweeps + efficient trading frontier when a customer's actual fill log is available. Could also slot into IS decomposition's market-impact bucket (KS1) for higher fidelity.

### CJ3. Optimal limit-order depth ✅ shipped

**Module:** `src/infra/trading/quant/optimalLimitDepth.ts`. Flag `GORDON_OPTIMAL_LIMIT_DEPTH`.
**What:** Closed-form optimal posting depth δ*(t, q) for an execution problem with exponential fill intensity λ(δ) = A·exp(−κ·δ) and terminal inventory penalty α. Returns the depth that balances fill probability against per-fill profit. Pedigree: Guéant-Lehalle-Fernandez-Tapia (2012), synthesized in Cartea-Jaimungal-Penalva ch. 7.
**Mastra tool:** `compute_optimal_limit_depth` in `src/infra/agents/tools/runtime/optimalLimitDepthDiagnostic.ts`.
**Test coverage:** 11 tests — validation, output positivity, higher-inventory-tighter-depth, longer-horizon-wider-depth, higher-penalty-tighter-depth, q=1 boundary, lambda-ratio identity, payload shape.
**Plausible consumer:** next to Iceberg as a depth-aware limit-order mode. Not wired today; would need a new execution-algo entry in `core/execution/algorithms/`.

### CJ4. Optimal pairs trading on cointegrated spread ✅ shipped

**Module:** `src/infra/trading/quant/optimalPairsTrading.ts`. Flag `GORDON_OPTIMAL_PAIRS_TRADING`.
**What:** Long-horizon stationary optimal trading speed ν*(q, X) = −A·q − B·(X − μ) for pairs trading on an OU mean-reverting spread. A and B come from the algebraic Riccati equation (T→∞ stationary limit chosen for closed-form determinism; full time-dependent matrix-Riccati version is the explicit deferral). Pedigree: Drissi (2022) SSRN + Cartea-Jaimungal-Penalva ch. 12.
**Mastra tool:** `compute_optimal_pairs_trading` in `src/infra/agents/tools/runtime/optimalPairsTradingDiagnostic.ts`.
**Test coverage:** 13 tests — validation, equilibrium-zero-trade, spread-response signs (X>μ sells, X<μ buys), linearity in deviation, inventory reversion (q>0 unwinds long, q<0 unwinds short), inventory half-life, θ-sensitivity, γ-sensitivity, payload shape.
**Plausible consumer:** Gordon already has cointegration detection (`cointegration.ts`) but no execution layer for pairs. This primitive consumes (θ, μ, σ) from the existing detector and produces the optimal trading speed.

### Note on parameter-sensitivity surprises

CJ4's response to the impact coefficient k is non-monotonic in the naively-expected direction. With my closed-form, A = k · (−θ + √(θ² + 4γσ²/k)) / 2 is monotonically increasing in k from 0 up to its asymptote γσ²/θ. B = θ / (2A/k + θ) goes from 0 (at k→0) to 1 (at k→∞). The intuition "higher impact → trade slower → smaller A" is wrong because of the coupling between the cost-of-trading and the value-of-inventory-reduction. This is a feature of the stationary-Riccati formulation, not a bug. Tests deliberately avoid k-directional assertions and verify θ- and γ-monotonicity instead, which are clean.

### Sequencing recommendation (CJ stack)

CJ1–CJ4 shipped together in the institutional-credibility-primitives second-pass commit. All four are cold (no current consumer in Gordon). The natural next wires, in order of payoff:
1. **CJ2 → IS decomposition refinement** — when KS4 (TCA breadcrumbs) lands, use CJ2 to give a more realistic decaying-impact estimate inside the market-impact bucket of IS.
2. **CJ4 → pairs-trading playbook** — Gordon's `pairAnalysisTools` could route through `compute_optimal_pairs_trading` once a cointegrated pair is identified to produce an actionable trading speed.
3. **CJ1 + CJ3 → new "CJ execution mode"** alongside TWAP/VWAP/POV/Iceberg. Speculative until an institutional design partner requests stochastic-control-derived execution.

If a fund design-partner conversation surfaces, the CJ stack sits alongside KS1–KS3 as the "we have the canonical quant-finance vocabulary" credibility evidence.

### Verified non-gaps from the same lecture series

The Drissi 2024 lecture notes cover two signal-construction primitives in Sec 7.4 (imbalance) and Sec 7.5 (order flow) that the CJ framework consumes as drift signals. Verify-before-claim grep against Gordon confirmed both are **already shipped** under different names — no CJ port needed:

- **Order-book imbalance signal** (Sec 7.4): `src/infra/trading/signals/manufacturedImbalance.ts` computes L2 bid/ask depth imbalance with OBI thresholds + manipulation-detection state machine. Subsumes the basic instantaneous imbalance signal Cartea-Jaimungal Sec 7.4 describes and extends it with phase-tracking for manipulation patterns.
- **Signed order flow signal** (Sec 7.5): `src/infra/trading/signals/orderflowDelta.ts` computes signed delta (buy_volume − sell_volume), cumulative delta, and delta ratio. This IS the Cartea-Jaimungal "order flow imbalance" signal from Sec 7.5.

These are the natural drift-signal producers for CJ1 (`compute_cartea_jaimungal_signal_speed`) when a future execution-algo consumer wires the pipeline end-to-end.

### CJ5. Nonlinear-impact optimal trading

**Status:** not built. Source: Drissi Sec 6 / Cartea-Jaimungal-Penalva ch. 6 / Gatheral (2010). Extends Almgren-Chriss to general concave impact functions (sqrt, power-law). Closed-form trajectory only exists for specific impact shapes (linear, sqrt); arbitrary concave impact requires numerical solution of a Bolza problem with Legendre-Fenchel transforms.

**Wire point:** new primitive at `src/infra/trading/quant/nonlinearImpactTrading.ts`. ~150–250 LOC depending on whether closed-form (sqrt case only) or numerical (general). Function signature mirrors CJ1: takes order size, horizon, impact-curve parameters, risk aversion; returns trajectory.

**Gating:** no execution-algo consumer in Gordon today (TWAP/VWAP/POV/Iceberg/CJ1 baseline are sufficient for current customers). The general numerical case requires choosing default impact-curve parameters, which without customer-flow calibration is arbitrary. The closed-form sqrt case is closer in usefulness to KS3 (efficient trading frontier already uses sqrt impact) than to its own new primitive. Build when a design partner specifies a non-sqrt impact curve they need to optimize against.

### CJ6. Optimal venue split (Laruelle-Lehalle-Pagès)

**Status:** not built. Source: Drissi Sec 2 / Laruelle, Lehalle & Pagès (2011) "Optimal split of orders across liquidity pools: a stochastic algorithm approach," SIAM Journal on Financial Mathematics. Splits a parent order across N venues to minimize expected execution cost given per-venue liquidity profiles (arrival rates, depth distributions).

**Wire point:** new primitive at `src/infra/trading/quant/optimalVenueSplit.ts`. ~150–200 LOC. Strict generalization of Gordon's existing `compare_venues` tool which picks best single venue based on top-of-book price + fee.

**Gating:** missing upstream data. The optimizer needs per-venue liquidity profile estimates (arrival-rate λ_v, depth-distribution F_v) which Gordon doesn't currently track structurally — its venue surface is top-of-book quote comparison, not flow modeling. Building the optimizer before the profile-estimation layer exists is cart-before-horse: the optimizer would consume arbitrary defaults and produce plausible-looking splits that don't reflect real per-venue dynamics. Wire when an institutional customer needs multi-venue execution AND Gordon's venue layer has accumulated enough flow-history per venue to fit profiles.

### CJ7. Multi-asset basket optimal liquidation

**Status:** not built. Source: Drissi Sec 11 / Schied, Schöneborn & Tehranchi (2010) "Optimal basket liquidation for CARA investors is deterministic," Applied Mathematical Finance. Closed-form for linear-cost basket execution with cross-impact between assets. The matrix Riccati version covers cross-impact + correlation.

**Wire point:** new primitive at `src/infra/trading/quant/optimalBasketLiquidation.ts`. ~200–300 LOC. Pure compute; takes basket positions vector, covariance matrix, cross-impact matrix, horizon, risk aversion; returns per-asset trading-speed trajectories.

**Gating:** same as MM and KS8 — no portfolio-construction consumer in Gordon. Gordon trades one symbol at a time per plan; there is no multi-asset basket execution layer. The ICP per `project_dual_edition_strategy.md` (sub-$2B systematic funds, discretionary PMs, research copilots) doesn't currently run institutional baskets requiring cross-impact-aware liquidation. Build when a basket-execution design partner specifies their factor model + cross-impact covariance shape.

---

## Trade-management primitives (TM1–TM3) — pragmatic prop-trading discipline

Source: Spicy (2025) "My Mean-Reversion Trading Strategy" article — 8-year crypto former prop-trader writing about reversal trading on 1-minute timeframes. Three small, pragmatic primitives extracted (after verify-before-claim ruled out the rest of the article — regime classification, swing detection, playbook patterns, and trader-specific quality heuristics were all either already in Gordon or too trader-specific to bake in as primitives).

These differ from CJ/KS/MM in two ways: (a) **direct operator-shadow value** rather than institutional credibility — they address well-known retail/prop failure modes (staying in losers, no market context); (b) **plausible immediate consumers exist** — open positions need lifecycle management; pre-plan checks need market context. Not speculative-museum-piece tier.

### TM1. MAE/MFE tracker + FTA early-cut decision ✅ shipped

**Module:** `src/infra/trading/quant/faeFtaCut.ts`. Flag `GORDON_FAE_FTA_CUT`.
**What:** Computes current excursion in R units, MAE/MFE from optional priceHistory, returns hold/cut verdict based on FTA threshold. FTA ("First Trouble Area") is a price level on the way to the stoploss; if a candle closes through it the trade is behaving worse than typical winners → cut early. Calibration of the FTA threshold should come from observed MAE of historical winners (Gordon's backtest tracks MAE/MFE per trade).
**Mastra tool:** `evaluate_fta_early_cut` in `src/infra/agents/tools/runtime/faeFtaCutDiagnostic.ts`.
**Test coverage:** 16 tests — validation, BUY/SELL R-unit math symmetry, FTA threshold edges (-0.4R vs -0.5R), MAE/MFE from priceHistory, no-history fallback, payload shape.
**Plausible consumer:** agent calls during the open-position lifecycle (typically on candle close) to recommend early exit. Slots naturally into the existing position-management workflow.

### TM2. Time-based early-exit decision ✅ shipped

**Module:** `src/infra/trading/quant/timeBasedExit.ts`. Flag `GORDON_TIME_BASED_EXIT`.
**What:** Takes time-in-trade and average winning-trade duration; returns cut/hold based on a threshold multiplier (default 5×). Catches "outlier" trades sitting open way longer than the strategy's normal winners — abnormal duration is a strong signal that the thesis has gone stale.
**Mastra tool:** `evaluate_time_based_exit` in `src/infra/agents/tools/runtime/timeBasedExitDiagnostic.ts`.
**Test coverage:** 11 tests — validation, verdict logic at/above/below threshold, default multiplier, unit-agnostic invariant.
**Plausible consumer:** same as TM1 — agent calls during open-position lifecycle. Pairs naturally with TM1 for a two-axis "cut early" decision (excursion AND duration).

### TM3. Market breadth directional bias ✅ shipped

**Module:** `src/infra/trading/quant/marketBreadthBias.ts`. Flag `GORDON_MARKET_BREADTH_BIAS`.
**What:** Takes a basket of recent returns across the trading universe, computes positive/negative fraction with configurable thresholds, returns bullish/bearish/balanced classification + breadth statistics (mean, median, flat count). Operator pattern: balanced day → standard quality filters; directional day → relax quality on the bias side, tighten on the counter-bias side.
**Mastra tool:** `compute_market_breadth_bias` in `src/infra/agents/tools/runtime/marketBreadthBiasDiagnostic.ts`.
**Test coverage:** 16 tests — validation, classification at default thresholds, custom thresholds (looser/stricter), flat-threshold logic, mean/median statistics.
**Plausible consumer:** pre-plan context check before opening a new position; future slash command candidate (`/breadth` or similar) since this is operator-direct enough to warrant typed invocation if the workflow matures.

### Sequencing recommendation (TM stack)

TM1+TM2 are natural lifecycle pair — wire both into the same hook that fires on candle close during open positions. TM3 is a one-shot context check, wired into the pre-plan workflow (and potentially a slash command if operators end up calling it interactively). All three are zero-risk additive — they're advisory/diagnostic tools that surface verdicts; the existing permission engine + risk classifier remain authoritative on actual position-close decisions.

If the operator wants to formalize TM1+TM2 as auto-execute hooks (not just advisory), the wire point is `src/infra/hooks/` — define a PostFillTick lifecycle hook that runs the FTA + duration checks and emits an `early_exit_recommendation` event. The execution layer can subscribe and act on it, or it can stay advisory and surface in the TUI. Default to advisory until at least one operator has used the diagnostic verdicts manually and confirmed they catch the right kinds of trades.

---

## Druckenmiller sizing discipline (D1–D2)

Source: Stanley Druckenmiller (multiple interviews; via Soros). Two complementary asymmetric-sizing primitives capturing the same lesson from opposite sides — bet big when hot (D1), never bet big to get even (D2). Companion to the TM1–TM3 trade-management primitives: TM addresses lifecycle exits, D addresses sizing entries.

Both ship with **informational mode as default**: the primitive returns the observation (suggested multiplier, revenge-trade detection) but does NOT auto-apply. The operator (or downstream sizing chain) explicitly opts into "active" mode to escalate. This is deliberate — automated size-up on recent winning streaks has tilt-amplification risk, and automated blocks on flagged trades need explicit operator buy-in before they're load-bearing.

### D1. Hot-streak sizing multiplier ✅ shipped

**Module:** `src/infra/trading/quant/hotStreakSizer.ts`. Flag `GORDON_HOT_STREAK_SIZER`.
**What:** Takes recent realized P&L (caller-defined window — last N trades, trailing 30d, etc.), returns streak classification (`hot` / `neutral_positive` / `neutral_negative` / `cold`) and a suggested multiplier (linear-interp from 1.0× at hotThreshold to maxMultiplier at 2× hotThreshold). Defaults: hot ≥ +20%, cool ≤ −5%, max 1.5×, cold 0.5×.
**Mastra tool:** `evaluate_hot_streak_sizing` in `runtime/hotStreakSizerDiagnostic.ts`.
**Test coverage:** 18 tests — validation, classification edges, multiplier linear-interp, cap behavior, cold-zero-refuse, informational vs active mode.
**Informational-default rationale:** Druckenmiller's frame works for him because of decades of pattern recognition. Gordon recommending "size up because you've been winning" can encode confirmation bias into the operator's process if applied automatically. Informational mode lets the agent surface the observation without making the decision.

### D2. Revenge-trade guard ✅ shipped

**Module:** `src/infra/trading/quant/revengeTradeGuard.ts`. No flag: the guard is advisory and nothing on the order path reads it.
**What:** Detects post-loss size escalation. Returns `revengeTradeDetected = true` when BOTH (a) the prior closed trade was a loss AND (b) the currently-proposed plan size is ≥ baseline × sizeIncreaseThreshold (default 1.5). Informational mode returns `flag`; active mode returns `block`.
**Mastra tool:** `evaluate_revenge_trade_guard` in `runtime/revengeTradeGuardDiagnostic.ts`.
**Test coverage:** 16 tests — validation, detection logic across (size, prior-PnL) combinations, mode behavior, custom threshold sensitivity.
**Composition:** Sits next to the existing anti-trap surface in `src/infra/safety/anti-trap/` (`explainFirstMode`, `riskAcknowledgement`, `supervisionRust`) and complements `swing-mandate.ts`'s consecutive-loss stop. Those are coarse-grained; D2 is the targeted detector for the specific size-escalation pattern Druckenmiller calls a "death sentence."

### Wire-point recommendation

D2 is the higher-priority of the pair to flip from informational to active: it guards against a known failure mode (post-loss tilt), and its `block` mode would slot into the permission engine alongside the existing deny-list and risk classifier. D1 should stay informational unless an operator specifically asks for automated size-up — recency-bias amplification is the failure mode to avoid.

If an operator wants to wire D2 into active enforcement, the natural hook is `src/runtime/permissions/PermissionEngine.ts` — register a hook that calls `evaluate_revenge_trade_guard` with `mode: "active"` and refuses plans that come back with `recommendedAction: "block"`. Same pattern as the existing risk-classifier integration.

---

## Simulation & calibration primitives (SC1–SC4)

Source: "How to Simulate Like a Quant Desk" article (covers Monte Carlo, importance sampling, sequential Monte Carlo / particle filters, variance reduction, copulas, agent-based market simulation). Verify-before-claim against Gordon's existing surface: one real gap shipped (Brier score), three real gaps deferred with explicit gating, two patterns ruled out as wrong-domain or already-covered.

### SC1. Brier score — calibration metric ✅ shipped

**Module:** `src/infra/trading/quant/brierScore.ts`. Flag `GORDON_BRIER_SCORE`.
**What:** Mean squared error between predicted probabilities and binary outcomes, plus skill score vs baseline (default = base rate / climatology) and a calibration classification (excellent < 0.10, good < 0.20, marginal < 0.25, poor ≥ 0.25). Reference values from the prediction-market literature: 538 / Economist hit 0.06–0.12 on presidential races.
**Mastra tool:** `compute_brier_score` in `runtime/brierScoreDiagnostic.ts`.
**Test coverage:** 19 tests — validation, extremes (perfect/wrong/noise floor), boolean coercion, classification thresholds, skill-score sign across (predictions, baseline) combinations, base-rate computation.
**Plausible consumers:**
- `markovRegime.ts` confidence + transition probabilities scored against realized state transitions
- D1 hot-streak classifications scored against realized strategy outcomes
- ACE Reflector calibration-drift surfacing (degrading Brier score on regime predictions surfaces as a lesson)
- Any future probability-emitting tool (regime probabilities, signal-strength outputs, etc.)

### SC2. Sequential Monte Carlo / particle filter — deferred

**Status:** not built. Same design-choice gate as the HMM upgrade to `markovRegime.ts`. Gordon's deliberate choice is visible-state Markov classification rather than hidden-state inference; committing to a particle filter moves in the opposite direction. The article's framing (election-night live updating) is interesting but Gordon's existing Kalman filter (KF1 kalmanBeta, KF2 kalmanVolatility) handles linear-Gaussian cases, and the visible-state markovRegime handles discrete-state cases. Particle filter sits in the non-linear / non-Gaussian middle ground with no current consumer.

**Wire point if needed later:** `src/infra/trading/quant/particleFilter.ts`, ~200–300 LOC for bootstrap filter with systematic resampling. Build when a Gordon use case specifically requires latent-state inference outside Kalman's linear-Gaussian assumptions AND the visible-state simplification has been ruled out for that specific application.

### SC3. Importance sampling for rare-event Monte Carlo — deferred

**Status:** not built. Gordon's `src/infra/trading/risk/tailRisk.ts` already covers the primary tail-risk surface parametrically (VaR / Expected Shortfall). IS-based Monte Carlo would offer higher-fidelity simulation-based tail probability estimation (e.g., 100–10,000× variance reduction for events at the 0.3% tail), but the existing parametric surface adequately serves the operator-shadow use case. The marginal value is "more accurate rare-event probability from simulation" rather than a new capability.

**Wire point if needed later:** `src/infra/trading/quant/importanceSampling.ts` with exponential tilting (Lundberg equation for the tilt parameter). Build when a customer specifically asks for simulation-based tail probability estimation that the parametric approach can't deliver — e.g., path-dependent tail estimates, or strategies with non-Gaussian return distributions where parametric VaR is unreliable.

### SC4. Copulas for multi-asset tail dependence — deferred

**Status:** not built. Gaussian / Student-t / Clayton / Gumbel / vine copulas for multi-asset dependency structure with tail-dependence modeling. Real gap — Gordon's `cointegration.ts` handles bivariate cointegration but no copula-based joint distribution modeling. The article's 2008-Gaussian-copula-failure framing is correct: linear correlation misses tail-co-movement, which is the failure mode that matters most for portfolios.

**Status of gating:** Same gate as MM2-MM4 (full market-making engine) and CJ7 (multi-asset basket liquidation). Gordon's dual-edition ICP per `project_dual_edition_strategy.md` is single-asset/single-pair operator-shadow, not portfolio construction. Copulas only become relevant when a fund design partner brings a multi-asset portfolio that needs joint distribution modeling.

**Wire point if needed later:** `src/infra/trading/quant/copulas.ts` with at minimum Gaussian + Student-t (covers ~90% of fund use cases); Clayton / Gumbel / vine on demand. Build when a portfolio-construction or multi-asset basket-execution design partner specifies their factor model + dependency requirements.

### Ruled out (not deferred)

- **Monte Carlo variance reduction (antithetic / control variates / stratified)**: the article applies these to *path-simulation* Monte Carlo. Gordon's `backtest/analysis/monte-carlo.ts` is *trade-shuffling* (block-bootstrap-style), not path-simulation. The variance-reduction techniques don't naturally fit the existing domain. Skip.
- **Agent-based market simulation (zero-intelligence agents, LMSR, Kyle)**: prediction-market / market-making domain. Not Gordon's frame.

---

## Level + volume tactical primitives (LV1–LV2)

Source: ZCT 2025 articles (Volume Analysis Masterclass + Zero Complexity S/R). Two pragmatic tactical primitives extracted; the rest of the articles (volume color philosophy, 3-pattern volume scorer, simple multi-timeframe H/L extractor, approach-style classifier) ruled out via verify-before-claim — either too trader-specific (same 3-variable heuristic framework rejected from Spicy's articles) or redundant with Gordon's existing more-comprehensive surface (supply-demand-zones, order-blocks, fibonacci, camarilla, smc-patterns already cover level extraction).

### LV1. USD-denominated rolling liquidity gate ✅ shipped

**Module:** `src/infra/trading/quant/usdVolumeGate.ts`. Flag `GORDON_USD_VOLUME_GATE`.
**What:** Filters symbols by USD-denominated rolling volume rather than raw contract count. Computes per-candle USD volume (close × volume), rolls a configurable-MA (default 60), classifies tradeable/skip vs configurable USD threshold (default $100K — ZCT's convention for Binance 1m crypto perps; tune per venue/timeframe).
**Mastra tool:** `evaluate_usd_volume_gate` in `runtime/usdVolumeGateDiagnostic.ts`.
**Test coverage:** 16 tests — validation, USD computation correctness (the price-vs-contracts equivalence test), threshold edges, MA window behavior, defaults.
**Plausible consumer:** Gordon's discovery/scanner pre-scan gate. Existing `minVolume` filter in `discovery.ts` is a single-point check; LV1 adds the rolling MA + USD-denominated dimension. Operator-shadow direct value: slippage from illiquid symbols silently drains every downstream statistical edge.

### LV2. Level freshness classifier ✅ shipped

**Module:** `src/infra/trading/quant/levelFreshness.ts`. Flag `GORDON_LEVEL_FRESHNESS`.
**What:** Counts touches of a price level within a recent window (default 6h, default 0.1% tolerance) and classifies fresh (0–1 touches) vs recycled (2+ touches). Touch definition: candle [low, high] range overlaps with band [level·(1−tol), level·(1+tol)].
**Mastra tool:** `evaluate_level_freshness` in `runtime/levelFreshnessDiagnostic.ts`.
**Test coverage:** 22 tests — validation, touch detection (overlap edges, wick grazes, custom tolerance), window filtering, default window-end behavior, classification at edge counts, custom recycled threshold.
**Plausible consumer:** any of Gordon's level-producing tools (`supply-demand-zones.ts`, `order-blocks.ts`, `fibonacci.ts`, `camarilla.ts`, `smc-patterns.ts`, future `marketProfile` extensions) can compose with LV2 to grade individual levels. Fresh → momentum/breakout setup territory; recycled → mean-reversion territory. Operator-shadow direct value: distinguishing fresh from recycled is a manual judgment call traders make constantly; a parameterized classifier surfaces it as a consistent observable.

### Sequencing recommendation (LV stack)

LV1 is a pre-scan gate (universe filtering). LV2 is a per-level grader (composes with existing level-extraction tools). Natural workflow:
1. Universe scan → filter by LV1 (USD volume gate) → keep tradeable symbols only
2. For each tradeable symbol, extract levels via existing tools (supply-demand-zones, order-blocks, etc.)
3. For each candidate level, grade with LV2 (freshness) → routes setup type
4. Combine with TM3 (market-breadth bias) for directional context

Together with TM1-TM3 + D1-D2 + SC1, this completes the "pragmatic prop-trading discipline" surface in Gordon: liquidity filter (LV1) → level grading (LV2) → directional context (TM3) → sizing (D1) → revenge guard (D2) → in-flight management (TM1+TM2) → post-trade calibration (SC1 Brier on probabilistic outputs).

---

## Goal-engineering primitives (GE1–GE3)

Surfaced by Greg Ceccarelli's "Goal Engineering" article (paired markdown goal+rider docs for autonomous coding work). Most of the article (11-phase TDD loop with named depth tests, posture as multi-bullet section, files-not-fields discipline, validation checklist) is either coding-agent-specific or already shipped in Gordon under different names — see `src/core/pipeline/goalMode.ts` which explicitly identifies as "trading-domain port of the `/goal` pattern that Codex, Claude Code, and Hermes have all shipped in 2026." Three primitives translated cleanly into Gordon's trading frame.

### GE1. Goal drafter ✅ shipped

**Module:** `src/core/pipeline/goalDraft.ts`. Flag `GORDON_GOAL_DRAFT`.
**What:** Turns a vague operator intent ("make money this week") into a measurable goal in Gordon's existing parser grammar (`X until Y without Z`). Heuristic keyword detection maps intent to end-state vocabulary (`sharpe | winrate | trades | drawdown_under | checklist`); thresholds are derived from caller-supplied recent stats with a conservative improvement factor (e.g., Sharpe × 1.2 capped at 2.0; winrate + 5pp capped at 70%; drawdown × 0.8 for tighter cap; trade count × 2). Defaults to Sharpe when no keyword matches. Confidence rating reports how well the proposal could be grounded (high = keyword + stats, medium = one, low = neither).
**Mastra tool:** `compose_goal_draft` in `runtime/goalDraftDiagnostic.ts`.
**Test coverage:** 23 tests — validation, keyword detection for all 5 end-state types, threshold grounding (with and without recent stats), confidence levels across (keyword, stats) combinations, constraint passthrough, composed text grammar, horizon detection.
**Behavior:** This tool does NOT set the goal. The operator reviews and uses `/goal <composed text>` to set it via the existing slash command.
**Plausible consumer:** the existing `/goal` slash command could grow a `draft` sub-verb that calls this with context from observation history.

### GE2. Goal-mandate linkage ✅ shipped

**Module:** `src/core/pipeline/goalMandateLink.ts`. Flag `GORDON_GOAL_MANDATE_LINK`.
**What:** Computes a SHA-256 hash + ISO snapshot timestamp + byte length of the active-mandate file at goal-set time, so the goal state can record which constraint set was in effect. Also exposes `detectMandateDrift(prior, current)` to flag whether the mandate was edited between when the goal was set and now (useful when resuming a paused goal).
**Mastra tool:** `link_goal_to_mandate` in `runtime/goalMandateLinkDiagnostic.ts`. Reads the mandate file and computes the link; optional `priorLink` input triggers drift detection.
**Test coverage:** 12 tests — validation, hash equivalence + difference, known SHA-256 vector for empty string, UTF-8 byte length, default snapshot timestamp, drift detection across path/content variations.
**Plausible consumer:** `createGoalState` in `goalMode.ts` — when adding `linkedMandate?: MandateLink` as a field, call this to populate it at construction. Out of scope for this commit (would require touching `goalMode.ts` itself); shipped as a standalone primitive available when that wire-up happens.

### GE3. Per-goal deferred-actions log ✅ shipped

**Module:** `src/core/pipeline/goalDeferredActions.ts`. Flag `GORDON_GOAL_DEFERRED_ACTIONS`.
**What:** Trading-domain port of the article's `V1-CANDIDATES.md` overflow valve, scoped to active goals. During a `/goal` session the operator surfaces an action or observation worth revisiting later but explicitly out of scope for the current goal — categorized as `feature | investigation | data | observation | strategy | other`. Persists to `~/.gordon/goal-deferred.jsonl` (overridable via `GORDON_GOAL_DEFERRED_PATH`).
**Mastra tools:** `record_goal_deferred_action` (append) + `list_goal_deferred_actions` (filter by goalId / category / time window / tag) in `runtime/goalDeferredActionsDiagnostic.ts`.
**Test coverage:** 21 tests — validation (min-length thresholds for action/rationale), defaults, filter semantics (AND across criteria), JSONL round-trip with re-validation, payload preview truncation.
**Distinction from existing channels:**
- `harness-deferred-wiring.md` = Gordon's own development-deferred items (developer-authored)
- `agent-feedback.jsonl` = agent self-signaled stuck states
- `MEMORY.md` = durable cross-session learnings
- GE3 = operator-authored, per-goal, ephemeral (cleared with the goal it was scoped to)

### Sequencing notes

GE1+GE2+GE3 ship as standalone primitives. They don't modify `goalMode.ts` directly (the existing `/goal` command continues to work unchanged). Natural wire-up points for a future enhancement pass:
- GE1 wired as a `/goal draft <intent>` sub-verb in `slashCommands.ts`
- GE2 called inside `createGoalState` to stamp the link into `GoalState`
- GE3 surfaced via a `/goal-deferred record/list` sub-verb

Out of scope for the GE1-GE3 commit because each requires touching `goalMode.ts` or the slash dispatcher; should be added once an operator workflow validates the standalone primitives.

---

## Strategy economic-thesis capture (ET1)

Source: prop-trading discipline article on the difference between patterns and edges (Strimpel framing). Companion to the existing `recordUserThesis` in `src/infra/safety/anti-trap/explainFirstMode.ts` — that one is per-plan and session-scoped; ET1 is strategy-level and persistent.

### ET1. Strategy economic-thesis capture ✅ shipped

**Module:** `src/infra/safety/anti-trap/strategyEdgeThesis.ts`. Flag `GORDON_STRATEGY_EDGE_THESIS`.
**What:** Four-field structured capture of the economic mechanism behind a strategy:
1. `inefficiencyDescription` (≥30 chars) — what mispricing the strategy exploits
2. `counterpartyIdentification` (≥20 chars) — who is on the other side
3. `counterpartyConstraint` (≥20 chars) — why they consistently act that way
4. `persistenceRationale` (≥20 chars) — why the inefficiency isn't arbitraged away

Anti-pattern phrase detection runs over all four fields. Flags include framing like "worked historically", "backtest showed", "data mining", "trial and error", "looked good in backtest", "worked in the past", "purely empirical", "just a pattern we noticed". Match against any of these produces structured warnings.

**Mode:** `informational` (default) → warnings produce `advisory_warning` status with the thesis still recorded; `active` → warnings produce `invalid` status with record withheld until rewritten.

**Output:** A SHA-256 hash over the canonical concatenation of fields. Downstream consumers (backtest pipeline, strategy registry, ACE Reflector) can stamp this hash onto results so any analytical output traces back to the thesis the operator wrote BEFORE running it.

**Mastra tool:** `capture_strategy_edge_thesis` in `runtime/strategyEdgeThesisDiagnostic.ts`.
**Test coverage:** 27 tests — validation (4 min-length thresholds + empty strategyId), clean-thesis valid status, deterministic hash, hash-differs-on-change, all 9 anti-pattern phrases individually detected, multiple-anti-patterns surfaced together, informational vs active mode behavior, reasoning text quality (hash prefix in valid, rewrite-guidance in invalid, reflection prompt in advisory).

**Distinct from existing surface:**
- `recordUserThesis` (`explainFirstMode.ts`) — per-PLAN, captures reasoning for a specific trade setup
- `marginalParticipantClassifier` (WW15) — runtime detection of counterparty types from signals (downstream consumer of strategy thesis)
- `edgeAttribution.ts` — post-hoc P&L attribution to known factors
- ET1 — pre-backtest, strategy-level, operator-authored, with anti-pattern enforcement

### Wire-point recommendations

ET1 ships as a standalone primitive that does NOT touch the backtest pipeline or strategy registry directly. The natural enhancement wire-ups for a future pass:
- Strategy registry: require a valid (or advisory_warning) thesis hash before a strategy can be persisted
- Backtest pipeline: warn/refuse when running a backtest for a strategy that has no thesis
- ACE Reflector: when distilling lessons, include the thesis hash so realized outcomes can be reasoned about against the original economic claim
- Pro-tier institutional pitch: the thesis hash IS the audit-lineage artifact — "every analytical output traces back to a written economic mechanism"

Mode discipline: informational by default (operator-shadow workflow), active when the operator explicitly opts into pre-backtest gating.

---

## Multi-instrument hedge-ratio primitive (HR1)

Surfaced by re-evaluating the Phynance (Kakushadze 2014/15) §26 optimal-hedge-ratio section against Gordon's actual quant surface. Most of Phynance (Black-Scholes, Greeks, HJM, Vasicek, CIR, BGM, quantos) is orthogonal to Gordon's frame (no options, no fixed income), and most of the foundational apparatus (variance-ratio + runs + Ljung-Box martingale tests, single-instrument time-varying beta, cointegration, stationary bootstrap, sign-randomization edge test) is already shipped. The matrix-case optimal hedge ratio was the one genuinely uncovered candidate aligned with Gordon's quant frame.

### HR1. Multi-instrument optimal hedge ratio ✅ shipped

**Module:** `src/infra/trading/quant/multiInstrumentHedgeRatio.ts`. Flag `GORDON_MULTI_INSTRUMENT_HEDGE_RATIO`.
**What:** Given a position's return series X and K candidate hedge instruments' return series {Y_1, ..., Y_K}, computes the variance-minimizing hedge weights h* = Σ_Y⁻¹ · Σ_XY (equivalent to OLS regression coefficients of X on Y). Returns hedge weights, residual + position variance, variance reduction (R²), and condition number of Σ_Y.
**Mastra tool:** `compute_multi_instrument_hedge_ratio` in `runtime/multiInstrumentHedgeRatioDiagnostic.ts`.
**Test coverage:** 20 tests — validation (length mismatch, NaN/Inf, candidateNames length, negative ridge), K=1 case (perfect linear relationship → weight matches slope, uncorrelated → ~0, matches manual Cov/Var ratio), K>1 cases (decomposed regression recovers coefficients), default Y_1/Y_2 naming, collinearity handling (perfect → throws with helpful message; near-collinear → ridge stabilizes; condition-number flagged), output structure invariants (residualVariance ≤ positionVariance, both non-negative).
**Implementation:** Gauss-Jordan inversion with partial pivoting for the K×K matrix. Robust for K ≤ ~30. Ridge regularization parameter handles ill-conditioned cases without external dependencies. Condition-number estimate flags marginal (κ > 1e3) and unstable (κ > 1e6) cases.
**Generalizes:** KF1 `kalmanBeta` (single-instrument time-varying beta) → multi-instrument static hedge ratio. KF1 remains the primitive for the single-instrument time-varying case; HR1 is the multi-instrument static case.
**Plausible consumers:**
- Operator with a long crypto position wants to compute the optimal hedge weights across {ETH, SOL, equity-correlated proxy}
- Beta-neutralization in long/short setups with multiple potential beta hedges
- Pre-trade hedge sizing when single-instrument kalmanBeta isn't enough
- Risk classifier could call HR1 to recommend hedge mixes given current exposures
- Future Markowitz/portfolio-construction layer (when ICP signals warrant) would compose HR1 as the constrained-weight degenerate case

### Why this isn't full Markowitz

HR1 is a *degenerate* mean-variance problem: position weight on X is fixed at 1, hedge weights on Y are free, objective is residual-variance minimization (no expected-return term). Full Markowitz (free weights across all assets, mean-variance objective, possibly constraints) remains deferred per the dual-edition memo — same gate as MM2-MM4, CJ7, SC4 (copulas for multi-asset tail dependence). HR1 ships now because the *single position + K hedge candidates* case is operator-relevant at Gordon's current ICP without committing to full portfolio construction.

---

## Observability pillars for ACE / harnessEvolution (EXO1 + DEC1)

Surfaced by the AHE paper (arXiv 2604.25850v4) which formalizes three observability pillars for agent-driven harness evolution: component observability (✅ already present in Gordon — every primitive is a file with tests, the wiring doc catalogs them), experience observability (PARTIAL — addressed by EXO1), and decision observability (ABSENT — addressed by DEC1).

### EXO1. Action-log evidence linkage in ACE lessons ✅ shipped

**What:** Each `ACELessonCandidate` and `ACELesson` now carries an `evidenceEntryIds: string[]` field listing the raw action-log entry IDs that produced the lesson. Per-entry pattern rules push the matching entry's ID; aggregate pattern rules can optionally supply IDs via `AggregateCandidate.evidenceEntryIds`. Set union with a `MAX_EVIDENCE_IDS = 25` cap keeps lesson records bounded across merges.
**Modules touched:**
- `src/infra/agents/ace/Reflector.ts` — added `evidenceEntryIds` to `ACELessonCandidate`, added optional field on `AggregateCandidate`, added `mergeEvidenceIds` helper + cap constant, updated `runReflector` loop to populate IDs
- `src/infra/agents/ace/Curator.ts` — preserves the field on lesson merge via `mergeEvidenceIds`, adds `loadLessonEvidence(lessonOrId)` drill-down helper that resolves IDs back through the action-log store
- `src/infra/agents/ace/index.ts` — re-exports the new helpers
**Backward compatibility:** legacy `ace-lessons.json` records without the field load as `evidenceEntryIds: []` (no migration step needed).
**Test impact:** existing ACE tests (29 total across `ace.test.ts` + `ace-tools.test.ts`) updated with the new field; all green.
**Plausible consumer:** the "why does this lesson exist?" diagnostic — agent or operator inspects a curated lesson and pulls the raw entries that produced it without re-running pattern extraction. Slots naturally into a future `/ace explain <lessonId>` slash command.

### DEC1. Decision observability — self-declared prediction + verification ✅ shipped

**Module:** `src/infra/safety/anti-trap/decisionObservability.ts`. Flag `GORDON_DECISION_OBSERVABILITY`.
**What:** Stamps any structured edit (ACE-distilled lesson, `harnessEvolution` config change, skill/rule adjustment) with a self-declared prediction at edit-time. A verification step compares predicted vs realized over the declared window, returning verified / failed / still_pending. Includes optional contract-tampering detection by recomputing the SHA-256 contract hash from supplied original inputs.

**Surface:**
- `stampEditPrediction(input)` → `StampedEditRecord` with `editId`, `editKind` (`ace_lesson | harness_edit | config_change | skill_update | rule_adjustment | other`), `editDescription`, `prediction` (metric, direction, expectedDelta, baseline, verificationWindow), `predictedThreshold`, `contractHash`, `status: "pending"`
- `verifyEditPrediction({ stamped, observedValue, windowElapsed, originalStampInput? })` → result with `status`, `directionCorrect`, `magnitudeMet`, `contractIntact`
- `serializeStampedRecord` / `parseStampedRecord` for JSONL persistence

**Mastra tools:** `stamp_edit_prediction` + `verify_edit_prediction` in `runtime/decisionObservabilityDiagnostic.ts`.

**Test coverage:** 29 tests — validation (editId, description length, metric, expectedDelta sign, baseline, window n/integer, ISO timestamp), predictedThreshold computation for both directions, deterministic + tamper-sensitive contract hash, status verdicts (still_pending / verified / failed by direction and magnitude), contract-tampering detection, JSONL round-trip, payload shapes.

**Discipline boundary:** DEC1 does NOT perform automatic revert. The caller (ACE Curator, harnessEvolution loop, operator) knows how to undo their own structured edit; this primitive's job is to produce the verdict, not act on it. This is the safety boundary the AHE paper acknowledges: "self-attribution is reliable for fixes but blind to regressions" — DEC1 makes the verdict visible, the caller decides whether to trust it.

**Plausible consumers:**
- ACE Curator: when a high-score lesson is added, stamp a prediction (e.g., "this lesson should improve win rate by ≥3pp over next 30 trades"). Verify after window. Failed predictions surface as candidates for retirement/refinement.
- harnessEvolution Algorithm-1: each H^(k) edit gets a stamped prediction tied to the evaluator metric. Failed predictions can trigger automatic rollback to H^(k-1) (caller-specific logic).
- Manual operator edits to config / mandate / strategy: stamp at edit-time, verify after the operator-specified window. Catches well-intentioned tweaks that didn't actually help.

### Sequencing recommendation

EXO1 ships invisibly (existing ACE flow continues; new field is populated but unused unless a consumer calls `loadLessonEvidence`). DEC1 ships as standalone primitive — neither ACE Curator nor harnessEvolution automatically call it yet. Wire-ups for a future pass:
- ACE Curator: optionally stamp a prediction when adding a lesson (operator opt-in via flag)
- harnessEvolution: stamp+verify each iteration's edit; integrate with the existing `best-so-far` selection
- Manual workflow: `/edit-prediction stamp …` and `/edit-prediction verify …` slash commands

These wire-ups are out of scope for the EXO1+DEC1 commit — they require touching `Curator.ts` write path and `harnessEvolution.ts` iteration loop. Ship the primitives first; integrate when an operator workflow validates the standalone shape.

---

## Market-making primitives (MM1) — deferred pending design partner

Surfaced by the K (ctubio's Krypto-trading-bot) survey, which is a textbook C++ market-making engine forked from tribeca/HRP. K bundles fair-value microprice estimators, inventory-skewed quoting, multi-timescale EWMA bank, and 7 quote-mode dispatchers. None of these belong in Gordon today — the dual-edition ICP (sub-$2B systematic funds, smaller multi-strats, discretionary PMs) doesn't run continuous two-way quotes, so the entire engine is speculative without a crypto-native MM design partner (Wintermute / GSR / smaller DeFi MM firms). One sub-primitive (microprice) is structurally distinct enough to track separately because it has a *plausible* non-MM consumer.

### MM1. Microprice / weighted fair-value estimator

**Status:** not built. Verified absent — `grep` for `microprice|wMid|volumeWeightedMid|sizeWeightedMid` across `src/` returns zero hits. Gordon's orderbook tools (`src/infra/agents/tools/market/orderbook.ts`, `src/infra/exchange/orderbook/`) compute top-of-book mid only.

**What it is:** three pure-compute variants on a level-1/2 orderbook —
- `mid = (bid + ask) / 2` (already present implicitly)
- `vwMid = (bidSize * ask + askSize * bid) / (bidSize + askSize)` (size-weighted; pulls mid toward the thicker side)
- `wMid = sum over levels (size_i * price_i) / sum sizes` (volume-weighted across N levels)

K's variants live at `K's trading-bot.data.h:842-864` (3 forms: BBO, wBBO, rwBBO). Textbook Glosten-Milgrom / standard MM practice; not novel.

**Wire point:** new primitive at `src/infra/trading/quant/microprice.ts`. ~60 LOC + test. Stateless function over a `LevelBook` shape Gordon already has.

**Plausible consumers:**
1. **IS decomposition's arrival price** (once KS4 breadcrumbs land) — `arrivalPrice` is the price observed when the order hit the market. Microprice is a better reference than top-of-book mid because it reflects the depth on the side the order is consuming. Consumer dependency: KS4.
2. **A future market-making engine** (MM2-MM4 below) — but that's gated on a design-partner ask.
3. **Slippage estimate refinement** in `frictionTracker` — replace `(bid+ask)/2` with microprice in fill-quality scoring. Tiny improvement; not urgent.

**Gating:** identical pattern to KS8 — easy to build, no urgent consumer. Build it when KS4 lands (then the arrival-price refinement becomes the consumer) OR when a crypto-MM customer surfaces. Until then it's a museum piece.

### MM2-MM4 (cold — full MM engine)

Inventory-skewed quoting (Avellaneda-Stoikov-style position-feedback loop), 7-mode quote dispatcher (Top/Mid/Join/Depth/etc.), multi-timescale EWMA bank. All textbook MM material from K. Gating: **named crypto-native MM design partner.** Speculative build is wasted effort because K's tactical parameters (spread widths, position divergences, refresh cadences) don't generalize — they're calibrated per-venue-per-pair against a specific customer's flow. None of these surface for fund-diligence credibility either; TradFi funds don't ask "do you do market making" of an OMS/research vendor.

**Adjacent disciplines surveyed, no portable primitives surfaced:** cross-venue spread arbitrage (WolfBot's `src/Arbitrage/Strategies/Spread.ts` is naive 2-leg; Gordon already has `atomicExecution.ts` with rollback + `crossVenueDivergence.ts` signal, both more sophisticated) and triangular arbitrage (TriangularArbitrage repo uses hardcoded-triplet enumeration with stubbed trading logic, not graph-based cycle detection). Same gating as MM2-MM4: arb-firm design partner specifies their own cycle-detection and execution semantics; no point caching a generic primitive that won't match their flow.

---

## PF1 — Pareto frontier tracker

**Status:** built, not wired into consumers. Module: `src/infra/trading/quant/paretoFrontier.ts` + `paretoFrontier.test.ts`. Agent wrapper: `src/infra/agents/tools/runtime/paretoFrontierDiagnostic.ts` (tool id `compute_pareto_frontier`).

**What it is:** pure-compute multi-objective dominance check. Given N candidates with K numeric objectives each + a per-objective direction (`maximize` / `minimize`), returns the non-dominated set (the Pareto frontier), the dominated set, and a `dominationMap` listing every dominator of every candidate. Two helpers exposed:
- `dominates(a, b, dirs)` — strict (≥ on all, > on at least one)
- `weaklyDominates(a, b, dirs)` — non-strict (≥ on all)

O(N²·K). Fine for the candidate-set sizes Gordon actually compares (handfuls to low hundreds).

**Why it exists.** Inspired by Meta-Harness paper (arXiv 2603.28052v1) — when an agent's harness has multiple legitimate objectives (Sharpe vs drawdown, accuracy vs context-cost, score vs latency), collapsing to a single weighted score loses information and bakes in someone's weighting bias. The Pareto frontier preserves the tradeoff structure.

**Plausible consumers (none wired yet):**
1. **`harnessEvolution`** — currently selects parent candidates by a scalar fitness. Replacing the parent-selection step with frontier membership keeps high-Sharpe-but-high-DD and low-DD-but-modest-Sharpe candidates alive simultaneously instead of one collapsing the other.
2. **ACE Curator scoring** — lessons are currently ranked by score alone. (score, context-cost, evidence-count) on the frontier surfaces lessons that are slightly worse but materially cheaper to inject.
3. **DEC1 verification with vector predictions** — when a stamped edit predicts multiple metric improvements, "verified" should mean the realized vector *weakly dominates* the predicted threshold vector. `weaklyDominates` already lives in PF1 for exactly this.
4. **Strategy comparison surfaces** — `compareStrategies` / `evaluateBacktest` callsites that today print a table of metrics could mark frontier members so the operator sees which strategies are not Pareto-dominated.

**Wire point:** none yet — this is the canonical "primitive built ahead of consumer" deferred entry. Wire on signal: first time `harnessEvolution` produces a candidate-set diverse on >1 axis, or first time a Curator decision feels like "wrong lesson kept", reach for PF1.

**Gating:** zero risk to build (pure function), nontrivial risk to wire prematurely (changes selection semantics in evolution / curation paths). Don't wire opportunistically — wait for a failure mode that scalar collapse explains.

---

## TL1 — Trendline detection (peel-off + OLS)

**Status:** built, not wired into consumers. Module: `src/infra/trading/quant/trendlineDetection.ts` + `trendlineDetection.test.ts`. Agent wrapper: `src/infra/agents/tools/runtime/trendlineDetectionDiagnostic.ts` (tool id `detect_trendlines`).

**What it is:** pure-compute upper + lower trendline extraction over a series of price bars. Two methods:
- `peel_off` (default): iteratively fit OLS through highs (or lows), drop bars on the wrong side of the line, refit until the inlier set stabilizes or hits `minInliers`. The retained bars form an envelope; the regression through them is the trendline. Inspired by the `indicators_26.trend_lines` technique from Moon Dev's flag-continuation backtest, fixed to use the same series for fit *and* intercept (the original mixed highs for the peel iterations and closes for the final fit — a unit-inconsistency bug).
- `ols`: plain ordinary-least-squares fit through highs/lows. Returns a general-trend best-fit line, not an envelope. Useful for slope-as-state regime features.

Returns slope (Δprice/bar), intercept, r², inlier count, touch count (bars where `|price − line| ≤ touchTolerance · |line|`), and start/end line values for both upper and lower.

**Why not RANSAC.** Trendlines are an *envelope* problem (find a line that bounds prices from above/below), not a *robust-fit* problem (find a line points mostly lie on). RANSAC needs an arbitrary inlier threshold and adds non-determinism without solving the envelope-bounding property. Peel-off enforces the envelope constraint by construction.

**Plausible consumers (none wired):**
1. **`chartTools` VLM analysis** — overlay computed trendlines so the VLM sees structural slope/resistance rather than only candle pixels. Today the VLM has to infer trend structure visually; TL1 hands it the explicit numbers.
2. **`strategyEdgeThesis` (ET1)** — theses like "breakout above 14-day resistance trendline" need a concrete computed reference for verification.
3. **`levelFreshness` (LV2)** — currently tracks *horizontal* levels. Sloped trendlines are the natural extension; same freshness-decay logic with `level(t) = slope·t + intercept` substituted for the constant.
4. **`timeBasedExit` (TM2)** — could trigger on price returning to a regression-derived trendline rather than (or in addition to) elapsed-time.
5. **Regime detector / `marketProfile`** — trendline slope as a state feature for trending-vs-range classification.

**Wire point:** none yet. Same posture as PF1 — primitive built ahead of consumer, wire on signal. First time the VLM misses a structural breakout / breakdown that a computed trendline would have flagged, reach for TL1.

**Gating:** zero risk to build (pure function). Wiring into `chartTools` is the cheapest first consumer (additive overlay, doesn't change behavior). Wiring into `levelFreshness` is more invasive (changes the level-tracking data model from constants to lines).

---

## How to use this doc

When you (or a future session) want to wire one of these:

1. Re-read the module's source file + test file to confirm the API
   hasn't changed since this was written.
2. Read the **wire point** file to confirm the callsite still exists.
3. Build the wire as a small, separately-flagged change. Don't bundle
   multiple wires in one commit unless the modules are coupled.
4. Update the relevant section here to either ✅ wired or to note any
   changes to the rollout posture.

**Don't bulk-wire.** Each wire is its own risk surface and each is best
gated on a real signal (a missed trade, a slow tool, a doc gap that
caused confusion). Wiring on schedule rather than on signal is how cold
modules become technical debt.

---

## Memory references

- `~/.claude/projects/.../memory/project_harness_engineering_mapping.md` — vocabulary crosswalk between external harness literature and Gordon code
- `~/.claude/projects/.../memory/feedback_verify_before_gap.md` — grep before claiming any feature is missing; this is doubly true for harness terms which almost always map to existing code

## Git history

- `535b2647..a5f4805c` — Tier 0 reorgs (directory grouping passes)
- T1 + wire commit — sprint contract, plan rubric, clean-state gate
- T2 commit — decision log, agent readiness, termination layers, working-memory flush signal
- T3 commit — shadow mode, OTel, WIP-limit
- Diagnostics commit — quality document, cold-start audit, boundaries

---

## Session-deferred (added 2026-05-23)

Items deferred across the long working session that shipped the
applied-math diagnostic suite (commits `e6a31f0c`, `50dac2a5`,
`fa41c2a4`, `0bb96211`), the skills-governance stack (`32a5d5e8`,
`0c849f7c`), and the event-replay Tier 1 framework (`daa7e0d9`). Each
entry follows the same pattern as the sections above — what's ready,
what's missing, rollout posture. Pick by operator signal.

### S1. Event-replay Tier 2 — auto data fetcher

**Module:** `src/backtest/event-replay/` (Tier 1 catalog + engine
+ verdict shipped in commit `daa7e0d9`).
**Memory:** `[[project_event_replay_tier_2_3_deferred]]`.

**Status:** Tier 1 framework accepts arbitrary OHLC bars from any
source. Operator currently must source historical data for the four
canonical events themselves (CHF unpeg 2015, PBOC devaluation 2015,
US election 2016, COVID vol spike 2020).

**What's needed:** Auto-fetcher that pulls historical bars from
Gordon's connected venues:
- Binance for COVID-era crypto reactions (BTCUSD, ETHUSD, USDT
  flows)
- IBKR for FX/equity (EURCHF tick → minute aggregation for CHF
  unpeg, SPX futures for COVID + election)
- Alpaca for SPX cash-market reactions
- Per-venue data-depth probe so the operator knows which events
  they can actually run

**Risk:** Medium. Each venue has different history depth + auth
requirements. Retail brokers typically don't have minute resolution
reaching back to 2015–2017 without paid feeds.

**Revive on:** Operator concretely says "I want to stress-test
against CHF unpeg" AND has data subscription, OR Pro pilot kicks off
(institutional buyers expect this natively).

### S2. Event-replay Tier 3 — bundled tick data + per-event slippage models

**Module:** `src/backtest/event-replay/`.
**Memory:** `[[project_event_replay_tier_2_3_deferred]]`.

**Two sub-builds:**

1. **Bundled event tick data** — ship a small dataset (~5–50MB)
   containing tick or sub-minute bars for the four canonical events
   on key assets (EURCHF for CHF unpeg, SPX/VIX for COVID, etc.).
   Removes the "operator needs data subscription" gating issue.

2. **Per-event slippage models** — encode realistic execution
   conditions per event (CHF unpeg = 200pip gap-through baseline;
   COVID = 5× spread widening on index CFDs; PBOC = funding cost
   spike on CNH proxies). Today the engine applies a single
   `SlippageModel` with a uniform `spreadWideningMultiplier` — the
   per-event nuance is collapsed.

**Risk:** Medium-high. Bundled data has commercial-licensing
implications (Refinitiv tick history is canonical but expensive).
Operator-contributed data via PRs is the cheaper alternative.

**Revive on:** Data partnership unlocks bundling, OR operators with
their own tick archives contribute, OR Pro pilot funds the licensing.

### S3. Per-skill eval harness

**Module would live in:** `src/infra/skills/eval/`.
**Memory:** none yet — capture before building.

**Status:** Not started. The skills-governance stack
(`src/infra/skills/{governance,usage-tracker,audit}.ts`) tracks
metadata + usage + staleness but does NOT verify that any specific
skill still produces correct output.

**What's missing:** Heterogeneous skill outputs (one renders charts,
one searches news, one classifies trades) make generic skill eval a
research problem, not a 200-LOC commit. Possible approaches:
- Per-skill golden-output fixtures + diff-based check
- LLM-as-judge per-skill rubrics (like the existing
  `infra/domain/evals/harness/` but scoped to single-skill scope)
- Operator-defined assertions per skill in frontmatter

**Risk:** High implementation cost relative to operator value at
single-operator scale. Likely Pro-only feature.

**Revive on:** Operator concretely reports a drifting skill, OR Pro
pilot demands skill-level eval gates.

### S4. Skill marketplace UI / `/skills` TUI rendering

**Module would live in:** `src/tui/components/`.
**Status:** Not started. `runSkillAudit` returns structured data +
`formatAuditReport` returns text. The /skills slash command (commit
`0c849f7c`) renders text inline. A dedicated TUI surface for
browsing + searching + tagging skills doesn't exist.

**What's missing:**
- Searchable / filterable skill list with status + last-reviewed
  columns
- Interactive `/skills tag <id> <status>` command for backfilling
  governance metadata without manual SKILL.md edits
- Bulk-review UI for promoting community skills from experimental →
  active

**Risk:** Low. Pure UI. Failure means falling back to text rendering.

**Revive on:** Operator skill-catalog grows past ~100 skills, OR
operator authoring community skills regularly.

### S5. `/skills review <id>` interactive subcommand

**Status:** Listed in the slash command's `subcommands` but
currently maps to "list skills needing review" — there's no
interactive single-skill review surface.

**What's needed:** When operator runs `/skills review ccxt`:
1. Display the skill's current metadata + body
2. Show usage stats specifically for this skill
3. Prompt operator: "Mark as reviewed? Update status? Promote /
   demote / deprecate?"
4. On confirm, rewrite the SKILL.md frontmatter

**Risk:** Low. File-write surface but well-scoped per-skill.

**Revive on:** Operator audit surfaces stale skills needing
metadata updates AND they want to handle one-at-a-time rather than
via batch script.

### S6. CI hook for skill validation

**Module:** `scripts/dev/tag-builtin-skills.ts` exists but no
validation gate runs on PRs/commits.
**Status:** Loader validates skills at runtime; nothing enforces
pre-merge.

**What's needed:**
- `scripts/dev/validate-skills.ts` — walks `src/infra/skills/builtin/`
  + any `.gordon/skills/` directories, runs `validateSkillFrontmatter`
  on each, exits non-zero on any error-severity issue
- npm script: `"validate:skills": "bun run scripts/dev/validate-skills.ts"`
- Pre-commit hook in `lefthook.yml` or equivalent CI config

**Risk:** Low. Read-only check; failure mode is verbose CI output.

**Revive on:** Operator authors first community SKILL.md with a
validation error that ships to main.

### S7. ACP v3.6+ — executor-agent dynamic tool registration

**Module:** `src/infra/acp/`.
**Status:** v3.5 (commit `a7e262d1`) ships MCP-client spinup for
session-scoped MCP servers forwarded by the editor. The instantiated
client tools are NOT routed into the executor agent's tool surface —
they're available to the bridge but not callable mid-turn.

**What's needed:** Mastra-wrapper changes so MCP-client tools
register dynamically into the agent's effective tool list per
session. Requires understanding how Mastra resolves tool catalogs at
agent creation vs. per-message.

**Risk:** Medium. Touches Mastra internals; could affect prompt
caching + cache-warm behavior.

**Revive on:** Operator runs Gordon in Zed/Athas AND wants forwarded
MCP server tools as agent-callable.

### S8. ACP v3.6 — LLM client content-block widening

**Module:** `src/infra/ai/llm/` + `src/infra/acp/llm-vision.ts`.
**Status:** v3.5 ships `GORDON_ACP_VISION_PATH` env routing for
inline-text vs. block-aware vision paths. Current LLM client signature
accepts `Message[] = { role, content: string }` only — content-block
arrays don't flow through.

**What's needed:** Widen the LLM client interface to accept content
blocks. Anthropic adapter already supports it; OpenAI/Dedalus
adapters need format mapping. Default behavior unchanged when
content is a plain string.

**Risk:** Medium. Cross-cutting interface change; needs
backward-compat tests for every adapter.

**Revive on:** Operator regularly attaches images/audio to Gordon
prompts in ACP mode AND inline-text rendering loses information.

### S9. ACP v3.6 — Mastra mid-turn token-budget signals

**Module:** `src/infra/agents/runtimeHarness.ts` +
`src/infra/acp/token-budget.ts`.
**Status:** Token-budget probe exists (`probeBudgetHalt`) but checks
between agent turns, not within a turn. The `max_turn_requests` ACP
stop reason can't fire mid-turn today.

**What's needed:** Mastra-level callback on every tool call /
text-delta within a turn. Pull from existing `costTracker.ts`
surface; gate via budget threshold.

**Risk:** Medium. Performance-sensitive callsite.

**Revive on:** Operator hits the Mastra ceiling mid-turn and the
stop reason doesn't reflect it.

### S10. MCP server v3 features — parked behind HTTP server park

**Module:** `src/infra/ai/mcp/`.
**Memory:** `[[project_mastra_http_server_deferred]]`.

**Items captured in MCP v2 commit body** (`325809ca`):
- MCP Apps (interactive UI widgets) — requires editor opt-in
- Elicitation URL mode — needs HTTP server
- Streamable HTTP transport — needs HTTP server
- Sampling (server-to-client LLM calls) — Gordon has its own LLM
- OAuth / authorization — needs HTTP server

**Status:** All five sit behind the Mastra HTTP server park. Tier 1
(resources + prompts + tasks) shipped.

**Revive on:** HTTP server park unlocks (see
`[[project_mastra_http_server_deferred]]` for revival conditions on
THAT side first).

### S11. CCXT native adapters opting into ExchangeExtended

**Module:** `src/infra/exchange/types.ts` +
`src/infra/exchange/adapters/`.
**Status:** `ExchangeDerivatives` / `Margin` / `AccountManagement` /
`OrderManagement` interfaces exist (commits `07757574`, `cc65c710`).
The CCXT adapter implements all four. Native adapters (Binance,
Coinbase, Kraken, OKX, etc.) do NOT.

**What's needed:** Per-native-adapter implementations of the
extended interfaces. Each adapter that opts in gets perps / margin /
inter-account-transfer / batch-order capabilities without operator
switching to `ccxt:<exchange>`.

**Risk:** Medium per adapter. Some exchanges have unique perp
mechanics (Hyperliquid's vault accounting, dYdX's L2 settlement)
that don't map cleanly to the CCXT-unified interface.

**Revive on:** Operator concretely wants perps on a native exchange
AND switching to `ccxt:<exchange>` loses something the native
adapter has (e.g., venue-specific orderbook stream).

### S12. Peer registry expansion — Hermes / Claude Code / Codex CLIs

**Module:** `src/infra/agents/peers/`.
**Status:** Cursor + Warp peers registered (commit `eca62df3`).
Hermes / Claude Code / Codex / OpenClaw CLI peers documented but
unverified.

**What's needed:** For each:
1. Verify the CLI supports headless invocation flag (`-p` /
   `--prompt` / equivalent)
2. Add `PEER_REGISTRY` entry with command + env requirements
3. Add CLI-specific test for `CliSubprocessPeer.send` behavior

**Risk:** Low per peer. Each is ~30 LOC + verification.

**Revive on:** Operator concretely uses one of these CLIs AND wants
`/delegate <peer>` routing.

### S13. NautilusTrader OUO / OTO contingency orders

**Module:** `src/infra/exchange/types.ts`'s `ExchangeExtended`.
**Memory:** none — discussed in NautilusTrader scan synthesis (no
saved memory entry yet).

**What's needed:** Add OCO (one-cancels-other), OUO (one-updates-
other), OTO (one-triggers-other) contingency order types to
`ExchangeExtended` interface. ~30 LOC interface, ~50 LOC per
implementing adapter.

**Risk:** Low. Additive interface; adapters that don't implement it
return `feature_not_supported`.

**Revive on:** Operator concretely runs bracket / conditional orders
AND wants the contingency semantics natively (vs. operator-managed
across multiple primitive orders).

### S14. OpenBB Platform Python data bridge

**Module would live in:** `src/infra/data/openbb-platform/`.
**Status:** OpenBB Workspace MCP added to catalog (commit `08b1a8f1`)
but the broader OpenBB Platform Python SDK isn't bridged.

**What's needed:** ~400 LOC bridge that exposes OpenBB's macro /
fundamentals / alternative-data surface to Gordon. Requires Python
subprocess execution + result parsing.

**Risk:** Medium. Python subprocess adds runtime dependency surface.

**Revive on:** Operator does macro / fundamentals analysis often
enough that the bridge pays off (estimated threshold: 3+ macro
queries per week).

### S15. Adversarial security eval scenarios

**Module:** `src/infra/domain/evals/harness/`.
**Memory:** `[[project_queued_adversarial_security_evals]]`.

**Status:** 3 hand-curated scenarios shipped. 5 adversarial
scenarios queued in memory but not built:
- Credential-leak
- Permission-bypass
- Deny-list-circumvention
- Cross-agent-tool-boundary
- Injection-resilience

**What's needed:** Per scenario: trajectory captures of the attack
+ judge rubrics for "did the safety stack hold?"

**Risk:** Low. Read-only evals. Failure surfaces as eval-regression
signal.

**Revive on:** Next eval-harness expansion pass — natural batch.

### S16. Alpha Tier 2 — IC-weighted signal blending in riskClassifier

**Module:** `src/core/alpha/` + `src/infra/trading/risk/riskClassifier.ts`.
**Status:** Tier 1 diagnostic stack (IC tracker + effective N + IR
diagnostic + composite attribution + walk-forward IC + cost-aware
edge) shipped across `50dac2a5` + `fa41c2a4`. Static dimension
weights in `riskClassifier`.

**What's needed:**
- Weight-update mechanism reading per-dimension IC from `ic-tracker`
  over a rolling window
- Replace static `dimension.weight` with `staticWeight ×
  icMultiplier` where multiplier scales with measured IC
- A/B harness comparing static-weight vs. IC-weighted classifier
  verdicts on historical trades

**Risk:** High. Changes classifier behavior. Could fit noise. Needs
A/B validation before flipping default-on.

**Revive on:** Concrete evidence static weights are sub-optimal vs.
IC-rolling weights (needs A/B data on historical trade outcomes).

### S17. FinceptTerminal cross-tool compatibility note

**Module:** N/A — documentation only.

**What's needed:** ~5-line note in `CLAUDE.md` or a future
`docs/integrations.md` confirming Gordon's MCP server is compatible
with FinceptTerminal's node editor for cross-tool workflows. Closes
a thread the operator was considering but never decided.

**Risk:** None.

**Revive on:** Operator concretely uses FinceptTerminal alongside
Gordon, OR ships a public integrations doc.

### S18. Custom event-replay catalog management

**Module:** `src/backtest/event-replay/catalog.ts` ships 4 canonical
events. Operator can't add their own without editing the source.

**What's needed:**
- Storage path under `~/.gordon/event-catalog/` for operator-
  authored events
- Loader that merges canonical + operator events
- `/events add` / `/events list` slash commands

**Risk:** Low. Additive surface.

**Revive on:** Operator concretely wants to stress-test against an
event not in the canonical four (likely candidates: 1987 crash for
indices, 1992 ERM crisis for GBP, 2010 flash crash, 2022 LDI gilt
crisis).

### S19. Jane Street "formal methods" frame

**Module:** N/A — speculative future direction.
**Memory:** `[[project_jane_street_validation]]`.

**Status:** From Yaron Minsky's interview transcript — Jane Street
building a formal-methods team because AI tooling makes mathematical
proofs of software correctness scaler-relevant again.

**Potential Gordon analog:** Mathematical proofs of trading-strategy
invariants. e.g., "this strategy never holds more than X% of
portfolio in any single position" should be a provable invariant,
not a runtime check.

**Risk:** Very high implementation cost. Research-level work.

**Revive on:** Almost certainly never at retail-Gordon scale. Could
be a Pro pilot demand signal.

### S20. Workspace snapshot pattern for training data

**Module would live in:** `src/infra/safety/workspaceSnapshot.ts`.
**Memory:** `[[project_jane_street_dev_tools]]`.

**Status:** Not started. Adapted from John Kzi's Jane Street AID
talk — they capture developer workstation state every 20 seconds
+ build status, then mine green→red→green patterns as isolated-
change training data.

**Potential Gordon analog:** Snapshot session state at intervals
(active plan, open positions, recent trades, market context) +
operator-decision events (plan approved / rejected, trade executed
/ cancelled). Mine the same green→red→green pattern: where did the
operator have a workflow that broke and then was fixed? That's an
isolated-decision training example.

**What's needed:**
- Snapshot writer with operator-tunable interval (default 20s)
- Pattern miner that walks snapshots looking for state transitions
  matching "broke → fixed"
- Privacy guard — operator-controlled retention + auto-truncation

**Risk:** Medium. Data volume can grow fast; needs retention policy.

**Revive on:** Gordon training a custom operator model (only
meaningful at Pro pilot scale OR with explicit model-fine-tuning
roadmap).

### S21. CES unification — single Strategy Evaluation Service primitive

**Module would live in:** `src/backtest/evaluation-service/`.
**Memory:** `[[project_jane_street_dev_tools]]`.

**Status:** Gordon has three modules with the same pattern (warm
state → apply candidate → check verdict → report metrics):
- `src/infra/domain/evals/harness/` (RULER eval for agent quality)
- `src/backtest/engine.ts` (backtest engine)
- `src/backtest/event-replay/engine.ts` (historical-break replay)

John Kzi's "CES" framing identifies this as a generic primitive
worth unifying. Unifying = bookkeeping, not new capability.

**What unification would deliver:**
- Single `EvaluationService` interface with `warmState`,
  `applyCandidate`, `verdict`, `reportMetrics` method shape
- Shared infrastructure for worker pooling, candidate scheduling,
  result aggregation
- Easier to add new evaluators (e.g., signal-evaluator, strategy-
  variant-evaluator) without re-implementing the harness

**Risk:** Low — refactor of existing modules.

**Revive on:** When Gordon adds a fourth evaluator and the
duplication becomes painful. Until then, three modules with similar
shapes is cheaper than premature unification.

### S22. "What changed" tool — incident debugging surface

**Module would live in:** `src/app/slash/commands/whatChanged.ts`.
**Memory:** `[[project_jane_street_production_engineering]]`.

**Status:** Not started. Jane Street has a tool called "what
changed" — type in a system name, get back binary changes + config
changes + metadata changes during incident response.

**What's needed:**
- Slash command `/changed <module-or-path>` that aggregates:
  - Recent git commits touching the path
  - Recent config diffs (env vars, `.gordon/` config files)
  - Recent skill metadata changes (lastReviewed updates)
  - Recent trade-ledger entries scoped to the affected module
- Filter by time window (default 24h)
- Operator-readable timeline output

**Risk:** Low. Mostly UX over `git log` + existing JSONL ledgers.

**Revive on:** First operator incident where "what changed in
Gordon today?" takes > 5 minutes to answer manually.

### S23. Pre-market readiness check — automated pre-deployment audit

**Module would live in:** `src/infra/safety/readinessCheck.ts`.
**Memory:** `[[project_jane_street_production_engineering]]`.

**Status:** Not started. Mark's incident postmortem question:
"Could we have caught this 20 minutes earlier with pre-open
trading or other alerting?"

**What's needed:** Automated audit before live trading session:
- Skills validation: `runSkillAudit` returns `clean`
- Backtest health: last backtest result has no `too_good_to_be_true`
  verdicts via `checkTooGoodToBeTrue`
- Event-replay verdict: most-recent canonical-event replay verdict
  is `pass` for the strategy about to deploy
- Required configs: all expected env vars + `.gordon/` config files
  present + non-empty
- Exchange health probe: ping each configured venue, log latency
- Verdict: `ready` / `needs_attention` / `block_deployment`

**Risk:** Low. Read-only check; failure mode is verbose output the
operator reads before opening the live session.

**Revive on:** Operator starts running live sessions regularly (Pro
pilot or daily-trader operator profile).

### S24. Cascade-alert deduplication

**Module would live in:** `src/infra/safety/alertDedup.ts`.
**Memory:** `[[project_jane_street_production_engineering]]`.

**Status:** Not started. Mark explicitly admitted Jane Street
doesn't solve this well: "If anyone's solved it, talk to me
afterwards." Symptom-based alerting mitigates the problem but
doesn't eliminate it.

**What's needed:** When N similar alerts fire within a time window,
collapse them into one notification with a `repeated × N` suffix.
Same-source same-symptom alerts get aggregated; orthogonal alerts
still fire independently.

**Risk:** Medium. Aggregation logic itself can hide signal — the
N+1th alert in a cascade may be the real one.

**Revive on:** Operator hits real-world cascade scenario and wants
deduplication. Not before — premature deduplication is worse than
no deduplication.

### S25. Investigation / fork orchestrator integration

**Module:** `src/infra/agents/investigation.ts` +
`src/infra/agents/contextFork.ts` (primitives shipped in commit
`1f1d5c3d`).

**Status:** Primitives ship dependency-injected with unit tests.
Orchestrator does NOT yet decide when to delegate to an
investigation vs. running tools inline.

**What's needed:** Heuristic + plumbing in `orchestrator.ts` that
detects "this looks like a read-only multi-step investigation"
and routes through `runInvestigation` instead of consuming the
orchestrator's own context. Candidate signals:
- Task description matches "scan", "find", "research", "analyze
  X across N", "summarize"
- Expected tool calls > offload-threshold from `runtimeHarness.ts`
- Operator explicit `/investigate <task>` slash command

**Risk:** Medium. Wrong heuristic → unnecessary sub-agent overhead
(extra prompt-cache warm-up, extra LLM call). Right heuristic →
substantial context savings on long autonomous loops.

**Revive on:** Operator session crosses the context-compaction
threshold from inline tool work that would have fit cleanly into
an investigation hand-off.

### S26. Context-timeline TUI surface

**Module:** `src/infra/agents/contextTimeline.ts` (data layer
shipped in commit `1f1d5c3d`); TUI consumer not yet wired.

**Status:** Registry + snapshot + formatter exist. Surface lives
only as text; no operator-visible visualization in the live TUI.

**What's needed:**
- TUI component that subscribes to a periodic `captureContext
  Timeline()` poll (e.g., every 1s during autonomous loops)
- Render active agents as a tree (parent → child) with token
  budget bars
- Optional `/timeline` slash command for one-shot text rendering
  (uses `formatContextTimeline` already shipped)

**Risk:** Low — UI-only, registry data is read-only.

**Revive on:** Operator running long autonomous loops where
context-pressure debugging would benefit from real-time visibility.

### S28. Venue MEV-exposure auto-population in pre-trade flow

**Module:** `src/infra/trading/risk/venueMevExposure.ts` (shipped) +
`riskClassifier.ts` 13th dimension (wired).
**Memory:** `[[project_budish_market_design.md]]`.

**Status:** The primitive + classifier dimension ship. Callers must
manually pass `venueMevExposure` in the `PortfolioContext` for the
dimension to fire. The execute_plan flow doesn't yet auto-populate
it from the trade's resolved venue.

**What's needed:** In `execute_plan` (or the upstream planner), look
up `classifyVenue(trade.venue)` and inject the result into the
classifier context. ~20 LOC.

**Risk:** Low. Read-only lookup, dimension is additive.

**Revive on:** First operator trades a DEX/AMM venue and asks why
the riskClassifier didn't flag MEV exposure.

### S29. Internal-batch + auction-deferral consumer integration

**Modules:** `src/infra/trading/execution/internalBatch.ts` +
`src/infra/trading/execution/auctionWindow.ts` (both shipped).
**Memory:** `[[project_budish_market_design.md]]`.

**Status:** Pure-function primitives ship. No caller in the
execute_plan or autonomous-loop flow consumes them yet.

**What's needed:** Two integration points:
- Before submitting a multi-order batch to external venues, run
  `computeInternalBatch(orders)` and replace external orders with the
  residuals. Audit each internal crossing.
- For non-urgent orders, call `suggestAuctionDeferral(venue, options)`;
  when shouldDefer is true, schedule the order for the auction time
  instead of immediate execution.

**Risk:** Medium. Internal-batch netting changes the execution
semantics — operator may want bookkeeping where the original orders
are visible. Auction-deferral changes timing — operator must opt in
to non-urgent execution.

**Revive on:** Operator runs autonomous loop that generates basket
orders OR Pro pilot needs portfolio-rebalance internal crossing.

### S31. Bias-aligned position sizing in position-sizer.ts

**Module:** Extension of `src/core/risk-management/position-sizer.ts`.
**Memory:** N/A — implementation gap from intraday-trader thread.

**Status:** Not started. Discretionary trader pattern: when the
strategy's expected behavior matches the current regime, bet larger;
when out of sync, bet smaller. Gordon's `position-sizer.ts`
currently considers Kelly + cost-aware Kelly but does NOT modulate
size based on strategy-regime alignment.

**What's needed:**
- New input field `regimeAlignment: "aligned" | "neutral" | "misaligned"` on `KellyResult` callers
- Multiplier table (operator-tunable, default `aligned: 1.25, neutral: 1.0, misaligned: 0.5`)
- Apply multiplier after Kelly cap, before final position size
- Audit-trail entry recording the alignment decision + multiplier

**Risk:** Medium. Requires the caller to declare strategy-vs-regime
alignment, which is operator-side judgment. Default-on would be
risky; should be opt-in via env flag or explicit caller field.

**Revive on:** Operator concretely declares strategy regime
preferences AND demonstrates that misaligned-regime trades
underperform the operator's aligned-regime trades by a meaningful
margin (use the existing `expectancy-by-tag` for this measurement).

### S32. Rule-Break Detector

**Module would live in:** `src/core/alpha/rule-break-detector.ts`
(plus an agent-callable diagnostic wrapper if wired).
**Memory:** Spicy's "Reverse-Engineered Profitable Trading" article —
Stage 2 first improvement-process step: "find every trade where you
broke the rules of your strategy."

**Status:** Not started. Companion to the just-shipped
`trade-consistency.ts` and `constraint-identifier.ts`. While
`trade-consistency` measures self-consistency across recent trades
(do they look the same?), the rule-break detector compares actual
execution against the declared playbook rules (are they doing what
the playbook says?). Two different questions.

**What's needed:**
- A stable playbook-rule schema: declared entry trigger, declared
  stop placement rule (e.g. "swing low + N ticks"), declared target
  derivation, declared session/timeframe constraints.
- Per-trade compliance check: did the trigger condition actually fire
  at entry? Was the stop within tolerance of the rule? Was the target
  derived from the rule?
- Output: per-trade `pass | fail` + per-rule break-rate over rolling
  window + dominant rule-break category.
- Composes with `constraint-identifier`: if the dominant constraint
  is win-rate but the rule-break rate is high, the constraint isn't
  edge — it's discipline.

**Risk:** Medium. Hinges on a playbook-rule format that doesn't
exist yet — Gordon has playbooks as markdown + strategy recipes as
TypeScript classes, but neither exposes the predicates in a form
the detector can mechanically diff against. Premature build before
the schema stabilizes will produce a brittle detector.

**Revive on:** Playbook-rule format stabilizes enough to be parseable
by a deterministic check, OR the operator explicitly declares the
rule predicates for a single playbook as a pilot. Honest reading:
this likely arrives alongside the broader "playbooks-as-code"
initiative, not standalone.

### S33. RSI Pullback-In-Trend Signal Primitive

**Module would live in:** `src/core/alpha/rsi-pullback-in-trend.ts`
(plus agent-callable diagnostic wrapper if wired).
**Memory:** Quantified-Strategies "RSI 30-50 Zone for Swing Trading"
article (Connors-style: RSI(5) crosses below 30 in an uptrend → long
→ exit at RSI=50).

**Status:** Not started. Looks partly covered by existing tier-2
strategies (`ema-rsi-crossover.ts`, `mfi-divergence-confluence.ts`,
`bollinger-bounce.ts`) but those are end-to-end strategies, not
composable primitives. A clean Connors-shape primitive would emit:
- pullbackArmed (RSI entered the 30-50 band in an uptrend)
- pullbackComplete (RSI reaching the configured exit level, e.g. 50)
- pullbackInvalidated (trend filter flipped while pullback active)

**What's needed:**
- Trend filter input (caller supplies; usually MA-cross or regime
  classifier output — Gordon has both)
- RSI(N) computation (already in `core/indicators`)
- State machine with armed → complete | invalidated transitions
- Composes with `margin-of-error` (in-sync long only when bias is
  long-favoring + structural is trending)

**Risk:** Low. The math is standard; the gap is just packaging.
The risk is REDUNDANCY: this overlaps materially with several
existing tier-2 strategies and may not justify a fresh primitive
unless the composability gain is concrete (e.g. wanting to use the
signal in an agent tool independent of any specific strategy).

**Revive on:** Operator wants RSI-pullback as a composable building
block usable by the agent independent of any tier-2 strategy file,
OR an honest grep audit of the existing tier-2 strategies shows the
Connors shape isn't already there as a reusable function.

### S34. MAU&R (Moving-Average Undercut & Rally) Pattern Detector

**Module would live in:** `src/core/alpha/mau-and-r.ts` (plus
diagnostic wrapper if wired).
**Memory:** Qullamaggie playbook — tightest-stop entry in the surf
hierarchy ("MA undercut + snap back" = up to 8:1 R:R baseline,
47:1 in the SNDK 50-SMA example).

**Status:** Not started. Intraday pattern: price undercuts the rising
MA (10/21/50), volume DRIES UP on the undercut, then snaps back above
the MA before the close. Operator enters at the snap-back with stop
just below the undercut wick.

**What's needed:**
- Intraday bar stream (or daily bars with intraday-low data)
- Three-step state machine: armed (price approaching MA from above)
  → undercut (intraday low below MA, volume below window-baseline)
  → snapped (close ≥ MA after the undercut)
- Optional confirmation: volume on the snap-back must be ≥ N×
  undercut-bar volume (institutional reclaim signature)
- Composes with `classify_ma_proximity` (the MAU&R is the highest-
  R:R entry on whichever MA the symbol is surfing)

**Risk:** Medium. Likely overlaps `bounceCounter.ts`, several tier-2
strategy files, and the existing FAE/FTA infrastructure. Worth a
grep audit BEFORE building — the value-add over what already exists
may be marginal once the existing pieces are stitched together.

**Revive on:** Honest grep audit confirms the MAU&R shape isn't
already reachable through existing primitives, OR operator
specifically wants this as a standalone agent-callable tool for
intraday execution.

### S35. Campaign Tracker

**Module would live in:** `src/infra/safety/campaignTracker.ts`
(plus trade-ledger schema extension).
**Memory:** Qullamaggie playbook — "Campaigning Winners" framing
(HVE entry → trim → reload on MA pullback → add on new base → ride
through earnings → final close-below-10-SMA exit). Single
multi-entry trade lifecycle that aggregates R metrics across the
entire campaign rather than per-fill.

**Status:** Not started. Gordon's trade ledger tracks individual
executions; nothing yet aggregates multi-entry, multi-trim sequences
on the same symbol into a campaign view.

**What's needed:**
- Trade-ledger schema extension: optional `campaignId` field on
  ExecutionRecord, linking fills to a parent campaign
- Campaign state machine: started → active → partially-trimmed →
  re-added → closed
- Aggregate R computation: initial-entry-relative R, cumulative
  realized R across all trims, current open R on the residual
- Add-point validation: composes with the rules in the Qullamaggie
  playbook (first pullback to rising 10/21, MAU&R, 50-SMA MAU&R,
  new tight base, century mark, 2nd earnings beat, HV1→HVE staircase)
- Composes with `expectancy-by-tag` (tag campaigns by playbook so
  per-campaign expectancy can be measured separately from per-trade)

**Risk:** Higher. The implementation is straightforward but the
trade-ledger schema change ripples through every downstream
consumer (expectancy-by-tag, audit JSONL, position tracker,
risk classifier). Worth doing only when the operator has enough
multi-entry campaigns in the ledger to make the analytics useful.

**Revive on:** Operator has run ≥ 5 multi-entry campaigns AND
expressed that single-trade analytics no longer answer their
"how did this name actually do?" questions. Until then,
per-trade analytics + manual tagging are adequate.

### S39. Sparse-Trading Fair-Value Inferrer

**Module would live in:** `src/core/alpha/sparse-fair-value.ts`
(plus diagnostic wrapper if wired).
**Memory:** Matt (TD muni market-making) podcast — pricing a bond
that trades once every three weeks requires k-NN-style regression
over feature vectors of comparable instruments that DO trade.

**Status:** Not started. Operator-input checklist primitive: for a
target instrument with feature vector + a corpus of recently-traded
comparable instruments with their own feature vectors + recent trade
prices, infer the target's fair value via weighted nearest-neighbor
regression. Returns point estimate + confidence interval based on
neighbor count and feature distance.

**What's needed:**
- Feature-vector format (operator-supplied per instrument)
- Distance metric (Euclidean / cosine / categorical-aware)
- Weighting kernel (Gaussian / inverse-distance / nearest-k)
- Confidence interval from neighbor dispersion
- Composes with `strategy-claim-verifier` (operator can audit whether
  the inferrer's fair-value predictions actually came true on
  subsequent trades)

**Risk:** Borderline as a primitive. The math is essentially generic
k-NN regression; the value-add depends entirely on the operator's
feature engineering. Could feel close to a "tabular regression"
primitive rather than something Gordon-specific.

**Revive on:** Operator faces a concrete illiquid-instrument
pricing problem (small-cap stocks, niche tokens, OTC instruments,
private-credit-like assets) AND has prepared feature vectors for
the comparable set. Until then, this is generic tabular regression
that any operator can do externally and feed into Gordon's
audit primitives.

### S36. Two-Stage SMT Composition

**Module would live in:** `src/core/alpha/two-stage-smt.ts` (plus
diagnostic wrapper if wired).
**Memory:** ICT-derived "two-stage SMT" concept — HTF level-anchored
SMT divergence + displacement away from the level + LTF confirmation
(either another SMT or a PSP) → composite reversal verdict.

**Status:** Not started. The two component primitives shipped in
commit feat(alpha): smt-divergence + psp-detector. This S36 is the
orchestration wrapper that chains them into a two-stage state
machine: armed (HTF SMT printed) → displaced (price moved away from
swept level) → confirmed (LTF SMT or PSP printed) → reversal_in_play.

**What's needed:**
- State machine with the four stages above
- HTF window inputs (daily/weekly OHLC windows) + level inputs
- Displacement check — price moved ≥ N×ADR away from the swept level
  within M bars after the HTF sweep
- LTF SMT or PSP confirmation — composes with the two shipped tools
- Output: stage label + aggregate confidence verdict + recommended
  entry / stop / target geometry

**Risk:** Low. Both component primitives are already in core/alpha.
The composition is mostly orchestration glue with no new math.
Defer-reason is sequencing: better to let operators use the two
component primitives independently first and see whether the
two-stage chain actually adds edge over single-stage SMT/PSP.

**Revive on:** Operator has accumulated logs from single-stage
`analyze_smt_divergence` and `detect_psp` calls AND has data showing
that two-stage chains have measurably higher signal quality than
single-stage. Alternatively, revive when operator explicitly wants
the composition as a single tool call for ergonomics.

### S37. Token-Unlock Schedule Analyzer

**Module would live in:** `src/core/alpha/token-unlock-analyzer.ts`
(plus diagnostic wrapper if wired).
**Memory:** Drogan / Starkiller framing — "every time tokens pump,
there are more tokens trying to exit into those pumps because of
the unlock schedule. Understanding the unlock schedule + where you
are in it is a source of alpha on both the long-filtering and the
short-side."

**Status:** Not started. Requires per-token unlock schedule data +
dilution analysis. Outputs: % of total supply already unlocked, %
unlocking within the next N days/weeks, dilution-pressure verdict
(low / moderate / high / extreme). Composes with `cross-sectional-
momentum` (filter out long basket members under heavy unlock pressure)
and `detect_streak` (extreme upside streaks during heavy unlock =
short candidate).

**What's needed:**
- Unlock-schedule data input shape (operator supplies per-token
  schedule; primitive doesn't fetch data)
- Window analysis: current % unlocked, % unlocking next 30/90 days
- Dilution-pressure verdict bands
- Output composes with momentum-ranker basket filtering

**Risk:** Low. The math is straightforward; the gap is the data
ingestion path. Most operators don't have clean per-token unlock
schedules wired into Gordon's data pipeline.

**Revive on:** Operator has unlock-schedule data wired into Gordon
or explicitly wants the primitive as a checklist tool with manually-
supplied schedules.

### S38. Yield-Source Sustainability Classifier

**Module would live in:** `src/core/alpha/yield-source-classifier.ts`
(plus diagnostic wrapper if wired).
**Memory:** Drogan / Starkiller framing — "no magic money trees; you
need to know where the yield comes from + how long it lasts."
Categorizes yield sources by sustainability + dependence on external
incentives.

**Status:** Not started. Operator-input checklist primitive: for a
given DeFi yield opportunity, classify the source as one of:
incentivized (governance-token rewards / external bribes),
structural (fees from real economic activity), arbitrage (basis,
funding, cross-venue spreads), lending (collateralized lending
spread), or hybrid. Output: sustainability verdict + estimated
half-life of incentive + dependency map.

**What's needed:**
- Taxonomy of yield-source types
- Per-type sustainability heuristics (e.g. incentivized = decays
  with token-emission schedule + market valuation of governance
  token; structural = sustainable while underlying activity exists)
- Composability with operator's yield-tracking ledger

**Risk:** Low primitive itself; depends on operator-supplied
classification (it's a structured taxonomy, not a derivation).
Could be more useful as a skill / checklist than a primitive.

**Revive on:** Operator explicitly building a multi-protocol DeFi
yield book and wants structured sustainability scoring across N
positions, OR Pro-pilot operator needs this as a structured input
to a yield-book report.

### S30. CoW Swap MCP catalog entry

**Module would live in:** `src/infra/ai/mcp/marketplace/catalog.json`.
**Memory:** `[[project_budish_market_design.md]]`.

**Status:** Not started. CoW Swap is the canonical MEV-protected
swap aggregator (Budish is a technical advisor). Adding it to
Gordon's MCP marketplace lets the operator route swaps through a
venue that classifies as `protected` in the MEV-exposure dimension.

**What's needed:** ~30 LOC catalog entry following the same shape
as the OpenBB Workspace MCP entry shipped in commit `08b1a8f1`.

**Risk:** Trivial. Read-only catalog addition.

**Revive on:** Operator does swaps and wants explicit MEV-protected
routing.

### S27. Agent-step adapter from Mastra orchestrator

**Module would live in:** `src/infra/agents/mastraAgentStepAdapter.ts`.
**Memory:** N/A — implementation wiring.

**Status:** Not started. The `runInvestigation` + `forkContext`
primitives take an `agentStep` callable injected by the caller.
Tests use a scripted mock; runtime needs a real adapter that calls
into Mastra's agent loop with the correct tool subset + message
history.

**What's needed:**
- Construct a Mastra agent on the fly with the supplied tool
  subset (filtered against Gordon's tool catalog)
- Run one round of the loop with the supplied messages
- Translate Mastra's stream events back into the
  `InvestigationAgentStepOutput` shape
- Honor cache-prefix sharing via `sharedPrefixCache.ts` so
  sub-agents are cheap on input tokens
- Wire `recordAgentStart` / `recordAgentProgress` / `recordAgentEnd`
  around the call

**Risk:** Medium. Mastra-version-coupled — adapter likely needs to
track Mastra release cadence. Patched `lastMessages: 10` discipline
must hold for sub-agents.

**Revive on:** S25 lights up. Until then this adapter has no
caller.

---

## Index of related memory entries

Items in this section reference the following memory entries (under
`~/.claude/projects/.../memory/`):

- `[[project_event_replay_tier_2_3_deferred]]` — S1, S2
- `[[project_mastra_http_server_deferred]]` — S10
- `[[project_mastra_browser_deferred]]` — adjacent (no entry here)
- `[[project_queued_adversarial_security_evals]]` — S15
- `[[project_mang_group_skills_governance]]` — context for S3–S6
- `[[project_jane_street_validation]]` — context for S19 + general framing
- `[[project_dual_edition_strategy]]` — Pro-pilot revival conditions
- `[[operator-class-agent-frame]]` — positioning context for prioritization
