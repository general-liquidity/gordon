# Community Pitch: Gordon / General Liquidity
*Skill: startup-pitch | Generated: 2026-04-16*

---

## Hacker News "Show HN" Post

**Title:** Show HN: Gordon – agentic trading terminal that shows you the plan before it executes

---

**Body:**

Hey HN — I'm building Gordon, a CLI-first agentic trading terminal for retail operators, and I'd love feedback from this community.

**The core problem:**

Most active traders I've talked to have the same issue — and it's not analysis. They read the market accurately. The gap is execution. They know what to do, and then they size it wrong, hold past their stop, or try to build automation and hit a wall when it breaks on a Thursday morning.

The verbatim quote I keep hearing: "I know what I should do. I can't make myself do it."

**What Gordon does differently:**

Every other tool either generates research (TradingView, Robinhood Cortex) or executes trades (3Commas, Public.com). Gordon does both — but the key thing it does that no other tool does is show you the complete execution plan before any order touches a venue.

You describe your thesis in plain language. Gordon runs research and backtesting, builds a structured plan, and presents it as a preview — exact positions, sizes, risk parameters, venue routing. You approve, modify, or reject. Nothing executes without your approval.

We call it the structured diff. It's the moment that doesn't exist in any other trading tool.

**The permission model:**

Six modes: auto, ask, strict, paper, observe, plan. The modes travel with the agent through every venue call — they're not just a global toggle. Paper mode runs full simulations with zero real capital. Strict mode requires approval for each individual action. Auto mode operates within parameters you define.

**The venue coverage:**

9 crypto exchanges (Binance, Coinbase Advanced, Hyperliquid, Kraken, OKX, and more) + 9 stock brokers (Alpaca, Interactive Brokers, Robinhood, TradeStation, and more) + onchain (Solana, EVM, Polkadot, Base). One terminal, one context.

**How it's built:**

Gordon runs on a Mastra agent network — Scanner, Analyst, Planner, Executor, Monitor, Teacher, Backtester — routed through a coordinator agent. Operators interact via a chat-first terminal UI (React/Ink). Every agent action is loggable and auditable. The permission model is enforced at the transport layer before any venue call.

It's a CLI application, which I know is unusual for a trading product. The audience is operators who are comfortable with terminal UIs — Claude Code users, Cursor users, developers who've tried building their own Alpaca bots.

**Where we are:**

Friends-alpha, v0.9.0. I'm opening a waitlist and would love feedback specifically on: (1) the plan-first preview UX, (2) whether the permission mode framing makes sense, and (3) what's missing for your trading workflow.

Paper mode is free — full research, real backtesting, no live capital required to evaluate.

[link to waitlist / GitHub]

---

## Twitter/X Launch Thread

**Opening tweet (pin this):**

Launching Gordon — the agentic trading terminal that shows you the plan before executing it.

You describe the thesis. Gordon builds the plan. You approve. Then it executes — across crypto exchanges, stock brokers, and onchain.

The one thing no other trading tool does: show you exactly what will happen before anything happens.

Thread on why this matters ↓

---

**Tweet 2:**

The problem isn't information. It's execution.

You read the chart. You saw the setup. You knew the thesis. And then you either:
- sized it wrong and got shaken out
- watched the move happen while you hesitated
- built automation that broke at 3am
- used 4 different apps and missed the window

"I know what I should do. I can't make myself do it." — this is the quote I heard over and over.

---

**Tweet 3:**

Most trading tools assume the problem is research. So they give you better research.

Most bot platforms assume you want full automation. So they take away control.

Gordon is neither.

It's execution infrastructure that enforces your own rules — with you as the final authority at every decision point.

---

**Tweet 4:**

The plan-first preview is the whole thing.

Gordon shows you a structured diff before any order hits a venue:
- exact positions and sizes
- risk parameters
- venue routing
- expected execution path

You approve, modify, or reject. Nothing happens until you say go.

This is the moment that doesn't exist in any other trading tool.

---

**Tweet 5:**

Six permission modes for exactly as much (or little) automation as you want today:

Paper → observe → plan → strict → ask → auto

Start in paper mode. Full research, real backtesting, zero live capital. Move to live execution when you're ready. Dial up trust as it's earned.

