# Changelog

All notable changes to Gordon are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Each section is one
`v*` tag and links the commits it was built from.

Gordon is an autonomous trading agent, so entries that affect the permission
model, the risk kernel, or any path that reaches a venue are listed first and
called out explicitly, whatever their size.

## [Unreleased]

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

[Unreleased]: https://github.com/general-liquidity/gordon/compare/v0.3.0...HEAD
[0.3.0]: https://github.com/general-liquidity/gordon/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/general-liquidity/gordon/compare/v0.1.0...v0.2.0
