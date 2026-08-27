# Changelog

All notable changes to Gordon are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Each section is one
`v*` tag and links the commits it was built from.

Gordon is an autonomous trading agent, so entries that affect the permission
model, the risk kernel, or any path that reaches a venue are listed first and
called out explicitly, whatever their size.

## [Unreleased]

## [0.5.0] - 2026-08-27

Covers `0ec0bebd`, `783a9ebf` and `95a20ed3`, which landed after the v0.4.0 tag.
`0ec0bebd` also carried a repo-wide Biome reformat across 2,300 files; only its
behavioural changes are listed here, alongside the fixes made since.

### Security

- Safety-critical flags no longer resolve from the project settings layer.
  Unifying the flag readers on `flagEnv()` had widened the trust boundary for
  the kill switches, the risk-kernel caps, the pre-trade rate controls, the
  network and filesystem guards, the subprocess sandbox and the clean-state
  override from environment variables to any settings layer, including
  `<cwd>/.gordon/settings.json`, which a repository can carry. A cloned repo
  could disable the firm-wide halt at every order-placing adapter and lift the
  leverage and position caps with an unsigned file. Those flags now resolve
  from the environment, the operator's home-directory settings and the signed
  policy layer only; every other flag keeps the full chain.
- `withdraw_to_external` now takes the live-capital consent gate before it
  reaches the venue. It is deny-listed and always required an explicit human
  approval, but the permission helper it called returns allowed unconditionally
  for both `auto` and `ask`, so the most irreversible action Gordon can take
  was the one order-adjacent path with no consent check.
- `GORDON_RISK_ACK` now enforces the tier its description names. `execute_plan`
  ran only the warning-triggered half, so a critical-tier plan that raised no
  risk-kernel warning needed no acknowledgement at all. Medium and higher tiers
  must now name the top weighted risk dimensions, and warning acknowledgements
  must be distinct rather than merely long enough.
- Emergency liquidation and every protective order now dispatch through the
  idempotent path with a deterministic client order ID and an explicit
  exposure-reducing consent effect. The previous emergency close used a
  timestamped ID, so a retry could liquidate twice, and a missing plan silently
  defaulted the exit side to SELL instead of refusing.
- Marketplace plugin manifests are verified against an expected SHA-256 before
  install, and an update cannot replace an installed, previously verified
  plugin with content that fails the check.
- Supply-chain gates are pinned and blocking. Gitleaks, Semgrep and osv-scanner
  run from digest or checksum-pinned versions as hard gates rather than
  `latest` with `|| true`, workflow actions are pinned to commit SHAs,
  `actionlint` validates the workflows, and the dependency audit is a single
  `bun audit --audit-level=moderate` gate with no per-advisory ignores. The one
  remaining exception lives in `osv-scanner.toml` with an expiry date. The
  LLM-judge eval leg moved to a separate manually dispatched job so an
  untrusted pull request cannot execute secret-bearing code.
- The dependency surface shrank: the Solana, Coinbase AgentKit, Chainlink and
  ethers subtrees were removed, and 17 transitive packages are pinned through
  `overrides` for advisory remediation.

### Changed

- Take-profits are no longer rested on the venue. `executePlan` places the
  protective stop only, and the monitor executes at most one managed partial
  close per cycle when price crosses a level, leaving a native OCO take-profit
  venue-managed where one exists.
- Entries are fill-confirmed for every order type. An entry that is not
  `FILLED` now waits for the fill and cancels on partial, a zero-fill entry is
  cancelled and reported as an error instead of proceeding to protective
  orders, and the exit quantity comes strictly from the confirmed executed
  quantity.
- Close paths are serialized and plan-scoped. A trade already being closed
  refuses re-entry, `closeTrade` requires the plan to exist, cancels only that
  plan's orders instead of every open order on the symbol, aborts if a
  cancellation is not confirmed, and leaves a partially closed trade in
  `PARTIAL` with a `trade:partial_close` event rather than reporting a clean
  close. `cancelTrade` refuses a trade that still holds exposure.
