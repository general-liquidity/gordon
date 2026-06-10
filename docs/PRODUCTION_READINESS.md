# Gordon — Production Readiness Backlog

Derived from the 15-slice fan-out audit of `src/` on 2026-06-10 (15 parallel read-only agents, ~330 files read fully / ~1,290 skimmed, three high-severity findings independently re-verified). Product thesis anchoring the priorities: **Gordon is the Claude Code for vibe trading** — one product, multiple surfaces (TUI / gateway+SDK / ACP), and the capital-safety plane is the precondition for the category, not a feature.

Tiers: **P0** safety-plane integrity → **P1** correctness → **P2** wire what's built → **P3** build what's missing → **P4** delete/archive → **P5** docs. Effort: S (<1h), M (half-day), L (multi-day).

Burn-down convention: check items off as they land, append the commit hash. Re-verify file paths before working an item — this snapshot ages.

## P0 — Safety-plane integrity (the moat must be load-bearing)

- [ ] **1. Commit the uncommitted `execute_plan` APPROVED gate + test** (S)
  `src/infra/agents/tools/trading/trading.ts` — +27 line plan-state gate found dirty in the working tree. Write the test (APPROVED passes; DRAFT/EXECUTING/CLOSED/CANCELLED rejected with hint), commit.
- [ ] **2. Wire kill switches into the execution path** (M)
  `src/infra/safety/killSwitches.ts` is fully implemented + tested with **zero production callers** (grep-verified). Check `isExecutionAllowed()` before order placement / `execute_plan`; expose `tripKillSwitch` via slash command + radar card.
- [ ] **3. Wire network allowlist** (M)
  `src/infra/safety/networkAllowlist.ts` — same status: zero callers. Wire `checkOutbound()` into the outbound HTTP layer (fetch wrapper / exchange + MCP clients), warn-mode default as CLAUDE.md already claims.
- [ ] **4. Wire filesystem write guard** (M)
  `src/infra/safety/filesystemWriteGuard.ts` — zero callers. Wire `checkWrite()` into file-writing tool paths.
- [ ] **5. Scope the trust trajectory by permission scope** (S)
  `src/runtime/permissions/trustTrajectory.ts:129,145` — ledger keys by `toolName` only, so paper-mode approvals count toward auto-approving the same tool in live mode. Key by `(toolName, permissionScope)`.
- [ ] **6. Guard division-by-zero in risk classifier** (S)
  `src/infra/trading/risk/riskClassifier.ts:195,206,288,307` — `portfolio.totalValueUsd = 0` NaN-poisons all 15 dimensions and the composite verdict. Fail fast or clamp.
- [ ] **7. Replace dynamic `require()` of optional risk dimensions** (S)
  `riskClassifier.ts:279,302,423` — volatilityPositionSizing / correlationLimits / tailRisk load late; a moved file fails only when the data-guard passes. Static imports + per-dimension try/catch.
- [ ] **8. ACP trust honesty** (M)
  `src/infra/acp/permission-bridge.ts` — `allow_always` maps to `persist=true` but trustTrajectory wiring is deferred (comment says v3.5), so editor users believe approvals stick and they don't. Either persist for real or set `persist=false` and surface it. Surface-parity requirement for the one-product claim.
- [ ] **9. Input validation at trade boundaries** (M)
  Add `validateTradeProposal()` / `validatePortfolioContext()` (negative notional, drawdown range, price/quantity >= 0) at `riskClassifier.ts` entry; bounds-check `OrderLeg` quantity/price in `atomicExecution.ts` before submit.
- [ ] **10. Fail-fast paper-mode check in BrokerFactory** (S)
  `src/infra/broker/factory.ts` — call `assertBrokerPaperSupported(brokerId, paper)` in `create()` when `credentials.paper === true`, instead of failing on first method call.

## P1 — Correctness fixes

- [ ] **11. Duplicate `stochastic` case in indicator dispatcher** (S)
  `src/infra/agents/tools/surface/analytics.ts:694,922` — second case unreachable. Split `stochastic` (classic %K/%D) vs `stochastic_rsi` properly in enum + dispatch.
- [ ] **12. Fix non-resolving import in playbooks types** (S)
  `src/core/playbooks/types.ts:9` imports `'../../backtest/persistence/storage.ts'` which doesn't resolve — stale path from a refactor. Verify and repoint.
- [ ] **13. Layering violation: core/consensus → infra tool** (M)
  `src/core/consensus/protocol.ts:18` imports `evaluateOrderRisk` from `infra/agents/tools/trading/risk-gate.ts`. Inject risk scores as parameters or route via RiskKernel; core must not call agent tools.
- [ ] **14. Surface risk-kernel breakage in TUI** (S)
  `src/tui/bridge/runtime.ts:~600` — `evaluateToolAccess` failures silently fall back to manual approval; the operator never learns the classifier is broken. Log/notify once per session.
