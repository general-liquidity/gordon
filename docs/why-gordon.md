# Why Gordon

In markets, AI does not have a capabilities problem. It has a trust problem.

A model can read a chart, explain a filing, and argue a thesis fluently. That does not mean it can size a position, respect a loss limit, recover from a failed order, or preserve capital through a drawdown. In most software, being slightly wrong is survivable. In markets, being nearly right is often just being wrong with a settlement attached.

Gordon is the harness between a model's proposal and a venue's execution API. It turns plain-language intent into a structured plan, separates analysis from authority, and keeps deterministic controls in charge of capital.

The model proposes. The harness disposes.

## Three design convictions

### The model proposes, the harness disposes

Intelligence and authority are separate. The agent that reasons about a trade is not the agent that places it, and an agent-issued exposure increase cannot reach a venue without deterministic checks.

Model capability is useful. It is not permission.

### Plan first for new risk

A discretionary exposure increase does not touch a venue until it has become a structured diff and passed the applicable approval policy. In supervised modes, the operator sees that plan before dispatch. Approvals are content-bound: changing a leg invalidates the approval.

Protective exits, verified reductions, emergency liquidation, and reconciliation use separate bounded invariants. Revoking consent for new risk must not strand existing risk.

### Deny first, not trust first

The default answer to “may this run?” is no. Exposure increases must clear the permission engine, 16-dimension risk classifier, hard safety-critical deny-list, trading constitution, scoped kill switches, and lifecycle hooks. A model cannot persuade a deterministic limit to move.

## Why a supervised agent is different from a bot

Gordon is not a faster rule engine. It is a supervised trading agent with a deterministic capital-safety plane.

| Capability | Gordon | Rule or strategy bot | LLM connected directly to a broker |
|---|---:|---:|---:|
| Natural-language research and planning | Yes | Usually no | Yes |
| Structured plan before exposure increase | Built in | Strategy-specific | You build it |
| Deny-first permission gate | Built in | Usually strategy-level | You build it |
| Multi-dimension pre-trade classification | 16 dimensions | Usually limit-based | You build it |
| Content-bound approval | Built in | Usually not applicable | You build it |
| HMAC-chained audit trail | Built in | Logs vary | You build it |
| Separate read-only and execution agents | Built in | Usually not applicable | You build it |
| Crypto plus equities, options, and futures | Yes | Product-dependent | Whatever you connect |

This table compares product shapes, not investment performance. Gordon does not claim that agentic reasoning creates alpha or beats an established strategy engine.

## The job Gordon is built to do

Gordon helps an operator move from an idea to a controlled decision:

1. Gather market, portfolio, news, fundamental, and alternative data.
2. Analyze the setup with deterministic quantitative tools and model reasoning.
3. Write a plan with entries, exits, size, rationale, and invalidation conditions.
4. Verify the plan against current portfolio state and the safety plane.
5. Ask for approval when the active permission mode requires it.
6. Dispatch only through the executor and reconcile what the venue reports.
7. Preserve the decision, rationale, and outcome for review.

The design favors observable failure over silent improvisation. Missing prices, unverifiable paper support, stale approvals, tripped halts, and malformed managed policy are refusal conditions, not invitations to guess.

## What Gordon is not

- **Not an HFT or low-latency engine.** Gordon reasons in seconds, not microseconds. It is aimed at discretionary, research-heavy, and swing workflows.
- **Not a signal service or alpha-in-a-box.** It ships analysis, strategy scaffolding, and gates. The edge is still yours to find and validate.
- **Not a hosted account.** It runs on your machine with your configured providers and venues.
- **Not a substitute for risk judgment.** The harness blocks known-bad actions; it cannot know what you can afford to lose.
- **Not financial advice.** Read [DISCLAIMER.md](../DISCLAIMER.md) and [TERMS.md](../TERMS.md) before arming capital.
- **Not a guarantee against model or venue failure.** Models can be wrong, APIs can behave unexpectedly, and market structure can change.

## Why the limitations are part of the design

Gordon states where evidence stops. A backtest does not prove a live edge. A paper endpoint does not prove production behavior. A passing risk check does not make a trade good. A local audit trail is not an external compliance certification.

The product is useful because these boundaries are explicit and the system still gives the operator a disciplined way to work inside them.

## Where to go next

- [Getting started](./getting-started.md)
- [Security and safety](./security/README.md)
- [Architecture](./architecture.md)
- [Capabilities](./capabilities.md)