- The non-native OCO fallback was removed. On a venue without native OCO,
  `placeOCOOrders` refuses and places nothing rather than emulating it with two
  independent orders.
- The CCXT adapter refuses instead of guessing. An unknown order type, status
  or side, a missing symbol, inconsistent quantities and a negative commission
  now throw rather than defaulting to `LIMIT` / `NEW` / `BUY`,
  `cancelAllOrders` reports an `AggregateError` instead of swallowing failures,
  `testOrder` no longer returns `true` without contacting a validator, and
  account valuation throws when a positive non-stable balance has no usable
  mark instead of reporting it as zero.
- The live portfolio snapshot fails closed. An unpriceable positive balance
  invalidates the whole snapshot, since omitting it made concentration and
  leverage look safer than they were; available cash comes from the account
  snapshot rather than per-asset queries that could turn an adapter failure
  into a fabricated zero; and every context is schema-validated before it
  reaches the risk kernel.
- Short plans are handled end to end. Risk/reward validation, stop and
  take-profit placement rules, unrealized and realized PnL, distance to stop
  and to the next target, and the user-facing plan explanation all apply the
  direction, where several were long-only arithmetic before.
- Daily trade counts are no longer conflated with the rolling recent count: the
  classifier portfolio context carries `todayTradeCount` and the constitution
  checks use it.

### Fixed

- The monitor no longer infers fills from price. It used to mark a trade closed
  with a synthetic exit as soon as the last price crossed the stop; exits are
  now ledgered only from venue-confirmed fills, using executed-quantity deltas
  and real fill prices. A confirmed protective fill cancels the sibling
  protection, repairs protection after a partial exit, and raises a critical
  alert when either step is incomplete.
- Risk-audit records could be lost. Schema initialisation was cached per
  process, so any database opened after the first skipped the table creation,
  and the audit write was fire-and-forget, which raced database rotation. The
  write is now awaited and initialisation is keyed to the database generation.
  Prepared statements are finalised so Windows file handles do not outlive
  `Database.close()`.
- The hook-coverage diagnostic can fail again. `EMITTED_HOOK_POINTS` was
  derived from the declaration list, which made "emitted" mean "declared" and
  left `checkHookCoverage` structurally unable to report a failure. It now
  derives from a table of production emit sites, and a declared point with no
  emit site is a failure.
- The CCXT adapter header no longer claims a paper-trading guarantee it cannot
  make. The refusal covers first-class venues in the sandbox support matrix;
  for a long-tail CCXT venue there is no matrix entry and `setSandboxMode` can
  no-op silently, so `isSandbox` can read true against a live endpoint.
- `GORDON_REVENGE_TRADE_GUARD` was advertised in `/flags` as a trade-halt gate,
  but nothing read it and the guard it names blocks nothing. The flag entry and
  its unused reader are gone; the advisory evaluator and its agent tool are
  unchanged.
- The termination Layer-1 gate had four tests that could not fail, one of them
  asserting against a status union that does not exist. They now pin each
  blocking reason, the passing case, and that `execute_plan` refuses without
  reaching the executor when layer 1 fails under enforce.
- CI workflow and scanner false positives are cleared: GitHub context is routed
  through quoted environment variables, an intentional JavaScript quote
  boundary is marked for ShellCheck, and public redaction fixtures no longer
  resemble committed credentials.

## [0.4.0] - 2026-08-26

### Security

- Production now emits every declared lifecycle hook, including user-prompt,
  subagent, tool, approval, compaction, notification, session, and stop events.
  External handlers are installed from the governed registry, run without a
  shell, enforce time and output limits, terminate process trees where the host
  permits it, and fail closed when an enabled registry is empty or invalid.
- Permission fingerprints include validated arguments, hook-modified approval
  rationales must remain nonempty strings, and agent-initiated cancellations
  pass the same exposure-direction consent checks as other order operations.
