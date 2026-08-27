# Gordon CLI — Claude Code Onboarding

This file briefs Claude Code sessions opened against the Gordon repo. It captures the conventions, layout, and invariants that aren't obvious from `package.json` or a quick `ls`.

## What Gordon is

Gordon is a TypeScript trading agent on Bun + Mastra. It connects to crypto exchanges (Binance, Coinbase, Kraken, OKX, …) and equity brokers (Interactive Brokers, Alpaca, tastytrade), proposes trades, runs backtests, scans markets, and hosts a proactive radar that fires cards on news / regime / volatility / trade events.

It is **not** a coding agent. Most patterns from Claude Code's coding-agent design map onto Gordon's trading domain only loosely. When porting ideas, ask "does this make sense for trading or only for editing files?" before assuming.

## Repository layout (the bits worth knowing)

| Path | What lives there |
|---|---|
| `src/infra/agents/definitions/` | The 3 actual agents — `gordon.ts` (orchestrator/router), `executor.ts`, `researcher.ts` |
| `src/infra/agents/tools/` | All Mastra tools, organized by domain (market, account, trading, news, …) |
| `src/infra/agents/tooling/instrumentedTools.ts` | Single registration point — wraps every tool with metrics + spill |
| `src/infra/agents/orchestrator.ts` | Orchestrator entry — stream processing re-exported from `orchestrator/` modules |
| `src/infra/agents/orchestrator/` | Split orchestrator internals — `streamProcessor.ts`, `HandoffCoordinator.ts`, `toolAgentMap.ts`, `guardrailEvaluator.ts`, … |
| `src/infra/agents/context/sharedPrefixCache.ts` | Anthropic prompt-cache reuse across sub-agents (see also `context/promptCacheAudit.ts`, `ai/llm/providerCaching.ts`, `runtime/kvCacheHitMetric.ts`) |
| `src/infra/agents/cognition/thinkingPhase.ts` | Tool-free pre-action reasoning pass (separate LLM call) |
| `src/infra/agents/cognition/extendedThinking.ts` | In-band Anthropic native `budget_tokens` helper |
| `src/infra/agents/cognition/critiquePhase.ts` | Critique/refine pass at HIGH thinking depth |
| `src/infra/agents/harness/runtimeHarness.ts` | Doom-loop detection, tool-result limits, fingerprinting |
| `src/infra/domain/memory/summarizer.ts` | 5-stage compaction at 70/80/90/94/99% pressure (masking / pruning / aggressive / collapse / full) |
| `src/infra/domain/memory/contextCollapse.ts` | Collapse-stage implementation — non-destructive read-time projection of stale tool results |
| `src/infra/hooks/` | Hook engine + lifecycle types (PreToolUse, PreOrderPlacement, …) with `asyncRewake` and `statusMessage` |
| `src/infra/news/` | RSS headline fetcher (12 crypto + Yahoo + EDGAR) + sentiment classifier |
| `src/infra/proactive/producers/` | Radar producers (news, regime, volatility, funding, stock events, …) |
| `src/infra/trading/risk/riskClassifier.ts` | Pre-trade risk classifier — 15 dimensions (8 base + 7 optional hedge-fund-grade) including vol-adjusted sizing, tail risk, correlation |
| `src/runtime/permissions/PermissionEngine.ts` | Deny-first permission gate; exposes `registerHook` / `prependHook` |
| `src/runtime/permissions/trustTrajectory.ts` | Adaptive auto-approval with safety-critical deny-list |
| `src/core/strategies/recipes/` | Pure signal-processing primitives (regime-RSI, bounce counter, signal gate, max-exposure timeout) |
| `src/core/regime/` | Market regime detector + classifier |
| `src/core/playbooks/builtin/` | Built-in trading playbooks (markdown) |
| `src/core/risk-kernel/` | Risk audit trail |
| `src/app/slash/slashCommands.ts` | Slash command definitions (programmatic, not markdown) |
| `src/gateway/` + `src/core-sdk/` | Gateway daemon, protocol envelopes, scheduler — headless/SDK surface alongside TUI |
| `src/app/acp-entry.ts` | ACP (Agent Client Protocol) implementation — launch through `npm run acp` / `bin/gordon.cjs` |
| `src/tui/` | Ink-based custom TUI with framebuffer + vim mode |
| `src/events/market-events.ts` | Event bus types — `strategy:plan_ready` lives here |
| `scripts/patches/patch-mastra.cjs` | Postinstall patch for Mastra `lastMessages` cap on sub-agents |
| `.claude/skills/` | Built-in user-level skills (loaded via skill-loader tool) |

