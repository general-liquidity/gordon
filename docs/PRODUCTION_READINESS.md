# Gordon — Production Readiness Backlog

Derived from the 15-slice fan-out audit of `src/` on 2026-06-10 (15 parallel read-only agents, ~330 files read fully / ~1,290 skimmed, three high-severity findings independently re-verified). Product thesis anchoring the priorities: **Gordon is the Claude Code for vibe trading** — one product, multiple surfaces (TUI / gateway+SDK / ACP), and the capital-safety plane is the precondition for the category, not a feature.

Tiers: **P0** safety-plane integrity → **P1** correctness → **P2** wire what's built → **P3** build what's missing → **P4** delete/archive → **P5** docs. Effort: S (<1h), M (half-day), L (multi-day).

Burn-down convention: check items off as they land, append the commit hash. Re-verify file paths before working an item — this snapshot ages.

## P0 — Safety-plane integrity (the moat must be load-bearing)

- [x] **1. Commit the uncommitted `execute_plan` APPROVED gate + test** (S) — parallel cleanup pass; `trading.executePlan.test.ts`
- [x] **2. Wire kill switches into the execution path** (M) — `execute_plan` gate + `/killswitch` + `killSwitchAlertProducer` radar
- [x] **3. Wire network allowlist** (M) — `installOutboundFetchGuard()` in `src/index.tsx`
- [x] **4. Wire filesystem write guard** (M) — `installFilesystemWriteGuard()` in `src/index.tsx`
- [x] **5. Scope the trust trajectory by permission scope** (S) — `(toolName, permissionScope)` ledger keys
- [x] **6. Guard division-by-zero in risk classifier** (S) — `validateTradeProposal` / portfolio validation
- [x] **7. Replace dynamic `require()` of optional risk dimensions** (S) — static imports
- [x] **8. ACP trust honesty** (M) — `permission-hook.ts` persists to `trustTrajectory` when `persist=true`
- [x] **9. Input validation at trade boundaries** (M) — `validateOrderLeg` + classifier entry validation
- [x] **10. Fail-fast paper-mode check in BrokerFactory** (S) — `assertBrokerPaperSupported` in `create()`

## P1 — Correctness fixes

- [x] **11. Duplicate `stochastic` case in indicator dispatcher** (S)
- [x] **12. Fix non-resolving import in playbooks types** (S) — `backtest/persistence/storage.ts` resolves
- [x] **13. Layering violation: core/consensus → infra tool** (M) — `ConsensusOptions.riskVote` injection; no infra import
- [x] **14. Surface risk-kernel breakage in TUI** (S) — `riskKernelHealth.ts`
- [x] **15. Unbounded caches/maps** (M) — regime TTL+cap, session-manager cap, `notificationRetention.ts`
- [x] **16. Validate data merges in position state machine** (S) — `validateMergedPosition()`
- [x] **17. PermissionEngine `upsertRule` dedupe** (S) — `sameRuleIdentity` filter
- [x] **18. Warn on malformed trust-ledger JSONL lines** (S)
- [x] **19. LLM resilience seams** (M) — `ProviderExhaustedError`; planner/explainer use `executeWithFailover`
- [x] **20. Log fire-and-forget cache-write failures on `get_market_data`** (S)
- [x] **21. MACD signal-line alignment assertion** (S) — `assertPrefixOnlyNulls`

## P2 — Wire what's built (the dark ~20%)

