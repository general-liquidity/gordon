# General Liquidity

**AI-native systems for financial reasoning, delegated execution, and economic agency.**

Tiberiu Toca · Solo founder · [generalliquidity.com](https://generalliquidity.com) · [github.com/general-liquidity/gordon-cli](https://github.com/general-liquidity/gordon-cli) · tibi.toca@gmail.com

---

## The agency bottleneck

The raw pieces of an agentic financial stack are already here. Stablecoins treat blockchain settlement as real payments infrastructure. Broker APIs expose trade execution directly to software. Programmable accounts make wallets automatable. Models can reason.

**Access is not agency. Raw rails do not create trust. Raw models do not create judgment.** The bottleneck has shifted from capability to control — from *can a machine reach a market* to *can a serious operator delegate real financial action to software and still have trust, memory, approvals, and the right to say no*. That's the gap.

General Liquidity is building the control plane for delegated finance. The layer that sits between fragmented rails and operator intent, makes the seam between them legible, and turns raw capability into something a human or an agent can actually operate with.

## Gordon — the first product expression

**Gordon is Claude Code for vibe trading.** A chat-first trading agent for crypto and stocks that lives in the terminal and behaves like a sharp desk partner: scan, analyze, plan, preview, approve, execute, monitor, reconcile.

We start with trading because markets are the unforgiving proving ground. Signals are dense. Feedback is immediate. Bad assumptions get punished. In softer categories a system can sound useful for a long time; in markets it has to become real. If delegated financial action is going to be trustworthy anywhere, it has to be trustworthy here first.

What ships today, as friends-alpha `v0.9.0-friends.9` on npm:

- **~90 tool modules** — discovery, analysis, plans, execution, backtesting (Monte Carlo + walk-forward), onchain (Solana + EVM + Polkadot), rails (Helius, MoonPay, Polygon, Chainlink CCIP), fundamentals (Finnhub, SEC).
- **Real venue adapters** — Binance, Coinbase, Kraken, Bitfinex, Gemini, OKX, Hyperliquid; broker REST for Alpaca, Schwab, IBKR, E*TRADE, Tastytrade, TradeStation, Tradier, Trading 212, Webull. A conformance matrix in CI so broker quality is measured, not assumed.
- **Six permission modes** — `auto` / `ask` / `strict` / `paper` / `observe` / `plan` — one truth table, enforced at static preflight, runtime approval, and every adapter.
- **Agent runtime** — Mastra with validated handoffs, cross-agent shared context, LibSQL vector memory, MCP plugin support.
- **Serious safety surface** — input guardrails, access control, rate limits, risk gates, audit log, OpenTelemetry traces, source-map and npm-pack leak guardrails in CI. Cross-platform signed binaries for macOS (x64/arm64), Linux (glibc + musl, x64/arm64), Windows (x64).

Zero revenue, zero design partners yet. That is the honest state, and it's the right state to walk into a residency with.

## Why now

Three curves are crossing. Machine-native rails (crypto) are finally programmable end-to-end. Models are finally good enough to route, reason, and refuse. Brokerage and exchange APIs are finally exposed to software. The piece missing is the operator-facing control plane that unifies them — which is a product problem, not a research problem. The first serious team to solve it owns the seam, and the seam is the moat.

## The 30 days

Lightyear's value isn't capital. It's environment. Here is the output I commit to producing in one month in San Francisco with the cohort:

1. **Close the paper-trading loop.** `paper` is a permission mode today; wire the execution engine so every plan can be simulated on live market data with realistic fills. Paper becomes the safe on-ramp to `ask`.
2. **One killer workflow, polished.** Pick one high-conviction loop — morning brief → plan → backtest → execute — and polish it to the point where an operator runs it daily without thinking about the tool.
3. **First 20 paid users.** Friends-alpha → priced beta, real upgrade prompt, real churn signal. Twenty operators at a real price giving me truth beats two thousand on a waitlist.
4. **Three essays shipped at generalliquidity.com.** Extending the public thesis — next drafts are on agent-to-agent execution, the economics of the seam once rails commoditize, and what `auto` mode really means in regulated trading.

These are measurable, and they are the exact four things I cannot do from my apartment in a month alone. They need peers, sharp feedback, and no context switches.

## Why Lightyear

I don't need seed capital to ship the next version of Gordon. The codebase is load-bearing, the binaries ship, and the thesis is on record. What I need is a curated room of technical founders doing their best work, for thirty days, with nothing else in the way. HF0's claim that environment is the binding constraint on exceptional output is exactly right for this phase. Solo founder, technical product, no co-founder to argue with, no team to manage — put me in a room with other people building serious systems and Gordon gets a year better in a month.

---

<sub>Further reading at [generalliquidity.com](https://generalliquidity.com): *Why General Liquidity Exists* · *Why Trading Comes First* · *The Seam Is the Moat* · *Crypto Was Built for Agents* · *The Agentic Buyer* · *Everything-as-a-Market* · *Agent Payments Won't Look Like Checkout* · *Banking After the Wallet* · *User Ownership == Margin Capture* · *DAOs in the Age of Software Abundance*</sub>

<sub>© General Liquidity, Inc. — The control layer for agentic finance.</sub>
