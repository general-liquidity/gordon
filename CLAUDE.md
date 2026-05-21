# Gordon CLI — Claude Code Onboarding

This file briefs Claude Code sessions opened against the Gordon repo. It captures the conventions, layout, and invariants that aren't obvious from `package.json` or a quick `ls`.

## What Gordon is

Gordon is a TypeScript trading agent on Bun + Mastra. It connects to crypto exchanges (Binance, Coinbase, Kraken, OKX, …) and equity brokers (Interactive Brokers, Alpaca, Trading 212), proposes trades, runs backtests, scans markets, and hosts a proactive radar that fires cards on news / regime / volatility / trade events.

It is **not** a coding agent. Most patterns from Claude Code's coding-agent design map onto Gordon's trading domain only loosely. When porting ideas, ask "does this make sense for trading or only for editing files?" before assuming.

## Repository layout (the bits worth knowing)

| Path | What lives there |
|---|---|
| `src/infra/agents/definitions/` | The 3 actual agents — `gordon.ts` (orchestrator/router), `executor.ts`, `researcher.ts` |
| `src/infra/agents/tools/` | All Mastra tools, organized by domain (market, account, trading, news, …) |
| `src/infra/agents/instrumentedTools.ts` | Single registration point — wraps every tool with metrics + spill |
| `src/infra/agents/orchestrator.ts` | Stream processing, handoff tracking, TOOL_AGENT_MAP |
| `src/infra/agents/context/sharedPrefixCache.ts` | Anthropic prompt-cache reuse across sub-agents (see also `context/promptCacheAudit.ts`, `ai/llm/providerCaching.ts`, `runtime/kvCacheHitMetric.ts`) |
| `src/infra/agents/thinkingPhase.ts` | Tool-free pre-action reasoning pass (separate LLM call) |
| `src/infra/agents/extendedThinking.ts` | In-band Anthropic native `budget_tokens` helper |
| `src/infra/agents/critiquePhase.ts` | Critique/refine pass at HIGH thinking depth |
| `src/infra/agents/runtimeHarness.ts` | Doom-loop detection, tool-result limits, fingerprinting |
| `src/infra/domain/memory/summarizer.ts` | 4-stage compaction (masking / pruning / aggressive / full) |
| `src/infra/domain/memory/contextCollapse.ts` | 5th compaction stage — non-destructive read-time projection |
| `src/infra/hooks/` | Hook engine + lifecycle types (PreToolUse, PreOrderPlacement, …) with `asyncRewake` and `statusMessage` |
| `src/infra/news/` | RSS headline fetcher (12 crypto + Yahoo + EDGAR) + sentiment classifier |
| `src/infra/proactive/producers/` | Radar producers (news, regime, volatility, funding, stock events, …) |
| `src/infra/trading/riskClassifier.ts` | Pre-trade risk classifier — 11 dimensions including vol-adjusted sizing, tail risk, correlation |
| `src/runtime/permissions/PermissionEngine.ts` | Deny-first permission gate; exposes `registerHook` / `prependHook` |
| `src/runtime/permissions/trustTrajectory.ts` | Adaptive auto-approval with safety-critical deny-list |
| `src/core/strategies/recipes/` | Pure signal-processing primitives (regime-RSI, bounce counter, signal gate, max-exposure timeout) |
| `src/core/regime/` | Market regime detector + classifier |
| `src/core/playbooks/builtin/` | Built-in trading playbooks (markdown) |
| `src/core/risk-kernel/` | Risk audit trail |
| `src/app/slashCommands.ts` | Slash command definitions (programmatic, not markdown) |
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
- **Tool offload limit:** 1800 chars per result by default; per-family overrides in `runtimeHarness.ts` (market/account/order tools get higher limits).
- **Doom-loop detection:** Sliding 20-call window, threshold 3 identical fingerprints — see `recordToolCallFingerprint` in `runtimeHarness.ts`.
- **Compaction thresholds:** 70/80/90/99% pressure → masking / pruning / aggressive / full summary. Recent observations preserved 6/6/3/3.
- **Permissions:** Never restored on resume — trust is re-established per session. `riskClassifier` returns `auto_approve | prompt_user | require_confirmation | block`. Trust-trajectory hook short-circuits the human-required queue for tools the user has approved consistently, but a hard deny-list (`place_order`, `execute_trade`, `cancel_order`, `wallet_transfer`, …) bypasses trust scoring.
- **Rationale on safety-critical tools:** `execute_plan` and all `cancel_*` order tools (`cancel_order`, `cancel_all_orders`, `cancel_replace_order`, `cancel_order_list`) take a required `rationale: string (min 10)` field. Logged via `recordStructuredObservation` with `eventType: "*.rationale_recorded"`. Borrowed from Ramp's MCP pattern — the audit log captures intent, not just the call. New cancel/execute tools should follow the same shape.
- **Agent self-feedback:** `report_blocked` tool (`agent-feedback.ts`) lets the agent proactively signal stuck-ness with structured intent + attempts + blocker BEFORE the doom-loop detector trips. Persists to `~/.gordon/agent-feedback.jsonl` (override `GORDON_AGENT_FEEDBACK_PATH`).
- **Routing agent:** Don't over-prompt. Adding "Routing Rules" to GORDON_INSTRUCTIONS breaks tool-call routing — Mastra's built-in routing prompt does it correctly.
- **Sub-agents:** Mastra hardcodes `lastMessages: 0` for sub-agents — patched to 10 via `scripts/patches/patch-mastra.cjs`. Sub-agents need `workingMemory: { enabled: false }` to prevent `updateWorkingMemory` injection crash.
- **Agent topology is deliberately centralized multi-agent** (gordon orchestrator → executor + researcher), NOT collapse-to-single-agent. The Stanford "default single-agent" + Google/MIT "tool-heavy multi-agent has 2–6x efficiency penalty" findings sound like they'd apply (Gordon has 200+ tools) but they don't: (a) the agents have *different* tool subsets scoped by permission boundary, not the same 200 tools per agent, (b) trading is a regulated/strict-verification domain where Google/MIT explicitly recommend centralized multi-agent for error containment (orchestrator cross-check reduces logical contradictions 36.4%, context omissions 66.8%), and (c) the split exists for safety (executor has execution permissions, researcher doesn't), which is not negotiable for efficiency reasons. Do not "fix" Gordon by merging executor/researcher tools into the orchestrator — that's a security regression dressed as an optimization.

## Eval harness

`src/infra/domain/evals/harness/` — RULER-pattern LLM-as-judge for agent quality. Three hand-curated scenarios shipped (plan-card-btc / regime-flip / risk-gate); grow as production traces surface failure modes. Distinct from `evals/tradeEvaluator.ts` which scores realized PnL after-the-fact.

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

## Wiring feature flags (off by default)

Recent primitives ship wired but cold. Each flag activates one layer; the wrapper falls back to passthrough when unset. Combine freely.

| Env flag | Activates |
|---|---|
| `GORDON_TOOL_OUTPUT_FILTERS=1` | Semantic compression of `get_candles` / `get_orderbook` / `scan_market` via `withOutputFiltering` |
| `GORDON_TOOL_RESULT_CACHE=1` | `withResultCache` — cached tool results return `{ status: "unchanged", ... }` delta envelope on hit |
| `GORDON_EXTENDED_THINKING=1` | Anthropic native `budget_tokens` per workflow phase (analysis=low, planning/execution=medium, critique=high) |
| `GORDON_AGENT_LIST_ATTACHMENT=1` | Emit agent list as separate system attachment instead of bloating tool schema |
| `GORDON_RECOVERY_TIERS=1` | Doom-loop detection escalates Notify → Redirect → ForceStop (safety-critical tools fast-track) |
| `GORDON_TOOL_DEFERRAL=1` | Hide deferred tools from model schema until activated; ~50% schema-token savings |
| `GORDON_REMINDERS=1` | Inject turn-cadence reminders (daily loss limit, mandate scope, open positions) into autonomous loop prompts |
| `GORDON_PERMISSION_BUBBLE=1` | Tag fork-originated permission requests with `[fork X]` UI prefix |
| `GORDON_ACE_ENABLED=true` | Activate ACE (Agentic Context Engineering): `/reflect` distills the action log into lessons, injected into the system prompt of future sessions via `shared.ace-lessons` |

Combine for stack: each flag is independent. Recommended bring-up order once evals exist: filters + cache first (zero-risk additive), then extended thinking, then deferral / agent list, then reminders / recovery / bubble.

## Ground rules for changes

1. **Bug fixes don't get refactors.** Three similar lines beat a premature abstraction.
2. **No comments unless the WHY is non-obvious.** Don't narrate the WHAT — the code shows that.
3. **No backwards-compatibility shims** unless explicitly requested. If something is unused, delete it.
4. **No error handling for impossible states** — trust internal code; only validate at system boundaries.
5. **Confirm before risky actions** (force pushes, destructive git ops, large refactors). Local edits are free; shared-state changes need the user.

## How to find what you need

| You're looking for… | Start at |
|---|---|
| A specific tool implementation | `src/infra/agents/tools/<domain>.ts` |
| What tools an agent has | `src/infra/agents/definitions/<agent>.ts` (look for `instrumented*Tools` spreads) |
| How a slash command works | `src/app/slashCommands.ts` |
| Permission / approval flow | `src/runtime/permissions/PermissionEngine.ts` + `riskClassifier.ts` |
| Hook lifecycle | `src/infra/hooks/types.ts` + `engine.ts` |
| The proactive radar | `src/infra/proactive/observer.ts` (tick intervals) + `producers/` |
| Memory / compaction | `src/infra/domain/memory/summarizer.ts` (4 stages) + `contextCollapse.ts` (5th) |
| Strategy backtests | `src/backtest/` |

## When in doubt

Read `MEMORY.md` (the auto-memory index), then grep the area you think you're working in. Most "should I add X?" questions resolve to "X already exists at `<path>`."