Your rules. Your risk tolerance. Your pace.

---

**Tweet 6:**

Coverage:

9 crypto exchanges: Binance, Coinbase Advanced, Hyperliquid, Kraken, OKX, and more
9 stock brokers: Alpaca, IBKR, Robinhood, TradeStation, and more
Onchain: Solana, EVM, Polkadot, Base

One terminal. One context. One plan.

No more "crypto tab, equities tab, and a TradingView tab" for the same position.

---

**Tweet 7:**

Currently: friends-alpha (v0.9.0)

Free tier: paper trading + observe mode. Full research and backtesting included. No live capital required to see what Gordon actually does.

Waitlist open now for the public launch.

If you've ever had a thesis that played out while you watched, or built automation that broke — this was built for you.

[link]

---

## Reddit r/algotrading Post

**Title:** Built an agentic trading terminal that shows you the execution plan before it runs — looking for feedback from this community

---

**Body:**

Been building for a while in this community, so wanted to share something real and get honest feedback.

The product is Gordon — an agentic trading terminal. The architecture is a multi-agent system (research, planning, execution, monitoring, backtesting as separate agents) that sits between your plain-language thesis and your actual brokerage/exchange accounts.

The thing I keep coming back to that differentiates it from every other approach I've seen: the plan-first preview.

Before any order hits a venue, Gordon generates a structured execution plan — exact positions, sizes, risk parameters, venue routing — and presents it to you for approval. You review it, modify it if needed, and approve. Nothing executes without that approval. This came directly from the most common failure mode I heard about when talking to operators: "I don't trust any bot to do what I actually meant."

The permission model has six modes: auto, ask, strict, paper, observe, plan. Strict mode requires your approval for each individual action. Paper mode runs full simulations with no real capital. The modes are enforced at the transport layer — they're not just a UI setting.

Venue coverage: 9 crypto exchanges (Binance, Coinbase Advanced, Hyperliquid, Kraken, OKX) + 9 stock brokers (Alpaca, IBKR, Robinhood, TradeStation) + onchain (Solana, EVM, Base). One context for everything you trade.

Backtesting: Monte Carlo + walk-forward validation, built into the same workflow as execution. You can backtest your thesis before approving the live plan.

Technical details for those who want them: built on Mastra's agent network, custom-patched for multi-agent message routing, chat-first terminal UI in React/Ink, permission model enforced at every venue transport call.

This is not a no-code product. The target operator is someone who's comfortable with a CLI — people who've built Alpaca bots, used CCXT, set up Pine Script, etc. If you've tried to build your own trading automation and hit the complexity wall, this is the infrastructure layer you were trying to build.

Currently in friends-alpha (v0.9.0). Paper mode is free — full research, real backtesting, no live capital required.

Honest questions I'd want feedback on:
1. Is the plan-first preview actually how you want to interact with an execution agent, or is it more friction than value?
2. Does the six-mode permission model match how you think about trust and autonomy?
3. What's missing for your actual workflow?

Not looking for hype. If there are failure modes I haven't thought about, I want to hear them.

[link to waitlist / GitHub]

---

## Discord Alpha Announcement Template

**For DeFi/quant Discord servers:**

---

hey everyone — wanted to share something we've been building that's relevant to this community.

we just opened the friends-alpha waitlist for **Gordon** — an agentic trading terminal that covers crypto (9 exchanges including Binance, Hyperliquid, and Kraken), stocks (9 brokers including Alpaca and IBKR), and onchain in one place.

the thing that makes it different from every other setup I've seen: it shows you the execution plan before running it. you describe your thesis, Gordon builds the plan, you review the exact positions/sizes/risk params, you approve, then it executes. nothing hits a venue without your sign-off.

six permission modes from fully supervised (strict, plan-only) to more autonomous (ask, auto). full paper trading included in the free tier.

for folks here who've tried to build their own automation stack — this is the infrastructure layer. built by someone who hit the same walls you've hit.

**paper mode is free** — full research, backtesting, no live capital required to see if it's useful for your workflow.

waitlist: [link]

would love feedback from people doing real systematic trading. drop questions here or DM.