- ACP-forwarded HTTP MCP servers reject unsafe schemes, private or mixed DNS
  answers, and duplicate identities. Forwarded stdio servers are denied unless
  the operator explicitly enables them, and their launchers remain allowlisted.

### Added

- ACP sessions now persist turns and modes, serialize replacement prompts,
  surface tool lifecycle events, bridge scoped permission requests, and clean
  up session-local MCP, usage, cancellation, and ACE state transactionally.
- Governed ACE lessons are injected per request and carry active-revision
  attribution into the action log without mutating a shared system prompt.
- The opt-in custom terminal renderer now owns its lifecycle, selection overlay,
  scroll state, accessibility fallback, and non-TTY fallback. The standard
  renderer remains the default.
- Deterministic unattended burn-in and daemon-startup validators exercise
  scheduling, persistence suppression, cleanup, and evidence heartbeats while
  explicitly forbidding model inference and venue/order dispatch.

### Fixed

- Session start, daemon startup, and post-compaction side effects now roll back
  partially initialized state and attempt every cleanup before reporting an
  aggregate failure.
- TUI exit no longer waits forever after the renderer has closed; it now flushes
  Stop and SessionEnd policy hooks before MCP, telemetry, and database teardown.
- Tool failures still emit post-tool lifecycle events; blocked or malformed
  hook replacements can no longer disappear into an implicit allow path.
- Sliding-TTL cache coverage uses an injected clock instead of wall-clock sleeps,
  removing a parallel-CI timing failure without changing production semantics.
- The critical dependency audit is an executable gate with a maintained,
  minimal accepted-advisory set, and the risk-tree audit resolves the repository
  root and Bun executable consistently across Windows and POSIX runners.
- Release test sharding now covers every discovered test file exactly once and
  enforces that invariant on every main/PR build; six previously orphaned suites,
  including the common risk-gate order path, are assigned to isolated shards.

## [0.3.2] - 2026-08-26

### Fixed

- Backtest signals can now attach absolute stop-loss and take-profit prices to
  both classic and grid positions. The engine validates that each level lies
  on the exposure-reducing side of the actual slipped entry, and the existing
  stop/target branches are now reachable through a real run instead of only by
  direct helper tests.
- Protective backtest exits apply slippage exactly once. Their trigger and
  adverse fill are computed separately, and an already-priced fallback is no
  longer passed through the generic exit slippage a second time.

## [0.3.1] - 2026-08-26

### Fixed

- Emergency liquidation now pauses strategy slots before touching orders,
  preserves downside-protective exits until their replacement market close is
  confirmed, and removes those exits only after every active trade for the
  symbol closes. A failed market close therefore no longer leaves the position
  naked, while a successful close cannot leave a stale exit capable of
  reversing the flat position.
- Emergency cleanup recognizes both explicit `gordon_…` client-order IDs and
  the exchange adapter's default `gordon-…` idempotency IDs. When mutually
  exclusive exits exceed the remaining position, stop-loss protection is kept
  ahead of same-side profit orders.

## [0.3.0] - 2026-08-26

### Security

- Every known venue-dispatch path now enforces live-capital consent. The four
  execution algorithms no longer fall back to a raw `placeOrder` submitter,
  malformed or missing access-control configuration fails closed, and the WIP
  claim is acquired synchronously before a plan can submit.
- Consent is keyed to exposure direction. A verified close remains available
  after consent is revoked, while a wrong-side or oversized order cannot claim
  the reduction exemption. Grid and deferred take-profit ladders now subtract
  every filled exit and cap their aggregate resting quantity at what remains
  open.
- The risk kernel re-checks an adjusted order against every critical rule and
  accounts for leverage already consumed by open positions. Correlation can
  report `unknown` or `fault` instead of laundering missing evidence into a
  pass, and broker-routed orders use the same gate as exchange orders.
- New-symbol market orders are priced at the exchange mark or executable-side
  broker quote before dollar-denominated checks run. An unavailable or invalid
  price is a typed refusal.