- [x] **22. Implement the 4 scaffolded radar producers** (L) — dedicated producers (`portfolioDrift`, `regimeFlip`, `volatilitySpike`, `fundingAlert`)
- [x] **23. Producer health → alerting** (S) — `producerHealthAlertProducer`
- [x] **24. Register `smc-patterns` ops in `compute_indicator`** (S)
- [x] **25. Decide `autoOptimizer` + `optimizerEnhancements`** (M) — exported via `infra/trading/index.ts`; documented
- [x] **26. Wire backtest analysis + optimization into the result pipeline** (M) — `enrichBacktestResult` in `runBacktestTool`
- [x] **27. Wire `permissions/racing.ts` into the approval dialog, or delete** (S) — `quickPermissionCheck` in `tui/bridge/runtime.ts`
- [x] **28. Plumb calibration store into proactive suggestions** (M) — `proactiveEngine.ts` records decisions + outcomes
- [x] **29. `get_portfolio` completeness** (M) — position-tracking path with exchange fallback
- [x] **30. Decide `shadowMode`** (M) — exported internal ops; documented in `infra/trading/index.ts`
- [x] **31. `turnSummary` ring buffer** (M) — wired as `/turns` in `tui/bridge/runtime.ts`

## P3 — Build what's missing

- [x] **32. Test debt on safety-critical untested modules** (L) — atomicExecution, riskClassifier, backtestCredibility, feedbackLoop, RSI/MACD, autoOptimizer smoke tests
- [x] **33. Stock headlines fetcher (Yahoo + EDGAR)** (M) — `stockHeadlines.ts`
- [x] **34. Compile-time exhaustiveness for `INDICATOR_NAMES` dispatcher** (S) — `_INDICATOR_EXHAUSTIVE` + throwing default
- [x] **35. CI cross-check: recovery commands vs slash registry** (S) — `errorContext.test.ts`
- [x] **36. Write the export-graduation convention** (S) — paragraph in `CLAUDE.md` + `infra/trading/index.ts` header
- [x] **37. Consolidate thinking-depth resolution** (S) — single `resolveThinkingDepth()` order in `thinkingPhase.ts`
- [ ] **38. Eval Phase 4: sandboxed live runner + k-run producer** (L) — *conscious deferral*; pass^k consumes injected trajectories only

## P4 — Delete or archive (apply the deleted-features discipline)

- [x] **39.** Legacy `src/indicators/` — migrated to `core/indicators/scanner-bundle.ts` + `price-levels.ts`; directory deleted
- [x] **40.** Legacy `src/types/event.ts` — deleted; types inlined into `storage/entities/events.ts`
- [x] **41.** Empty `PROTOCOL_REGISTRY` — documented as intentionally empty post-onchain-removal
- [x] **42.** TUI dead services/components — deleted (`voiceInput`, `newsRAG`, `speculation`, `buddy/`, `AlternateScreen`)
- [x] **43. Framebuffer fork decision** — **keep unwired**: vanilla Ink default (`GORDON_CUSTOM_RENDER` opt-in); `ink-custom` facade only; framebuffer internals untouched
- [x] **44.** Grep-verify cleanup — deleted: `news-backtest.ts`, `featurePipeline*`, `ab-routing/`, `queryHarness.ts`. **Kept** (live callers): `investigation.ts`, `strategy-generator.ts`, `chartTools.ts`, `infra/cli/registry.ts`
- [x] **45.** Small dedups — `withPortfolioOverride` → `surface/portfolioOverride.ts`; coinbase allowlist dup removed

## P5 — CLAUDE.md corrections (the operator is an agent; drifted docs are live bugs)

- [x] **46.** CLAUDE.md drift corrected — parallel cleanup pass (paths, 15-dim risk, 80+ indicators, compaction thresholds, wired guards, gateway/ACP, provider failover, export convention)

## Sequencing

1. **Afternoon one:** items 1, 5, 6, 7, 10 — small diffs, closes the worst exposure.
2. **Moat-integrity milestone:** items 2–4 (guard wiring) + 8 (ACP parity).
3. **First product build:** item 22 (radar producers) — the vibe-trading UX.
4. **Background hygiene:** P4 cull + item 46 docs pass, opportunistically.
5. **Conscious decisions, not defaults:** items 38 (live eval runner) and 43 (framebuffer commit-or-kill → **keep unwired**).