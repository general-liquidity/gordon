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

### B3. Termination layers in `execute_plan` ⚠ highest risk

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

### C1. `shadowMode` subscription to `strategy:plan_ready`

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