- The highest-precedence `policy.json` settings layer is HMAC-signed and is
  refused wholesale when its signature cannot be verified. Its key remains an
  environment secret and is not exposed through `/flags`.

### Fixed

- Backtest capital now includes the forced terminal close before the final
  equity point, and open grid positions no longer pay their entry commission a
  second time when marked. The permanent invariant reconciles capital change
  with summed per-trade net P&L.
- The power-law Kelly utility is dimensionally scaled and capped, loss barriers
  are anchored to session-opening equity, annualized Sharpe inputs are named at
  the type boundary, and return bootstraps resample fractions rather than
  nominal P&L.
- Point-in-time filtering declares strict or permissive treatment explicitly;
  an unreadable cutoff never disables the filter. Advertised flags now have
  executable readers, including processor model selection through the layered
  resolver.
- Large tool outputs can be recovered through a bounded, path-confined reader
  from Gordon, Researcher, and Executor. Small prices retain significant digits
  instead of rendering as zero.
- Scaffolded SDK projects run without arming live trading and reject project
  names that could inject generated TypeScript.

## [0.2.0] - 2026-08-26

### Security

Five defects on paths that route real capital, found by an architectural audit of
this repository and verified by hand against the source before each fix. All five
are closed. Every one was reachable in normal operation; none required an unusual
configuration.

- **The orchestrator could enable live trading with no human approval.**
  Permission authority was inferred by regular expression over the tool name.
  `manage_flags` matched none of the nine category patterns and none of the seven
  scope patterns, so it fell through to the `analysis.run` default and the
  classifier auto-allowed it as safe. That tool sets and persists
  `GORDON_ALLOW_LIVE` and `GORDON_RISK_MODE`, so the model could grant itself
  live-trading authority and disable the risk kernel without a prompt.

  Tools now carry an explicit capability declaration that the registry prefers
  over inference, and a tool that is neither declared nor matched resolves to a
  system-mode write at high risk rather than to `analysis.run`. The unknown
  default is fail-closed. Adding the missing name to a pattern would have closed
  this instance and left the mechanism, under which every new tool is a silent
  permission decision.

  Related: the trust trajectory is prepended ahead of the classifier and excluded
  only `always_require_human`, so the human queue was still defeatable by
  repetition. Scopes that grant authority rather than exercise it now abstain
  unconditionally, excluded by scope rather than by name for the same reason.

- **`GORDON_RISK_MODE=paper` disabled the risk kernel, and only on live venues.**
  The mode override was applied when the venue was *not* a sandbox, so the
  relaxation existed exclusively on real capital, and the live-safe resolver
  upgraded only `warn`, letting `paper` through to a blanket approval of every
  order. `paper` is now upgraded the same way `warn` is, and the inverted
  condition at the call site is corrected.

- **Market orders were sized in base units against dollar limits.** The order
  value estimator returned the raw quantity when no price was present. Its
  docstring said the quantity was USD-denominated; the comment three lines below
  said it was the base asset amount. A market buy of 0.5 BTC therefore reached
  every dollar-denominated check as 0.50 and passed. The estimator now returns no
  value when the order cannot be priced, and the five dollar-denominated checks
  fail closed. The order adjuster carried the same guess independently, halving
  an unpriced base quantity as a heuristic; without fixing it too the change was
  cosmetic, since the same order came back approved at half size.

- **The exchange adapter cache could return the wrong mode.** The cache key
  omitted the sandbox flag, and the construction path resolves the mode, asserts
  it is supported, and then hits the cache. The guards ran, passed, and were
  bypassed by a cache hit keyed only on venue and API-key prefix, so on a venue
  that uses one key for testnet and live a sandbox request could return the live
  adapter. Mode is now part of the key.

- **The IBKR adapter asserted a paper guarantee it cannot make.** Its paper and
  live base URLs were the same expression, while the adapter declared paper
  support and the inclusion gate asserted a safe path. The gateway is a local
  bridge and paper versus live is decided by which account it was logged into, so
  the adapter genuinely cannot distinguish them. The claim is dropped rather than
  a distinction fabricated, and the inclusion gate gains a third state so a
  criterion can be unverifiable rather than passing or failing.

