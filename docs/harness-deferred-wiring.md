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