- [ ] **15. Unbounded caches/maps** (M)
  `src/core/regime/detector.ts:69` (cache, no eviction), `src/core/execution/session-manager.ts:9` (terminal sessions never removed), TUI `eventSubscriptions.ts` notificationFolder (no retention cap). Add TTL/eviction or session-boundary clears.
- [ ] **16. Validate data merges in position state machine** (S)
  `src/core/positions/state-machine.ts:152` — `transition()` spreads arbitrary `Partial<PositionRecord>` unvalidated. Validate against schema before merge.
- [ ] **17. PermissionEngine `upsertRule` is prepend-and-cap, not upsert** (S)
  `src/runtime/permissions/PermissionEngine.ts:557` — repeated approvals create duplicate rules until the 100-rule FIFO cap evicts old ones. Dedupe by rule identity or rename honestly.
- [ ] **18. Warn on malformed trust-ledger JSONL lines** (S)
  `trustTrajectory.ts:223` — corrupted lines silently skipped; operator gets no signal persistence is broken.
- [ ] **19. LLM resilience seams** (M)
  `src/infra/ai/llm/client.ts` — emit a structured "provider exhausted" signal from retries so `executeWithFailover` can short-circuit on 401/400 instead of waiting out backoff. Wrap `src/core/pipeline/planner.ts` / `explainer.ts` LLM calls in the failover layer (trades currently stall if the LLM is down).
- [ ] **20. Log fire-and-forget cache-write failures on `get_market_data`** (S)
  `src/infra/agents/tools/surface/data.ts:169-206` — silent failures quietly break asOf replay. Log once per session per symbol.
- [ ] **21. MACD signal-line alignment assertion** (S)
  `src/core/indicators/macd.ts:64-74` — re-indexing assumes nulls are prefix-only; assert it so mid-series nulls fail loudly instead of misaligning silently.

## P2 — Wire what's built (the dark ~20%)

- [ ] **22. Implement the 4 scaffolded radar producers** (L)
  `src/infra/proactive/producers/periodicProducer.ts` — `tick_portfolio_drift`, `tick_regime_flip`, `tick_volatility`, `tick_funding` fire and return nothing. Under the vibe-trading thesis this is core product surface: the passive operator's eyes. Needs position tracker / regime detector / price feed / funding plumbed as cheap reads.
- [ ] **23. Producer health → alerting** (S)
  `src/infra/proactive/engine/producerHealth.ts` — heartbeat tracker is diagnostics-only; a stalled producer should fire a radar card or warning.
- [ ] **24. Register `smc-patterns` ops in `compute_indicator`** (S)
  `src/core/indicators/smc-patterns.ts` — order blocks / FVG / CHoCH / liquidity sweeps built but orphaned from the dispatcher enum. Register or delete.
- [ ] **25. Decide `autoOptimizer` + `optimizerEnhancements`** (M)
  `src/infra/trading/portfolio/` — 893 tested LOC never exported or imported. Export to surface/skill, or move to documented staging.
- [ ] **26. Wire backtest analysis + optimization into the result pipeline** (M)
  `src/backtest/analysis/` (alpha-decay, monte-carlo, verdict) and `src/backtest/optimization/` (grid/random search, overfitting) are dormant — the agent can't reach them through the backtest tool.
- [ ] **27. Wire `permissions/racing.ts` into the approval dialog, or delete** (S)
  `src/infra/permissions/racing.ts` — `racePermissionDecision()` exported, never called.
- [ ] **28. Plumb calibration store into proactive suggestions** (M)
  `src/infra/calibration/confidenceStore.ts` — record confidence at fire + outcome at resolution → calibration curves per producer/category.
- [ ] **29. `get_portfolio` completeness** (M)
  `src/infra/agents/tools/surface/data.ts:307` — balances-only derivation; route through position-tracking for P&L/drawdown per its own TODO.
- [ ] **30. Decide `shadowMode`** (M)
  `src/infra/trading/ops/shadowMode.ts` — 319 LOC ghost-fill recording, unexported. Wire to a paper-trading skill or document internal-only.
- [ ] **31. `turnSummary` ring buffer** (M)
  `src/infra/domain/memory/turnSummary.ts` — built for a TUI navigation strip that was never wired. Wire or delete.

## P3 — Build what's missing

- [ ] **32. Test debt on safety-critical untested modules** (L)
  `atomicExecution.ts` (rollback semantics — highest priority), `backtestCredibility.ts`, `feedbackLoop.ts`, comprehensive `riskClassifier` coverage (only regime-transition tested), the portfolio tier (autoOptimizer/autoRebalance/blackLitterman/metaWeighting/portfolioDiff — zero tests), indicator basics (RSI/EMA/MACD have no dedicated tests).