### Fixed

Statistics and evidence. These do not route capital directly, but they produce
the numbers an operator reads before committing it.

- **The deflation bar did not scale with track length.** The per-period null
  benchmark divided a dimensionless expected maximum by the square root of
  periods per year instead of the square root of observations, substituting the
  annualization factor for the sample size. Monte Carlo over 20,000 replications
  per sample size confirms the null Sharpe estimate has standard deviation
  `1/sqrt(n)` to within two percent for n from 50 to 2520, so the correct
  benchmark divides by `sqrt(n)`. Against it the old form was 3.16 times too
  strict on a ten-year daily track and 2.00 times too lenient on a three-month
  one, and exact at 252 observations, which is one year of daily bars and the
  most common backtest length. That is how it survived: the gate was hardest to
  clear where the evidence was strongest and easiest where it was weakest.

- **The non-normality term vanished for normal returns.** It used excess kurtosis
  where the formula wants raw, so a normal contributed zero instead of one half.

- **Both deflated-Sharpe modules used an inaccurate normal CDF.** They applied
  Abramowitz and Stegun 7.1.26 error-function coefficients with `exp(-x^2/2)`,
  substituting the `1/sqrt(2)` in the exponent only. Measured maximum absolute
  error 0.037189 at x = 0.567, one-signed positive throughout, returning 0.961301
  at the true 0.95 quantile, so a `dsr > 0.95` gate was passing tracks that had
  not cleared it. Both now use the exact implementation in `core/numerics`, which
  exists for this reason and which neither module imported.

- **A failed or impossible backtest was rendered as evidence.** A backtest that
  threw and one that could not run for want of an exchange client both produced a
  mock result carrying zeros in an object shaped exactly like a real one,
  distinguished only by an id prefix. Probing the previous code returned
  `meetsThresholds: true` on fabricated numbers with no trials recorded, and a
  zero maximum drawdown is the theoretical best value, so mocks biased any
  drawdown-weighted pooling favorably. An absent backtest is now a typed state
  that consumers refuse to score or persist.

- **The user-visible deflated Sharpe was never deflated.** The only external call
  site passed a hardcoded trial count of one, so the reported figure was a
  probabilistic Sharpe under a deflated label. The count is now threaded through,
  and without one the report says so rather than implying a correction it did not
  make.

- **Candidates that failed early escaped the trial count.** The research loop
  incremented its counter after the backtest, so a throwing backtest propagated
  out and took the accumulated count with it. The increment moves ahead of the
  call, and generation now records a trial at every exit, so a candidate that
  fails cannot vanish from the multiple-testing account.

- **Silent recovery is now visible.** Parse failures that default fields and DSL
  failures that substitute a generated strategy still recover, which is correct
  for an interactive assistant, but the result now reports what was defaulted or
  substituted so the caller can see they did not get what they asked for.

- A test fixture used a literal with enough entropy to trip the secret gate. It
  now uses a marker-shaped value, with the historical string allowlisted by exact
  literal rather than by path, since a real key committed to a test file is still
  a leak.

### Notes

The permission change is behavioral: a tool that was previously auto-approved
through the unknown-name fallthrough now queues for human approval. That is the
intent, and it is why this is a minor rather than a patch release.

[Unreleased]: https://github.com/general-liquidity/gordon/compare/v0.5.0...HEAD
[0.5.0]: https://github.com/general-liquidity/gordon/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/general-liquidity/gordon/compare/v0.3.2...v0.4.0
[0.3.2]: https://github.com/general-liquidity/gordon/compare/v0.3.1...v0.3.2
[0.3.1]: https://github.com/general-liquidity/gordon/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/general-liquidity/gordon/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/general-liquidity/gordon/compare/v0.1.0...v0.2.0
