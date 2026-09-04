# Gordon security and safety

Gordon can reach real accounts and place real orders. Its safety model separates model reasoning from execution authority and requires agent-issued exposure increases to pass deterministic controls before venue dispatch.

This is a product safety guide, not an external security certification. See [`SECURITY.md`](../../SECURITY.md) for supported versions, threat scope, and private vulnerability reporting.

## Core invariant

The model proposes. The harness disposes.

A prompt, tool result, remembered approval, or model recommendation cannot replace the runtime's permission, risk, constitution, halt, hook, and audit decisions.

## Defense in depth

| Layer | Responsibility |
|---|---|
| Safe startup | Brokers use paper paths where the adapter can verify them; known unsupported sandbox routes refuse implicit live use |
| Live consent | The first live arm requires a one-time risk acknowledgment |
| Permission mode | Defines whether the session can read, plan, paper trade, request live approval, or operate autonomously within gates |
| Permission engine | Deny-first hook chain for every tool call |
| Safety-critical deny-list | Prevents trust history or broad allow rules from auto-approving money-touching tools |
| Risk classifier | Scores 8 base and up to 8 conditional dimensions |
| Trading constitution | Enforces immutable hard ceilings below configurable limits |
| Trade halts | Streak, give-back, absorbing-barrier, rate, WIP, and clean-state controls refuse new risk under their conditions |
| Kill switches | Persisted halts scoped from firm down to venue, instrument, account, trader, client, gateway, or strategy |
| Hooks | Fourteen lifecycle points for policy, validation, and audit extensions |
| Audit and ledger | Records rationale, gate decisions, portfolio context, order state, and reconciliation |

No single row is the complete defense. The order path is designed so independent controls overlap.

## Permission modes

Every mode still runs the risk classifier, trading constitution, kill switches, hooks, and audit. The mode changes how far the agent may act without another approval.

| Mode | Read | Plan | Paper | Live | Meaning |
|---|:---:|:---:|:---:|:---:|---|
| `strict` | Yes | No | No | No | Read-only, with no plan writes |
| `observe` | Yes | No | No | No | Read plus suggestions, no execution |
| `plan` | Yes | Yes | No | No | Plans can be created but not dispatched |
| `paper` | Yes | Yes | Requested | No | Requests the configured paper or sandbox path; venue verification is still required |
| `ask` | Yes | Yes | Yes | Approval required | Default; every live exposure increase needs explicit approval |
| `auto` | Yes | Yes | Yes | Within gates | Removes per-order human confirmation, not deterministic controls |

`auto` is not an unguarded mode. It is suitable only for operator-defined systematic slots whose loss limits and failure behavior have been reviewed.

## Named permission profiles

`GORDON_PERMISSION_PROFILE` can add a tested profile hook to the runtime permission engine:

```text
read_only -> paper_trading -> live_trading
```

The profile grants scopes and benign auto-allow entries. It cannot auto-allow a safety-critical tool. When the variable is unset, the hook abstains and default behavior is unchanged. An unknown value also applies no profile and emits a warning.

See [Permission profiles](./PERMISSION-PROFILES.md) for the exact scope and tool tables.

## 16-dimension risk classifier

The classifier always evaluates:

- Position size
- Concentration
- Drawdown proximity
- Daily loss budget
- Trade frequency
- Volatility
- Market hours
- Asset familiarity

When the required input is present, it also evaluates:

- Vol-adjusted sizing
- Correlation risk
- Venue MEV exposure
- Regime transition risk
- Fake liquidity
- Margin of error
- Tail risk
- Uncertainty decomposition

Missing optional input means the corresponding conditional dimension did not run. It does not mean that risk was measured and found absent. Individual failures in optional dimension computation receive conservative scores.

The classifier returns a score, tier, top factors, and recommendation. Hard constitution rules remain separate so a favorable weighted average cannot legalize a prohibited trade.

## Leverage and sizing layers