- [ ] **33. Stock headlines fetcher (Yahoo + EDGAR)** (M)
  `src/infra/news/stockHeadlines.ts` is an empty type stub but CLAUDE.md claims the fetcher exists. Build it or strike the claim (pairs with P5).
- [ ] **34. Compile-time exhaustiveness for `INDICATOR_NAMES` dispatcher** (S)
  `surface/analytics.ts` — 80+ ops, string switch, silent fall-through default. Add a `Record<IndicatorName, ...>` exhaustiveness check.
- [ ] **35. CI cross-check: recovery commands vs slash registry** (S)
  `src/utils/errorContext.ts` suggests commands never validated against `src/app/slash/slashCommands.ts` — recovery flows rot silently on rename.
- [ ] **36. Write the export-graduation convention** (S)
  131 of 157 `infra/trading` quant/ops modules are unexported with no documented lifecycle. One paragraph in CLAUDE.md + index comment: when does internal → exported → surface?
- [ ] **37. Consolidate thinking-depth resolution** (S)
  Three independent paths today: context config (`cognition/thinkingPhase.ts`), env var, fixed phase→depth map (`extendedThinkingWiring.ts`). Collapse to one resolution order.
- [ ] **38. Eval Phase 4: sandboxed live runner + k-run producer** (L) — *deliberate deferral, decide consciously*
  `src/infra/domain/evals/harness/` — pass^k aggregation exists but consumes injected trajectories only; no live runner produces the k runs. The explicit gap blocking trajectory-free eval.

## P4 — Delete or archive (apply the deleted-features discipline)

- [ ] **39.** Legacy `src/indicators/` (scalar RSI/MACD/volume/levels duplicating `core/indicators`) — migrate importers, delete.
- [ ] **40.** Legacy `src/types/event.ts` EventType enum — grep for live importers; if none, delete (new bus: `src/events/types.ts`).
- [ ] **41.** Empty `PROTOCOL_REGISTRY` (`src/infra/protocols/index.ts`) — teardown leftover from the onchain removal.
- [ ] **42.** TUI dead services/components: `services/voiceInput.ts`, `services/newsRAG.ts`, `services/ai/speculation.ts`, `components/layout/AlternateScreen.tsx`, `buddy/companion.ts` sprite.
- [ ] **43. Framebuffer fork decision** — `src/tui/ink-custom/` (80+ files: cellBuffer, cellDiff, framebuffer, poolMigration, renderPipeline) is unreachable; `render.ts` always falls back to vanilla Ink. Commit to finishing Phase 2 wiring or delete the fork. Biggest single dead-weight item.
- [ ] **44.** Grep-verify then delete or ticket: `src/backtest/news-backtest.ts`, `src/backtest/features/featurePipeline.ts`, `src/infra/ai/ab-routing/`, `src/infra/harness/queryHarness.ts`, `src/infra/cli/registry.ts`, `src/infra/agents/investigation.ts`, `src/infra/agents/strategy-generator.ts`, `src/infra/tools/chartTools.ts` stub.
- [ ] **45.** Small dedups: duplicate `*.coinbase.com` allowlist rule (`networkAllowlist.ts:78,96`); extract the verbatim-duplicated `withPortfolioOverride` proxy (`surface/analytics.ts:485` + `surface/plan.ts:42`) into a shared util.

## P5 — CLAUDE.md corrections (the operator is an agent; drifted docs are live bugs)

- [ ] **46.** One commit fixing all verified drift:
  - riskClassifier path is `src/infra/trading/risk/riskClassifier.ts`; **15** dimensions, not 11
  - `compute_indicator` is **80+** ops, not ~30
  - Compaction is **5 stages** at 70/80/90/**94**/99 (collapse omitted from the thresholds line)
  - Slash commands live at `src/app/slash/slashCommands.ts`
  - "Defaults-on" list: kill switches / network allowlist / filesystem write guard are **implemented but unwired** until P0 items 2–4 land — say so
  - News fetcher: no Yahoo/EDGAR fetcher exists (see item 33)
  - Orchestrator is split across `orchestrator.ts` + `orchestrator/` modules
  - Add the undocumented **gateway/daemon/SDK** subsystem (39 files) + ACP entry point (`src/app/acp-entry.ts`, `bun acp`)
  - Document providerCaching/providerFailover + the settings-layer priority chain
  - Document the export-graduation convention once item 36 defines it

## Sequencing

1. **Afternoon one:** items 1, 5, 6, 7, 10 — small diffs, closes the worst exposure.
2. **Moat-integrity milestone:** items 2–4 (guard wiring) + 8 (ACP parity).
3. **First product build:** item 22 (radar producers) — the vibe-trading UX.
4. **Background hygiene:** P4 cull + item 46 docs pass, opportunistically.
5. **Conscious decisions, not defaults:** items 38 (live eval runner) and 43 (framebuffer commit-or-kill).
