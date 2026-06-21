# Gordon Permission Profiles

> **What this is.** Three **named trust profiles** organized as an inheritance chain, documenting
> which tool families a profile permits outright vs. which always require confirmation. This is the
> layered-profile analog of how Codex / Claude Code centralize named permission tiers with
> inheritance and stated justification.
>
> **Documentation, not a new gate.** These profiles describe the *desired* trust posture in terms of
> Gordon's **existing** enforcement (`PermissionEngine`, the safety-critical deny-list, the risk
> classifier, kill switches). They do not change runtime behavior. The optional typed data table at
> [`../../src/runtime/permissions/profiles.ts`](../../src/runtime/permissions/profiles.ts) encodes the
> same three profiles for future use and is **not wired into the permission engine** — see
> "Status" below.

Companion documents: [`RISK-TAXONOMY.md`](./RISK-TAXONOMY.md), [`../../SECURITY.md`](../../SECURITY.md).

---

## The non-negotiable invariant (read first)

**No profile relaxes the safety-critical deny-list or the risk gate.** Profiles gate the *easy*
stuff — what reads/analytics/paper actions a session may run without prompting. Safety-critical
tools (`place_order`, `execute_trade`, `execute_plan`, `cancel_*`, `wallet_transfer`, `withdraw`,
…) **always** route through the human/confirmation path, regardless of profile, because:

- `isSafetyCritical()` in `src/runtime/permissions/trustTrajectory.ts` makes them ineligible for
  trust-trajectory auto-approval, and
- `PermissionEngine.evaluate()` suppresses broad `allow` rules for deny-listed tools
  (`safetyCriticalAllowSuppressed`), and
- `classifyTradeRisk` (`src/infra/trading/risk/riskClassifier.ts`) and `isExecutionAllowed`
  (`src/infra/safety/killSwitches.ts`) and `TRADING_CONSTITUTION`
  (`src/infra/safety/defense/tradingConstitution.ts`) still gate the order layer.

`live_trading` therefore differs from `paper_trading` only in *which venue scope* execution is
permitted against — it does **not** unlock auto-firing of deny-listed tools.

---

## Permission scopes referenced

These are the real `RuntimePermissionScope` values from `src/runtime/contracts/types.ts`:

`market.read`, `analysis.run`, `portfolio.read`, `papertrade.execute`, `livetrade.execute`,
`transfer.execute`, `wallet.write`, `system.mode.write`, `runtime.background.write`,
`plugin.install`, `mcp.connect`.

Keying trust by scope means a `papertrade.execute` approval never credits trust toward
`livetrade.execute` (see the `TrustTrajectory` scope note in `trustTrajectory.ts`).

---

## The inheritance chain

```
read_only  ──►  paper_trading  ──►  live_trading
 (data +        (+ plan/exec on      (+ execution on live
  analytics)     paper venues)        venues — deny-list,
                                      risk gate, kill switches
                                      STILL apply)
```

Each profile **inherits** the permitted scopes of its parent and adds its own. None removes a
safety control.

### Profile: `read_only`

The base profile. Data and analytics only; no side effects on any venue.

| Tool family (surface tools) | Scope | Disposition |
|---|---|---|
| `get_market_data`, `get_news`, `get_fundamentals` | `market.read` | **Permitted** (read, low risk) |
| `get_account_state`, `get_portfolio` | `portfolio.read` | **Permitted** (read) |
| `compute_indicator`, `compute_regime`, `compute_risk`, `compute_microstructure` | `analysis.run` | **Permitted** (compute, no side effect) |
| `memory_search` | `analysis.run` | **Permitted** (read) |
| `verify_plan`, `backtest` | `analysis.run` | **Permitted** (read-only evaluation; `verify_plan` runs the 15-dim risk gate but places nothing) |
| Anything under `papertrade.execute` / `livetrade.execute` / `transfer.execute` / `wallet.write` | — | **Denied / not permitted** |

Why: matches `PermissionEngine`'s `classifier:read-only` path — `sideEffectLevel === "read"` and
`riskClass === "low"` tools auto-allow unless flagged `always_require_human`.

### Profile: `paper_trading`

Inherits everything in `read_only`, **adds** plan/exec against **paper** venues.

| Added tool family | Scope | Disposition |
|---|---|---|
| `create_plan`, `approve_plan` | `papertrade.execute` | **Permitted with rationale** — `create_plan` carries a required `rationale` (min 10) |
| `execute_plan` (paper venue) | `papertrade.execute` | **Always confirmation** — `execute_plan` is in `SAFETY_CRITICAL_PATTERNS`; never trust-auto-approved even on paper |
| `cancel` (paper) | `papertrade.execute` | **Always confirmation** — `cancel` carries a required `rationale`; deny-list applies |
| Live execution scopes (`livetrade.execute`) | — | **Not permitted** |
| Transfers / wallet writes | — | **Not permitted** |

Why: paper execution still flows through the same `execute_plan` / `cancel` surface tools, which
are deny-listed. The profile permits the *paper scope*; it does not exempt the tools from the
human/confirmation path.

### Profile: `live_trading`

Inherits everything in `paper_trading`, **adds** execution against **live** venues. **Adds no
relaxation of any safety control.**

| Added tool family | Scope | Disposition |
|---|---|---|
| `execute_plan` (live venue) | `livetrade.execute` | **Always confirmation** + full chain: deny-list (`isSafetyCritical`) → risk gate (`classifyTradeRisk`) → constitution (`TRADING_CONSTITUTION`) → kill switches (`isExecutionAllowed`) |
| `cancel` (live) | `livetrade.execute` | **Always confirmation** (rationale required) |
| Venue order tools (`place_order`, `place_market_order`, `place_limit_order`, `place_bracket_order`, `place_oco_order`, `execute_trade`, `submit_order`) | `livetrade.execute` | **Always confirmation** — all in `SAFETY_CRITICAL_PATTERNS` |
| Fund transfers / withdrawals (`wallet_send`, `wallet_transfer`, `transfer_funds`, `withdraw`, `approve_token`) | `transfer.execute` / `wallet.write` | **Always confirmation** — deny-listed; profile does NOT auto-permit these |
| Mode writes (`system.mode.write`), plugin install, shell | `system.mode.write` / `plugin.install` | **Always confirmation** — `skill_install`, `exec_shell`, `run_shell` are deny-listed |

Why: this is the whole point of the profile design — the profile decides *whether live execution
is on the table at all*, but the per-action safety chain is unconditional. Granting
`live_trading` is granting the *scope*, not bypassing the gate.

---

## Status

- **Documentation:** authoritative as a description of intended trust posture.
- **Data table:** `src/runtime/permissions/profiles.ts` exports the three profiles as a typed
  const and is covered by `src/runtime/permissions/profiles.test.ts`, which asserts that **no
  profile auto-allows any safety-critical deny-list tool**.
- **Wiring:** **not wired** into `PermissionEngine`. Days-before-launch safety call — wiring a new
  profile layer into live gating risks changing default behavior. The table exists as a future,
  tested building block. Current gating is unchanged and still owned by `PermissionEngine` +
  `trustTrajectory` + `riskClassifier` + `killSwitches` + `tradingConstitution`.