Several limits appear in different parts of the execution stack. They are not interchangeable:

| Layer | Current default or ceiling | Purpose |
|---|---:|---|
| Risk-kernel configurable default | `1x` | Operator-facing default loaded by the risk kernel |
| Trading-constitution hard ceiling | `3x` | Compiled maximum that configuration cannot loosen |
| CCXT adapter fallback | `5x` | Adapter-local fallback used where its own venue check needs a value |

The effective allowed order must satisfy every applicable layer. Public documentation should not describe the `5x` adapter fallback as Gordon's global default; the risk kernel begins at `1x` and the constitution caps at `3x`.

## Safety-critical actions

The trust-trajectory deny-list covers order placement, plan execution, cancellation, transfers, withdrawals, shell execution, and other high-impact tools. These actions cannot earn trust-based auto-approval.

`execute_plan` and cancellation tools also require a concrete rationale of at least 10 characters. The audit trail records the reason, not just the call.

## Kill switches and protective exits

Kill switches can halt the firm, gateway, venue, instrument, account, trader, client, or strategy scope. State survives restart, and a reset requires a logged rationale.

New-risk halts do not automatically strand existing exposure. Verified reductions, protective exits, emergency liquidation, and reconciliation have bounded paths that remain available when they reduce risk. A caller cannot label an arbitrary order as protective; the runtime verifies the exposure change.

## Configuration trust boundary

`/flags` writes durable operator choices to `~/.gordon/settings.local.json`. A repository can carry `.gordon/settings.json`, so safety-critical entries inside its `flags` map are ignored. This prevents a cloned project from disabling kill switches or widening the risk kernel.

Signed organization policy outranks local, project, and profile settings. The HMAC key comes from the process environment. A present but unverifiable policy is refused rather than applied or demoted.

## Credential handling

- Keep exchange, broker, and model credentials in the process environment or `~/.gordon/.env`.
- Do not place credentials in repository files.
- Structured logging passes context, error messages, and stacks through value redaction.
- Diagnostic report environment capture is disabled where the runtime exposes that control.
- The npm launcher disables POSIX core dumps before starting the binary.
- Direct binary and service deployments must set their own core limit; see [Process hardening](./PROCESS-HARDENING.md).

Credential redaction lowers accidental exposure. It does not make an untrusted plugin or process safe to run with secrets in its environment.

## Network and subprocess boundaries

Gordon's network allowlist can observe or restrict outbound destinations according to mode. ACP-forwarded HTTP and SSE servers are checked against local and private targets.

The [subprocess sandbox](./SUBPROCESS-SANDBOX.md) is an opt-in filesystem-write confinement layer for third-party child processes such as MCP servers. It is not a full container boundary, allows network for MCP by default, and currently warns then falls back to direct spawn if the host sandbox tool is unavailable.

## Audit boundary

The local audit log is HMAC-chained. It provides tamper evidence for the stored sequence, not an external timestamp, independent custodian, or regulatory attestation. Operators who need those properties must export records into their own controlled system.

## Operator checklist

Before live use:

1. Start in `strict` or `paper`.
2. Run `/doctor` and inspect every configured venue.
3. Verify the account and paper/live status outside Gordon.
4. Confirm loss, sizing, leverage, WIP, streak, and give-back settings.
5. Test a small plan through approval, dispatch, cancellation, and reconciliation.
6. Trip and reset the relevant kill-switch scopes.
7. Review audit output and credential redaction.
8. Read [DISCLAIMER.md](../../DISCLAIMER.md) and [TERMS.md](../../TERMS.md).

## Detailed references

- [Permission profiles](./PERMISSION-PROFILES.md)
- [Risk taxonomy](./RISK-TAXONOMY.md)
- [Process hardening](./PROCESS-HARDENING.md)
- [Subprocess sandbox](./SUBPROCESS-SANDBOX.md)
- [Security policy](../../SECURITY.md)
