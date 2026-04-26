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
| `src/infra/agents/sharedPrefixCache.ts` | Anthropic prompt-cache reuse across sub-agents |
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

## Key conventions

- **Commits:** Conventional-commit prefix. Do **NOT** add `Co-Authored-By: Claude` to commit messages.
- **Imports:** Use `.ts` extensions on relative imports (Bun convention).
- **Tests:** `bun test <path>` — bun:test, no jest. Co-located `*.test.ts` files.
- **Typecheck:** `bun tsc --noEmit -p tsconfig.json`. Must be clean before commit.
- **Tool offload limit:** 1800 chars per result by default; per-family overrides in `runtimeHarness.ts` (market/account/order tools get higher limits).
- **Doom-loop detection:** Sliding 20-call window, threshold 3 identical fingerprints — see `recordToolCallFingerprint` in `runtimeHarness.ts`.
- **Compaction thresholds:** 70/80/90/99% pressure → masking / pruning / aggressive / full summary. Recent observations preserved 6/6/3/3.
- **Permissions:** Never restored on resume — trust is re-established per session. `riskClassifier` returns `auto_approve | prompt_user | require_confirmation | block`. Trust-trajectory hook short-circuits the human-required queue for tools the user has approved consistently, but a hard deny-list (`place_order`, `execute_trade`, `cancel_order`, `wallet_transfer`, …) bypasses trust scoring.
- **Routing agent:** Don't over-prompt. Adding "Routing Rules" to GORDON_INSTRUCTIONS breaks tool-call routing — Mastra's built-in routing prompt does it correctly.
- **Sub-agents:** Mastra hardcodes `lastMessages: 0` for sub-agents — patched to 10 via `scripts/patches/patch-mastra.cjs`. Sub-agents need `workingMemory: { enabled: false }` to prevent `updateWorkingMemory` injection crash.

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