## Memory system

Persistent memory lives at `~/.claude/projects/C--Users-adria-Downloads-gordon-cli-alpha/memory/`. The index is `MEMORY.md`; individual notes are file-scoped markdown with frontmatter (`type: user | feedback | project | reference`). Read this first when picking up a session — it has the architectural decisions, prior corrections, and what's already been built.

**Critical invariant** captured there: **before claiming Gordon is missing a feature, grep the codebase first.** This has been wrong twice (pre-trade safety classifier, plan mode — both already shipped). External-design comparisons (Claude Code papers, OPENDEV, Gekko) tend to surface false-positive gaps. Verify file paths before listing anything as missing.

**Hot-tier discipline (Hermes pattern).** Working memory is the only memory layer injected into every prompt — keep it small, durable, and stable:
- `WORKING_MEMORY_TEMPLATE` in `memoryFactory.ts` holds ONLY durable trader-profile fields (risk prefs, venue, account type, market focus). Session state lives in the thread, not the hot tier.
- Hot-tier writes are capped at `MAX_WORKING_MEMORY_CHARS = 2200` by `memoryGate.ts` (truncates on write, never throws). Matches Hermes's MEMORY.md cap.
- **Semantic recall is disabled by default.** Cold recall goes through `searchMemoryTool` / `getMemoryContextTool` / `getLessonsTool` (memory-tools.ts) — model-decides, not ambient injection.
- Optional `GORDON_DEFER_WORKING_MEMORY=1` buffers mid-session writes to preserve prompt-cache stability; flush via `flushDeferredWorkingMemoryWrites(memory)` at session boundaries (`/clear`, post-compression, thread close). Last-write-wins per (threadId, resourceId).

Why: the "Reverse-Engineering Memory" pattern survey identifies "always-inject" working memory as the dominant failure mode (ChatGPT taxonomy). Gordon previously held session-state fields in the always-injected tier; those have been removed.

## Key conventions

- **Commits:** Conventional-commit prefix. Do **NOT** add `Co-Authored-By: Claude` to commit messages.
- **Imports:** Use `.ts` extensions on relative imports (Bun convention).
- **Tests:** `bun test <path>` — bun:test, no jest. Co-located `*.test.ts` files.
- **Typecheck:** `bun tsc --noEmit -p tsconfig.json`. Must be clean before commit.
- **Runtime entrypoints:** use `node bin/gordon.cjs`, `npm run acp`, or `npm run mcp`. Raw Bun execution of `src/entry.ts`, `src/index.tsx`, ACP, or MCP source is unsupported because a cwd `bunfig.toml` preload runs before Gordon code.
- **Tool offload limit:** 1800 chars per result by default; per-family overrides in `runtimeHarness.ts` (market/account/order tools get higher limits).
- **Doom-loop detection:** Sliding 20-call window, threshold 3 identical fingerprints — see `recordToolCallFingerprint` in `runtimeHarness.ts`.
- **Compaction thresholds:** 70/80/90/94/99% pressure → masking / pruning / aggressive / collapse / full summary. Recent observations preserved 6/6/3/3.
- **Permissions:** Never restored on resume — trust is re-established per session. `riskClassifier` returns `auto_approve | prompt_user | require_confirmation | block`. Trust-trajectory hook short-circuits the human-required queue for tools the user has approved consistently, but a hard deny-list (`place_order`, `execute_trade`, `cancel_order`, `wallet_transfer`, …) bypasses trust scoring.
- **Rationale on safety-critical tools:** `execute_plan` and all `cancel_*` order tools (`cancel_order`, `cancel_all_orders`, `cancel_replace_order`, `cancel_order_list`) take a required `rationale: string (min 10)` field. Logged via `recordStructuredObservation` with `eventType: "*.rationale_recorded"`. Borrowed from Ramp's MCP pattern — the audit log captures intent, not just the call. New cancel/execute tools should follow the same shape.
- **Agent self-feedback:** `report_blocked` tool (`agent-feedback.ts`) lets the agent proactively signal stuck-ness with structured intent + attempts + blocker BEFORE the doom-loop detector trips. Persists to `~/.gordon/agent-feedback.jsonl` (override `GORDON_AGENT_FEEDBACK_PATH`).
- **Routing agent:** Don't over-prompt. Adding "Routing Rules" to GORDON_INSTRUCTIONS breaks tool-call routing — Mastra's built-in routing prompt does it correctly.
- **Sub-agents:** Mastra hardcodes `lastMessages: 0` for sub-agents — patched to 10 via `scripts/patches/patch-mastra.cjs`. Sub-agents need `workingMemory: { enabled: false }` to prevent `updateWorkingMemory` injection crash.
- **Agent topology is deliberately centralized multi-agent** (gordon orchestrator → executor + researcher), NOT collapse-to-single-agent. The Stanford "default single-agent" + Google/MIT "tool-heavy multi-agent has 2–6x efficiency penalty" findings sound like they'd apply (Gordon has 200+ tools) but they don't: (a) the agents have *different* tool subsets scoped by permission boundary, not the same 200 tools per agent, (b) trading is a regulated/strict-verification domain where Google/MIT explicitly recommend centralized multi-agent for error containment (orchestrator cross-check reduces logical contradictions 36.4%, context omissions 66.8%), and (c) the split exists for safety (executor has execution permissions, researcher doesn't), which is not negotiable for efficiency reasons. Do not "fix" Gordon by merging executor/researcher tools into the orchestrator — that's a security regression dressed as an optimization.

## Eval harness

`src/infra/domain/evals/harness/` — RULER-pattern LLM-as-judge for agent quality. Distinct from `evals/tradeEvaluator.ts` which scores realized PnL after-the-fact.

**Scenarios are GENERATED, not hand-authored** (the hand-curated fixtures were deleted — they encoded one author's assumptions and drifted from the specs). `ALL_SCENARIOS = generateScenarios()` (`harness/generator/`) derives every scenario from an authoritative spec and stamps `derivedFrom` provenance on each, so a failure points straight back at the spec line and the suite auto-updates when a spec changes (ASSERT-style spec→eval, but deterministic — Gordon's "systematize/taxonomize" stages already live in code as typed tables). Four sources: the trading constitution (`constitution:<RULE>` → refuse/downsize breach scenarios, breach magnitude computed from the live limit), risk-classifier dimensions (`riskClassifier:<Dim>`), the safety-critical deny-list (`denylist:<pattern>`, imported from `trustTrajectory.ts` so it stays synced) + agent boundaries + injection, and the category rubrics (`categoryRubric:<cat>`, driven by the structured `CATEGORY_RUBRIC_DATA`). Add coverage by editing a spec source, not by writing fixtures. Optional opt-in LLM-paraphrase pass (`generator/paraphrase.ts`) naturalizes the user-inputs and caches to a committed artifact; the deterministic core stays the stable regression gate. Filter by `generateScenarios({ sources })` or `scenariosByProvenance(prefix)`.

```ts
import { runEvalSuite, detectRegressions, ALL_SCENARIOS } from "./infra/domain/evals/harness";

const result = await runEvalSuite({
  scenarios: ALL_SCENARIOS,
  variants: [baselineTrajectories, candidateTrajectories],
});
const report = detectRegressions(result.results[0], result.results[1]);
if (report.hasBlockingRegression) process.exit(1);
```

The harness is **trajectory-agnostic** — caller supplies pre-recorded trajectories per variant. No live Mastra spawn yet (deferred — running the orchestrator during eval has side effects on audit log + permission state). Workflow: capture trajectories from paper-mode runs, feed baseline + candidate to `runEvalSuite`, gate CI on `hasBlockingRegression`. Default judge `anthropic/claude-sonnet-4-6` — override via `judgeOptions.judgeModel`.

**Tri-judge panel (CREAO anti-bias pattern).** Pass `panelOptions: {}` to `runEvalSuite` instead of `judgeOptions` to route through `DEFAULT_PANEL` (Anthropic + OpenAI + Google in parallel via Dedalus). Failing judges drop from the consensus; the result is averaged across surviving members. A single judge can self-prefer its own family's outputs by ~0.3; cross-family averaging washes that out. Override panel composition via `panelOptions.panel: string[]`.

**Categorical rubrics.** Each scenario can set `category: "scan" | "analysis" | "planning" | "execution" | "education" | "recovery"`. The judge prompt then includes the matching rubric chunk from `categoryRubrics.ts` — domain-specific red flags + good signals, so "good planning" and "good analysis" are scored against different checklists. Borrowed from CREAO's "Job 0" router.

**Outcome over trajectory.** Judge prompt instructs scoring on final answer quality, not path efficiency — unusual paths are penalized only when they degrade the final output. Per the CREAO lesson: penalizing weird-but-correct paths is not robust.

**Review queue.** When `detectRegressions(..., { writeReviewQueue: true })` is set, regressions append as JSONL to `~/.gordon/eval-failures.jsonl` (override via `GORDON_EVAL_REVIEW_QUEUE_PATH`). Local fail-bucket: grep / promote into the gold scenario set. The "a score with no ticket is a dashboard" principle, scaled down for single-operator use.

**Process checks + pass^k (`harness/process/`).** The judge scores final text; `checkTrajectory(NormalizedTrace)` scores *process* deterministically over the audit trace's tool-call sequence — block-severity rules for `risk_gate_before_order` and `denylist_without_approval` (the catastrophic money-agent failures), warns for missing `approve_plan`, doom-loops, outcome inconsistency. No PRM needed — it's assertions over the recorded sequence. `computePassK` / `passKFromChecks` aggregate k runs (Sierra τ²-bench reliability metric); safety scenarios use mode `"all"` (safe on every run, not on average). pass^k consumes injected trajectories — the k-run producer is `scripts/dev/eval/eval-live-runner.ts` (`harness/live/` sandbox + `produceKRuns`); CI uses `GORDON_EVAL_DRY_RUN=1` for synthesized trajectories without live Mastra spawn.

**Production-trace → eval loop (`harness/traces/`).** SOTA continuous-eval, fed from REAL paper-mode captures (not LLM-simulated users — unreliable proxies per "Lost in Simulation" 2026). `traceAdapter.ts` converts a `core/audit` `AuditTrace` → NormalizedTrace (process checks) + EvalTrajectory (judge) + `promoteTraceToScenario` (freeze a flagged trace as a permanent `derivedFrom:"trace:<id>"` scenario). `traceScorer.scoreRecentTraces` samples traces, runs process checks, appends flagged ones to the promotion queue (`~/.gordon/eval-promotions.jsonl`, sibling of the review queue) for operator silver→gold triage.

**CI gate (`scripts/dev/eval/eval-gate.ts` + `.github/workflows/eval-gate.yml`).** Blocks PRs on three deterministic legs (structural suite integrity, gold-trace process checks via `GORDON_EVAL_GOLD_TRACES`, eval unit suite) + an opt-in LLM-judge regression leg that activates when `GORDON_EVAL_BASELINE`/`GORDON_EVAL_CANDIDATE` trajectory fixtures + keys are present. A prompt-drift guard (`generator/prompt-drift.test.ts`) cross-checks the generator's restated role prompts against the live `roles.ts` invariants.

## Tool tier convention (MANDATORY for new tools)

Every new `instrumentedXTools` registration added to `gordon.ts`, `executor.ts`, or `researcher.ts` MUST declare its tier. Three options:

- **Hot** (default — always loaded): plain `...instrumentedXTools` spread. Use ONLY for tools needed in routine scan / DD / risk-check / portfolio-monitor flows. Hot tier pays schema-token cost on every turn.
- **Cold** (loaded when `isHotTierOnly()` returns false): wrap with `...(isHotTierOnly() ? {} : instrumentedXTools)`. Use for niche / specialist tools (backtesting, deep research, alt-data, regulatory-jurisdiction-specific writes). Excluded when operator sets `GORDON_TOOL_TIER=hot`.
- **Skill** (loaded on demand via `list_skills` / `load_skill`): do NOT register in agent tools. Move workflow guidance to a SKILL.md under `src/infra/skills/builtin/`.

**The rule of thumb:** if a tool is invoked < 10% of the time in normal operation, it does not belong in hot tier. The audit at `scripts/dev/checks/check_tool_tiers.ts` (run via `bun run scripts/dev/checks/check_tool_tiers.ts`) flags new spreads in the three agent files that aren't tier-gated. PRs that add hot-tier tools without justification should be rejected.

Why this matters: Gordon's schema is already at 405 tools / ~45K tokens. Past published guidance for tool-selection accuracy (~30-50 tools per Anthropic/OpenAI), but mitigated by Anthropic prompt caching + the tier system. The convention exists to prevent further accretion without thought.

## Behavior flags

`/flags` (`KEEPER_FLAGS` in `infra/agents/tools/runtime/flow/system.ts`) is the registry, and its rows must mirror what each flag's READER does. `flagRegistry.test.ts` fails when a boolean gate under `src/infra/safety/` has no row, or when one of the default-on rows below is declared off.

**Default-on gates.** These read `raw !== "0" && raw !== "false"`, so an unset flag means ENABLED and the operator opts out with `0`/`false`:

| Env flag | Gate |
|---|---|
| `GORDON_KILL_SWITCHES` | Firm-wide / venue / strategy kill switches, checked before execution. |
| `GORDON_WIP_LIMIT_ENABLED` | Work-in-progress plan gate (N per symbol, M per strategy). |
| `GORDON_STREAK_CIRCUIT_BREAKER` | Consecutive-loss cooldown, enforced in `evaluateOrderRisk` via `infra/safety/preTradeHaltGates.ts`. Timed and self-expiring, NOT a kill switch; confirmed exchange outcomes and the trip timestamp are persisted in the authenticated halt ledger before the teaching log runs. Broker adapters do not yet provide a confirmed-close outcome feed, so the default-on gate fails closed for new live-broker risk; exposure reductions and paper-broker orders remain allowed, and live broker trading requires explicitly disabling this gate. Legacy unscoped debrief rows apply only to the explicit `default` identity. |
| `GORDON_GIVE_BACK_STOP` | Refuses new risk once the session gives back more than half its high-water P&L. Reads durable session equity from the authenticated per-portfolio halt ledger. |
| `GORDON_ABSORBING_BARRIER` | Distance-to-ruin gate plus the terminal loss fold. Dormant until the barrier inputs are configured. |
| `GORDON_NETWORK_ALLOWLIST` | Outbound-fetch allowlist (warn mode unless `GORDON_NETWORK_ALLOWLIST_MODE=block`). |
| `GORDON_FILESYSTEM_WRITE_GUARD` | Filesystem write guard (warn mode unless `..._MODE=block`). |
| `GORDON_TOOL_FREE_THINKING` / `GORDON_ADVERSARIAL_EVALUATOR` / `GORDON_CITATION_AGENT` | Reasoning passes, throttled by the cost budget. |
| `GORDON_AUTODREAM_ENABLED` / `GORDON_REFLECTION_ENABLED` | Background memory consolidation; post-trade reflection warm-up. |

The three order-time halt gates skip exposure-REDUCING orders. They exist to stop new risk, and a gate that prevented flattening would trap the operator in the position it was written to get them out of.

`GORDON_PRETRADE_RATE_CONTROLS_DISABLE` is the inverted case: the rate controls are default-on and this flag turns them OFF.

**Opt-in flags.** These require operator opt-in — they write across sessions, change spawn behavior, need operator-authored input files, or are calibrated thresholds.

| Env flag | Activates |
|---|---|
| `GORDON_ACE_ENABLED=true` | Activate ACE (Agentic Context Engineering): `/reflect` distills scoped action-log evidence into governed lessons. The active revision is injected into request context for the matching session/thread/resource on each prompt; it does not mutate the shared system prompt. Cross-session learning remains opt-in. |
| `GORDON_EXTERNAL_HOOK_RUNNER=1` | Install operator-defined lifecycle hooks from `GORDON_EXTERNAL_HOOKS_PATH` (default `~/.gordon/hooks.json`). Enabling the runner with a missing, malformed, empty, or partially invalid registry aborts startup. |
| `GORDON_ACP_ALLOW_STDIO_MCP=1` | Permit an ACP peer to forward stdio MCP server commands. Default deny because the command runs on the Gordon host; executable paths are validated and shell interpretation is not used. |
| `GORDON_ACP_VISION_PATH=inline` | ACP attachment mode. `inline` is the only supported production value while the LLM client boundary is string-only; `blocks` is refused explicitly rather than silently dropping image/audio payloads. |
| `GORDON_DYNAMIC_SUBAGENTS=1` | Enable the FW7 `delegate_subagent` dispatcher. Requires operator-authored `.claude/subagents/*.json` profiles. Sensitive because subagents spawn fresh agent instances. |
| `GORDON_PEER_DELEGATION=1` | Permit operator-requested `/delegate` calls to the Cursor or Warp CLI peer. Default off because this spawns an external agent process. Children receive only the base process environment and their peer-specific API key, and combined output is capped. |
| `GORDON_DEFER_WORKING_MEMORY=1` | Buffer mid-session working-memory writes to preserve prompt-cache stability; flush at session boundaries. Performance trade-off — see Hot-tier discipline section. |
| `GORDON_COMPACTION_STAGE` | Force a specific compaction stage during debugging. Read-only override; not a feature gate. |
| `GORDON_MEMORY_WRITE_GUARD=1` | Enforce (not just log) the working-memory sensitive-field guard: an untrusted-source write that changes a sensitive field (risk limits, venue, account type, base currency) is **blocked**, prior value preserved. Trusted paths (`recordTrustedProvenance`) pass; non-sensitive untrusted writes are unaffected. Default off — opt-in because aggressive enforcement could surprise flows that legitimately update profile via the LLM. |
| `GORDON_SPRINT_CONTRACT=1` | Record scope/actuals for autonomous-loop sessions (`infra/safety/sprintContract.ts`); inspect via `/sprint-status`. |
| `GORDON_AGENT_READINESS_GATE=1` | Adds boot-time readiness rows to the doctor report (`infra/diagnostics/agentReadiness.ts` via `app/setup/harness-checks.ts`). NOT a gate: nothing blocks agent spawn on a failing condition. There is no override flag: leaving this flag off is what suppresses the rows. |
| `GORDON_RISK_ACK=1` | Anti-rubber-stamp risk-acknowledgement gate (`infra/safety/anti-trap/riskAcknowledgement.ts`): on medium+ tier `execute_plan` the agent must name the top weighted risk dimensions in `acknowledgedRisks`, and every risk-kernel warning needs its own substantive (>=20 chars) and distinct entry. Opt-in — forces explicit supervision instead of single-keystroke approval. |
| `GORDON_ALLOW_LIVE=1` | Opt into LIVE crypto trading on a venue that has no sandbox/testnet (`infra/exchange/sandboxSupport.ts`). Without it, an unset `sandbox` flag on a no-sandbox venue refuses rather than silently routing live. An explicit `sandbox: false` (or config `live: true`) is a deliberate live choice and does not need this flag. |
| `GORDON_MANAGED_EXITS_ACK=1` | Acknowledge that any live take-profit without venue-native OCO requires Gordon's managed exit reconciler to remain running. Default-off: without this acknowledgement, those live plans are refused before entry; the venue-resident protective stop and all sandbox/backtest paths are unaffected. |
| `GORDON_RATIONALE_CONSISTENCY=1` | Triangular rationale gate on plan reflection (`infra/agents/cognition/reflection.ts`): scores evidence-to-reasoning, reasoning-to-decision and evidence-to-decision separately, and can invalidate a plan the rule checks accepted. Opt-in because it costs three extra LLM calls per plan. A judge outage degrades to a suggestion and never blocks. |
| `GORDON_INCEPTION_LOSS_FRACTION` | Fraction of reference capital whose cumulative destruction halts trading (`infra/safety/absorbingBarrierState.ts`). Unset leaves the barrier inactive and behaviour unchanged. Evaluated alongside the trailing high-water barrier, and the gate is the union of their blocks. Seed the reference with `GORDON_INCEPTION_EQUITY_USD`, else the first observed equity. State survives restart in the HMAC-authenticated ledger keyed by broker account ID or a non-secret exchange-connection fingerprint. For CCXT, set `CCXT_<VENUE>_ACCOUNT_ID` (or the first-class `<VENUE>_ACCOUNT_ID`) before credential rotation to retain the same durable identity. Without that stable ID, rotation creates a new namespace and requires the audited archive/reset. Deposits, withdrawals, corrupt files and replacement accounts also require `/killswitch archive-halt-state <rationale>` because Gordon has no authoritative cross-venue capital-flow feed. |

The halt ledger detects invalid content, replacement after it has been observed
by the running process, and failures to lock or persist. Those failures stay
fail-closed until the explicit audited archive/reset. It has no external
monotonic anchor, so a fresh process cannot prove that a missing or valid older
ledger was deleted or rolled back. Likewise, an observation that could not be
written cannot preserve its in-memory failure latch across a crash. Keep the
ledger and its `GORDON_AUDIT_HMAC_KEY` (preferably supplied through
`GORDON_AUDIT_HMAC_KEY_PATH` or the default `~/.gordon/audit-hmac.key`) in
durable operator-controlled storage, and resolve persistence errors before
restarting.
| `GORDON_TRAILING_DD_FRACTION` | Trailing give-back limit consumed by the same barrier fold. Unset leaves it inactive. |
| `GORDON_FEE_FIXED_PER_TRANCHE_USD` | Fixed commission per fee tranche, with `GORDON_FEE_TRANCHE_SIZE_USD`, optional `GORDON_FEE_MIN_PER_ORDER_USD`, and `GORDON_FEE_TOLERANCE_BPS` (default 100). Together they derive the economic order floor enforced in `evaluateOrderRisk`: an order clearing the venue minimum can still hand a fixed commission more of the position than the fee tolerance allows. Unset means the floor is not evaluated and a warning is emitted, since Gordon has no venue commission feed and a guessed floor would refuse good orders. |
| `GORDON_CLEAN_STATE_GATE=1` | Refuse to start an autonomous loop from dirty session state. |
| `GORDON_PLAN_RUBRIC=1` | Score a plan against the rubric before it can be approved. |
| `GORDON_EXPLAIN_FIRST=1` | Require the operator's own thesis before Gordon states its view (anti-anchoring). |
| `GORDON_TRADING_UNIVERSE=1` / `GORDON_STRATEGY_MANDATES=1` / `GORDON_THESIS_COHERENCE=1` | The three anti-rot gates. Each needs an operator-authored file (`*_PATH`), which is why none can be default-on. |
| `GORDON_SAFETY_CONFIG_GUARD=1` | Refuse config edits that loosen a safety setting without explicit confirmation. |
| `GORDON_SANDBOX_SUBPROCESS` | Sandbox spawned subprocesses. Unset falls through to the settings file rather than defaulting in the reader. |

Use `/flags` in the TUI to see and manage these settings. Rows marked
startup-only (`GORDON_GUARDS`, `GORDON_DISABLE_GUARDS`,
`GORDON_PROCESS_HARDENING`, and `GORDON_EXTERNAL_HOOK_RUNNER`) require a
restart; the remaining rows reach their live readers without one.

`GORDON_POLICY_KEY` is intentionally absent from `/flags`: it is an HMAC
secret used to verify the optional highest-precedence `policy.json` layer, not
a behavior toggle. Supply it through the process environment (and optionally
override the file with `GORDON_POLICY_PATH`). A policy file that exists without
a valid signature is refused rather than applied or demoted.

Defaults-on (previously flagged, now part of the architecture): result-cache delta envelopes, semantic output filtering, extended thinking by workflow phase, recovery-tier escalation, autonomous-loop reminders, kill switches (checked in `execute_plan` via `isExecutionAllowed`), network allowlist (warn mode, wired via `installOutboundFetchGuard` in `src/index.tsx`), filesystem write guard (warn mode, wired via `installFilesystemWriteGuard` in `src/index.tsx`), trade ledger, bar-permutation test, WIP-limit gate, boundary check, init probe, lifecycle reconstruction, family-diversity detector, all microstructure detectors (touch dynamics, microstructure toxicity, MEV detection, manufactured imbalance, manipulation context, cross-venue divergence, ATR progression), session memory, artifact index, tool context.

**LLM provider resilience:** `src/infra/ai/llm/providerCaching.ts` (Anthropic prompt-cache breakpoints) and `providerFailover.ts` (`executeWithFailover`) compose with the settings-layer priority chain — env keys → `settings.json` provider order → per-call overrides.

Deleted features (modules removed; config migration may still strip stale fields): tool deferral, evidence bundle, context-anxiety detector, cold-start audit, quality document, recitation checkpoint, initializer agent, harness evolution, claude-md linter, tool-design linter, agent-list attachment, permission bubble, query harness (unified agent loop wrapper — superseded by agents/harness modules).

ACE memory bullets (`reflectOnMessages` / `curateMemoryBullets` in `summarizer.ts`) are **not** deleted — they power `/reflect` when `GORDON_ACE_ENABLED=true`.

## Agent tool surface

Gordon's orchestrator + researcher expose a canonical 22-tool surface for generalized trading infra (data, analytics, plan/exec, memory, workflow). Source: `src/infra/agents/tools/surface/` — 5 files grouped by domain plus `index.ts` registry + `surface.test.ts`. Integration tools (Finnhub fundamentals, MCP marketplace, X-social, …) coexist as separate spreads where they cover venue-specific data feeds. Onchain price data and wallet intelligence live in `infra/data/sources/onchain.ts` and `infra/data/wallet/` — not as execution venues.

Tool layout (22 total):
- **data (5)**: `get_market_data`, `get_account_state`, `get_portfolio`, `get_news`, `get_fundamentals`
- **analytics (4)**: `compute_indicator` (80+ ops via enum), `compute_regime`, `compute_risk`, `compute_microstructure` (9 ops via enum)
- **plan / exec (6)**: `create_plan`, `verify_plan`, `approve_plan`, `execute_plan`, `cancel`, `backtest`
- **memory (3)**: `memory_search`, `memory_write`, `audit_event`
- **workflow (4)**: `skill`, `delegate_subagent`, `ask_user`, `schedule_task`

Only 2 meta-dispatchers (`compute_indicator`, `compute_microstructure`) — everything else is a single-purpose typed tool per the Dexter/Claude-Code preference for explicit-over-meta on safety-critical surfaces.

Safety semantics: surface tools don't re-implement risk classifier / signed audit / deny-list / trading constitution. Each tool calls into the existing handler module — rationale-required on `create_plan` / `approve_plan` / `execute_plan` / `cancel`, full 15-dim risk gate inside `verify_plan`, signed audit log on every write.

Skills aligned with the surface: `backtest-validate`, `strategy-build`, `regime-shift`, `microstructure-dive`, `crowd-trapped`, `filing-analysis`, `recovery-trade` are authored against surface tool names. Existing 35+ skills are mostly natural-language workflows; `learn-*` documentation skills intentionally retain legacy tool names since they explain the broader implementation modules.

The legacy generalized-trading tool modules (calculate_rsi, getCandles, etc.) remain in the codebase as implementation; the surface delegates into them via thin wrappers. If you ever need to surface a legacy tool by name on the agent, re-spread it explicitly in `gordon.ts` with a justification comment.

**Export-graduation convention:** `infra/trading` modules start private while experimental. Graduate to `src/infra/trading/index.ts` only when they have tests, stable typed I/O, and a caller-facing lifecycle (agent tool, producer, skill, or documented internal-ops API such as `shadowMode` / `autoOptimizer`). Unexported modules stay internal until promoted; exported modules should preserve API compatibility or ship an explicit migration.

## Ground rules for changes

1. **Bug fixes don't get refactors.** Three similar lines beat a premature abstraction. Don't change/remove comments or code you don't sufficiently understand, even if orthogonal to the task — Karpathy's "orthogonal damage" failure mode. Every changed line should trace to the task.
2. **No comments unless the WHY is non-obvious.** Don't narrate the WHAT — the code shows that.
3. **No backwards-compatibility shims** unless explicitly requested. If something is unused, delete it.
4. **No error handling for impossible states** — trust internal code; only validate at system boundaries.
5. **Confirm before risky actions** (force pushes, destructive git ops, large refactors). Local edits are free; shared-state changes need the user.
6. **Surface assumptions before coding.** Multiple interpretations of a task get listed, not picked silently. If a test's success depends on math you haven't validated (synthetic data calibration, threshold values, sample-size effects), prototype the math first. "It will probably work" is a tell.
7. **Translate vague tasks into verifiable success criteria.** "Fix the bug" → "write a failing test, make it pass." "Add feature X" → "tsc clean + N/N tests pass + tier lint clean + surface count verified." Loop on failures; don't work around them. Soft criteria ("schema validates and the file loads") are necessary but not sufficient on their own — name what would actually count as done.
8. **Use Edit, not sed-on-code.** Even when a change looks repetitive across a file, an explicit Edit per region beats a regex that can structurally mangle the file. Sed is fine for config / docs; for source, default to Edit.

## How to find what you need

| You're looking for… | Start at |
|---|---|
| A specific tool implementation | `src/infra/agents/tools/<domain>.ts` |
| What tools an agent has | `src/infra/agents/definitions/<agent>.ts` (look for `instrumented*Tools` spreads) |
| How a slash command works | `src/app/slash/slashCommands.ts` |
| Permission / approval flow | `src/runtime/permissions/PermissionEngine.ts` + `src/infra/trading/risk/riskClassifier.ts` |
| Hook lifecycle | `src/infra/hooks/types.ts` + `engine.ts` |
| The proactive radar | `src/infra/proactive/engine/observer.ts` (tick intervals) + `producers/` |
| Memory / compaction | `src/infra/domain/memory/summarizer.ts` (5 stages at 70/80/90/94/99) + `contextCollapse.ts` |
| Gateway / SDK / ACP surfaces | `src/gateway/` + `src/core-sdk/` + `src/app/acp-entry.ts` (`npm run acp`) |
| Stock headlines (Yahoo + EDGAR) | `src/infra/news/stockHeadlines.ts` |
| Strategy backtests | `src/backtest/` |

## When in doubt

Read `MEMORY.md` (the auto-memory index), then grep the area you think you're working in. Most "should I add X?" questions resolve to "X already exists at `<path>`."
