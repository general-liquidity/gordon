# Startup Canvas: Gordon / General Liquidity
*Skill: startup-canvas | Generated: 2026-04-16*

---

## Part 1: Product Strategy

---

### 1. Vision

**The worldbuilding thesis:**

The agentic economy is already running. Institutions operate markets with fully systematized AI — quant models, microstructure intelligence, automated execution at scale. Every retail investor is on the other side of that trade, reacting manually with a mobile app and a gut feeling. That asymmetry is not accidental. It is the product incumbents sell.

General Liquidity exists to close it.

The vision is not "make trading easier." It is to give the agentic generation the same *control plane* that institutions already use — but built for a single operator, in natural language, running across every venue they touch. The right analogy is not a better Robinhood. It is Cursor for markets: an agent that amplifies your judgment rather than replacing it, that enforces your rules instead of ignoring them, and that shows you exactly what it will do before it does anything.

In 10 years, the question will not be "should a retail investor have access to systematic execution?" That battle is decided by the existence of algorithms. The question will be "which retail operators chose to participate, and which ones watched?" Gordon's job is to make participation the default.

---

### 2. Market Segments

Defined by JTBD (job-to-be-done), not demographics.

#### Segment A: "The Stuck Operator" — Primary, Start Here

**Job:** *"Enforce my own thesis on myself so I trade the way I know how to trade, not the way I feel in the moment."*

This is a discipline infrastructure job, not an information job. The Stuck Operator already has market conviction, multiple brokerage accounts, a content diet that spans finance Twitter and quant blogs simultaneously, and at least one emotional trading failure they saw coming and couldn't prevent. The problem is not knowledge. The problem is execution infrastructure.

Characteristics that identify this segment:
- Has tried to build automation (ChatGPT + Alpaca, Pine Script, 3Commas) and hit the complexity wall
- Has both crypto and equities accounts open simultaneously
- Comfortable with Claude Code, Cursor, or CLI environments
- Income $40–120k; actively managing $5k–$75k
- Trigger: recent emotional loss, failed DIY bot, or copy trading burn

**Why start here:** The switching trigger is acute and recent. They already understand the problem in the exact vocabulary Gordon uses to solve it. Time-to-conviction is low. Time-to-value is low if they have existing API credentials. And they are concentrated in discoverable communities (r/algotrading, Finance Twitter, GitHub, HN).

**Why not start with beginners:** Onboarding cost is too high. The product's value is proportional to the operator's existing market knowledge — Gordon amplifies conviction, it does not manufacture it.

#### Segment B: Crypto-Native Power User — Secondary, First 100 Operators

**Job:** *"Unify my fragmented monitoring and execution stack across CEX, DEX, and now equities without rebuilding from scratch."*

This is a consolidation and cross-asset extension job. They already have the mental model, the accounts, and the frustration. They are currently running custom scripts, Binance Advanced, Hyperliquid, and Nansen simultaneously for a single trade. Adding stocks requires a completely new stack — which they haven't done because the cost is too high. Gordon eliminates the cost.

**Why second:** Lowest time-to-value (no onboarding needed beyond API keys), highest likelihood of becoming product champions. This cohort converts to Stuck Operator behavior as their portfolio grows.

#### Segment C: Sophisticated Late Majority — Gordon Desk era (~18 months)

**Job:** *"Run a systematic trading operation across a meaningful portfolio without hiring a quant team or navigating institutional software."*

Finance professionals, entrepreneurs, HNW individuals managing $100k–$500k. They need a visual interface (Gordon Desk), institutional-grade audit logs, and possibly collaborative multi-operator workflows. They will pay $200–$300/month once the category is proven. Do not target them now — the CLI interface and friends-alpha signal quality are wrong for their risk tolerance.

---

### 3. Relative Costs

**Positioning: Unique value, not low cost.**

Gordon is not competing on price. The relevant comparison is:
- TradingView Pro: $59.95/month for charts and analysis, zero execution
- 3Commas Pro: $59/month for crypto bots only, no equities, no plan-first
- Cursor Pro: $20/month for code execution (the mental model analog)
- A quant contractor: $150–$300/hour for infrastructure the Stuck Operator would build themselves

At $49–$149/month, Gordon is priced at "less than one emotional trading mistake per month." That is the correct price anchor — not feature parity with cheaper tools.

**Build decisions this shapes:**

The cost frame has two direct implications for what gets built versus what gets deferred:

1. **Build the trust surface, not the analytics surface.** Competitors commoditize research and charting. Gordon's unique value is in the plan-first preview, the permission model enforcement, and the audit trail. Investment in these differentiators has asymmetric return. Investment in another candlestick overlay does not.

2. **Defer consumer aesthetics, build operator reliability.** The Stuck Operator is terminal-comfortable. They will tolerate a CLI interface if the execution is trustworthy and the workflow is complete. Polish is a Phase 2 investment (Gordon Desk). Phase 1 capital should go into venue breadth, safety surface, and workflow completeness — not pixel-perfect UI.

**Cost structure implication:** The dominant variable cost is AI inference (sub-agent calls at scale). This makes per-operator AI spend the primary unit economics risk. The six-mode permission model is also an economic lever: paper mode operators cost near-zero in venue fees; pro/power operators generate venue transaction volume that could support take-rate in Phase 2.

---

### 4. Value Proposition

#### For the Stuck Operator

| Stage | Description |
|---|---|
| **Before** | Has a thesis. Opens Robinhood or Coinbase. Hesitates. Trades wrong. Reviews the mistake and knows exactly when and why it happened. Repeats it next week. Has tried to build a bot three times. |
| **How Gordon helps** | Operator describes intent in natural language. Gordon scans relevant venues, builds a structured execution plan, shows every order before it's placed ("structured diff"), and only executes when the operator explicitly approves. The permission model (paper → ask → auto) matches the operator's current trust level. The agent enforces the operator's rules, not the operator's momentary feelings. |
| **After** | Executes the thesis they actually had, not the panic trade they made. Can run the same strategy across crypto and equities without rebuilding logic. Knows what happened, why, and what the reconciliation shows. Trust compounds with the agent over time. |
| **vs. Alternatives** | TradingView shows you the chart but won't enforce your stop. 3Commas automates crypto but ignores equities. Copy trading gives up control and often loses money. ChatGPT + Alpaca breaks and requires maintenance. Gordon is the first product that closes the loop: from idea to execution to reconciliation in one operator-controlled interface. |

#### For the Crypto-Native Power User

| Stage | Description |
|---|---|
| **Before** | Monitors Lookonchain, Nansen, Binance Advanced, and DEX flows in separate tabs. Has a signal. By the time the cross-chain sizing math is done, the entry is gone. Adding stocks means starting a completely new stack from scratch. |
| **How Gordon helps** | Single chat interface across 9 crypto exchanges, onchain (Solana, EVM, Polkadot, Base), and 9 stock brokers. Scanning, research, backtesting, and execution in one environment. Monte Carlo and walk-forward validation for sizing decisions. |
| **After** | One environment. Context persists across sessions. Execution is consistent with research. Adding equity exposure doesn't require a new tool. |
| **vs. Alternatives** | No competitor spans DeFi + TradFi + onchain at this depth. System R AI is developer infrastructure, not a chat terminal. Tradewink is a signal pipe, not an operator workspace. |

#### Value Curve: Gordon vs. Alternatives

```
HIGH  |
      |                                          ████
      |                                ████      ████
      |                        ████    ████      ████
      |                ████    ████    ████      ████    ████
      |        ████    ████    ████    ████      ████    ████
LOW   |________________________________________________
       TradingView  3Commas  Public  System R   Gordon  Tradewink

Axes scored (H/M/L):
- Multi-venue (crypto + stocks): Gordon=H, rest=L/M
- Plan-first preview: Gordon=H, all others=zero
- Six-mode permission model: Gordon=H, all others=zero
- Chat-first (no code): Gordon=H, System R=L, TradingView=L
- Deep research + backtesting: Gordon=H, TradingView=M, rest=L
- Live execution: Gordon=H, TradingView=zero, 3Commas=M (crypto only)
- Operator data flywheel: Gordon=H (accrues), rest=zero
```

Gordon leads on the exact combination of attributes that matter to the Stuck Operator and has no direct competitor on plan-first preview or multi-venue TradFi+DeFi span.

---

### 5. Trade-offs

These are explicit strategic choices, not resource limitations. They define what Gordon is by defining what it will not be.

**1. Gordon will not be a passive investment manager.**
No AUM fee model. No set-and-forget portfolio allocation. No tax-loss harvesting overlays. No robo-advisor regulatory path. Gordon is for operators who are actively managing positions — not for people who want to delegate entirely and forget. This trade-off protects the product from the worst-fit customer (passive investors) and the most dangerous regulatory classification (investment adviser).

**2. Gordon will not be a code-first platform.**
No Pine Script editor. No Python strategy builder. No backtesting framework that requires writing code. The Stuck Operator has tried to build bots three times and failed — they are not looking for another coding environment. The chat-first constraint forces every capability to be accessible in natural language, which is a higher bar but creates a fundamentally different product. QuantConnect and TradeStation own the code-first niche. Do not compete there.

**3. Gordon will not optimize for low-latency / high-frequency execution.**
No microsecond order routing. No co-location. No market-making primitives. The Stuck Operator is sizing $5k–$75k positions at human-speed conviction cycles, not running arbitrage at nanosecond precision. Optimizing for HFT infrastructure would cost orders of magnitude more and serve zero of Gordon's target operators. This trade-off keeps the infrastructure cost structure sane.

**4. Gordon will not operate without a human approval gate in the default configuration.**
Fully autonomous execution without plan-first review is not a feature of Gordon. The agent always shows the operator what it will do before it does it (in any mode other than explicit auto mode with the operator's deliberate configuration). This is a safety-first trade-off that costs some conversion among users who want "just let it trade for me" — and it is worth that cost, because it is both Gordon's primary trust differentiator and its regulatory moat.

**5. Gordon will not target beginners in Phase 1.**
No onboarding flow designed for someone who has never traded. No "what is a candlestick" educational content. No Robinhood-style simplified UX. The product amplifies existing knowledge — it does not generate it. Targeting beginners in Phase 1 would require building a financial education product, which is a different company.

---

### 6. Key Metrics

#### North Star Metric
**Operator-Weeks Active** — the number of unique operators who completed at least one full workflow cycle (scan → plan → preview → execute or paper-execute) in a given week.

This is the North Star because it measures the product doing its actual job: turning conviction into disciplined execution on a recurring basis. A user who logs in once and never returns is not an operator. An operator who uses Gordon every week is building the habit that creates retention, the data flywheel that creates moat, and the word-of-mouth that creates growth.

#### One Metric That Matters (OMTM) — Q2 2026
**Plan-First Conversion Rate** — percentage of operators who reach the preview step and confirm execution (rather than abandoning at the plan stage).

This is the trust metric. If operators consistently abandon at the plan stage, the plan preview is generating anxiety rather than resolving it. If conversion is high (>60%), the trust mechanism is working and the safety model is an accelerant, not a barrier. This is the single most important signal during friends-alpha and early public launch.

#### Supporting Metrics

| Metric | Why It Matters | Target (Q2 2026) |
|---|---|---|
| Venue connection rate | % of new operators who connect at least one live venue (not just paper) | >50% by week 4 |
| Permission mode graduation | % of paper-mode operators who upgrade to ask/auto within 60 days | >30% |
| Weekly workflow cycles per operator | Depth of engagement; operator habit formation | >2 cycles/week for active cohort |
| P90 time-to-first-plan | How long from onboarding to first plan preview; measures friction | <15 minutes |
| Organic referral rate | % of new signups who name another Gordon operator as their source | >20% during alpha → public |

---

### 7. Growth

#### PLG vs. SLG Decision: PLG, with community amplification

Gordon is a developer-adjacent, terminal-first product launching in the exact communities (HN, GitHub, Claude Code, Finance Twitter) where PLG motions work. SLG would require sales people Gordon doesn't have, targeting buyers who are not yet in a discoverable pipeline, for a product that is best understood by doing, not by being pitched. The decision is PLG.

**Channel playbook by phase:**

**Phase 1 — Friends-Alpha to Public (Now)**

*GitHub public launch:*
The CLI is the product. Releasing on GitHub signals "this is a real tool built by engineers" to the Crypto-Native Power User cohort. GitHub stars are a proxy credibility signal for the Stuck Operator who finds Gordon via HN or Twitter.

*Show HN:*
The canonical launch channel for developer-adjacent tools with a genuine technical story. Gordon's architecture — multi-agent network, plan-first structured diff, permission model enforcement — is interesting to HN readers on its own merits. The launch narrative: "We built the control plane retail operators should have had." Do not lead with "AI trading bot." Lead with the architectural innovation and the safety model.

*Finance Twitter:*
Content flywheel around "vibe trading" vocabulary. The Stuck Operator lives here. The content strategy is operator-facing, not investor-facing: trade breakdowns, plan previews as screenshots, "here's what Gordon showed me before this trade." Social proof before testimonials. Document the alpha operators' workflows publicly with their permission.

*Claude Code / Cursor community:*
The highest-fit technical audience for Phase 1. These users are already comfortable with agentic tools, already understand the "AI that acts on your behalf" paradigm, and are exactly the technical profile of the Stuck Operator. Cross-post to these communities explicitly.

**Phase 2 — Gordon Desk (12–18 months)**

*YouTube + creator program:*
Visual interface unlocks YouTube demo content. Partner with finance/trading creators who have the Stuck Operator audience. Creator program: revenue share or free Power tier for creators who document their Gordon workflows publicly.

*Finance Twitter continued:*
By this point, Gordon should own "vibe trading" vocabulary in the English-language finance Twitter sphere. The creator program feeds the content engine.

**Phase 3 — Personal Finance OS (24–36 months)**

Embedded distribution in partner products, broader financial content platforms, potentially bank/brokerage partnerships as the product spans cards, banks, and payroll. This is a different GTM motion — do not plan it now.

**Anti-channel (Phase 1):**
Paid acquisition, influencer sponsorships, and affiliate programs are wrong for Phase 1. The product is pre-public. The priority is signal quality from the right cohort, not volume. Every bad-fit operator onboarded in friends-alpha increases support cost and noise in the feedback signal.

---

### 8. Capabilities

#### What to Build (Core Competency — Do Not Outsource)

**1. The safety surface:**
The plan-first structured diff, the six-mode permission model, the risk gates, and the audit log are Gordon's primary moat. This is not a feature — it is an architecture. It must be owned completely, tested deeply, and iterated on continuously. No partner can provide this.

**2. The operator context flywheel:**
The per-operator persistent context (trading theses, prior executions, reconciliation data) is what makes Gordon smarter per operator over time. This is a preference economy asset. The data model, the compaction logic, and the context retrieval must be owned. This is also the most defensible moat against well-funded competitors who can replicate venue integrations but cannot retroactively build operator history.

**3. The workflow intelligence (sub-agent network):**
The Mastra-based multi-agent architecture — Scanner, Analyst, Planner, Executor, Monitor, Teacher, Backtester — is the product. The routing logic, the sub-agent prompt engineering, the stream processing, and the workflow state machine are irreplaceable intellectual property. Own this fully.

**4. The permission model runtime:**
The enforcement of permission modes at every venue call is a trust primitive. If this can be bypassed, the safety claim collapses. This must be owned, tested adversarially, and versioned carefully.

#### What to Partner (Integration Layer — Buy or Integrate)

**Venue connectivity:**
Building native exchange/broker SDKs from scratch for 18+ venues is not a competency advantage — it is infrastructure cost. Partner or integrate via Alpaca (equities), CCXT (crypto CEX), and Web3 RPC providers (onchain). The value-add is the orchestration layer above the integration, not the integration itself.

**AI inference:**
Anthropic (Claude) is the primary inference provider. This is a partnership, not a build. Stay model-agnostic at the configuration layer (already partially true via the Dedalus/OpenAI-compatible routing architecture) but do not build your own inference.

**Backtesting primitives:**
Monte Carlo and walk-forward validation are standard quant techniques. The implementation can use established numerical libraries. The differentiation is in how the backtesting results are surfaced to the operator and integrated into plan previews — not in the math itself.

#### Capabilities to Acquire in Next 12 Months

| Capability | Why | How |
|---|---|---|
| Regulatory / compliance knowledge | Agentic execution is in a regulatory gray zone; Gordon needs to stay ahead of SEC/CFTC classification as the product scales | Hire or advise from fintech compliance background |
| Mobile-first operator UX | Gordon Desk transition requires non-CLI interface design | Design hire or partner — this is not a CLI-engineer competency |
| Enterprise / multi-seat account management | Gordon Desk is multi-operator; seat-based billing, shared context, role permissions are enterprise features | Platform engineer hire when Desk development begins |

---

### 9. Can't / Won't

**Why competitors can't copy this exact strategy:**

#### Can't: The data flywheel has a time tax

Per-operator context compounds. An operator using Gordon for 6 months has a persistent record of their theses, executions, sizing decisions, and reconciliation patterns that makes Gordon dramatically more useful to them than any new entrant. A competitor launching today cannot retroactively acquire that operator history. The moat is not the feature — it is the accumulated context per operator. This is a time-gated moat that gets stronger, not weaker, as the product ages.

#### Can't: The seam between DeFi and TradFi is genuinely hard

Nobody else spans 9 crypto exchanges + onchain (Solana, EVM, Polkadot, Base) + 9 stock brokers + onchain in a single execution environment. This is not a single API integration — it is a multi-year investment in venue-specific normalization, credential management, permission model enforcement across heterogeneous APIs, and cross-venue position reconciliation. Public.com is US equities only. System R AI is infrastructure, not a product. 3Commas is crypto-only. The integration depth is a genuine moat because replicating it requires both the engineering investment and the operational knowledge of how each venue actually behaves.

#### Won't: Incumbents are structurally prevented from copying the permission model

Robinhood, Coinbase, and Schwab cannot build a plan-first preview that explicitly shows the operator what the AI will do before it does it — because they need the trade to execute to generate PFOF revenue. Their business model requires frictionless execution. Gordon's business model is subscription-based, so adding friction before execution is economically fine. The plan-first model is more aligned with Gordon's revenue structure than with any incumbent's.

#### Won't: "Human-above-the-loop" conflicts with fully autonomous agent startups

A well-funded competitor building fully autonomous trading agents (no human approval gate) will not copy Gordon's permission model architecture — it contradicts their product thesis and their investor narrative ("AI that trades for you"). They are optimizing for the opposite of Gordon's safety-first design. The market will bifurcate: fully autonomous (high-risk, high-reward for some users) and human-controlled (Gordon's territory). Gordon should lean into this distinction, not blur it.

#### Won't: Large platforms won't build the cross-venue control plane

A large brokerage (Schwab, Fidelity) cannot give operators permission-gated access to a competitor's exchange. Their moat is account custody — which requires keeping operators inside their platform. Building multi-venue execution that actively routes to Binance or Hyperliquid is against their business model at a structural level. The exact feature set that defines Gordon is the one incumbents are least positioned to replicate.

---

## Part 2: Business Model

---

### 10. Cost Structure

#### Fixed / Semi-Fixed Costs

| Cost Category | Description | Scale Behavior |
|---|---|---|
| Core engineering | Maintaining the multi-agent network, venue integrations, permission model runtime, safety surface | Grows with team; relatively fixed in early stage |
| Infrastructure (compute + DB) | Supabase (auth, data), hosting, background job runners | Semi-fixed; scales with operator count but not linearly |
| AI inference baseline | Fixed cost of Gordon's own internal agent calls (routing, planning, analysis per operator session) | Scales directly with active operator sessions — this is the primary variable cost risk |

#### Variable Costs (scale with operator activity)

| Cost Category | Driver | Risk Level |
|---|---|---|
| AI inference per session | Number of sub-agent calls per workflow cycle; increases with auto mode use | High — must be monitored per operator tier |
| Venue API rate limits / data feeds | Market data subscriptions, exchange API costs at scale | Medium — currently absorbed or free tier; becomes material at thousands of operators |
| Support and onboarding | Friends-alpha: founder-handled; public: scales with user count and mode complexity | Medium — reduced by paper mode as default on-ramp |

#### Unit Economics Framework

The critical unit economics question is: **what is the AI inference cost per active operator-week?**

At the current architecture (7 sub-agents, ~10 tool calls per workflow cycle), the cost per workflow cycle is a function of context window size, model tier, and number of cycles per week. The six-mode permission model is an economic lever: paper mode operators generate zero venue costs and lower inference costs (no live execution calls); auto mode operators generate higher inference costs but also the highest willingness-to-pay (Power tier at $149/month).

**Target:** Keep inference cost per operator-month below 15% of ARPU at each tier. At $49/month Pro, inference COGS target is <$7.35/operator/month. This implies strict token budget management — which the existing `contextBudget.ts` architecture partially addresses.

---

### 11. Revenue Streams

#### Subscription Tiers

| Tier | Price | Access | Target Segment | Revenue Logic |
|---|---|---|---|---|
| Free | $0 | Observe + paper modes, full research + backtesting, no live execution | Acquisition funnel; builds operator context | Zero direct revenue; highest conversion-to-paid potential because operator context accrues during paper mode |
| Pro | $49/month | Live execution, 3 venues | Stuck Operators ready to go live on primary venues | Primary revenue driver in Phase 1; priced at "one bad trade" anchor |
| Power | $149/month | Auto mode, all venues, full backtesting pipeline | Crypto-Native Power Users + advanced Stuck Operators | 3x Pro ARPU; captures operators who use Gordon as primary trading environment |
| Desk | $299/seat/month | Multi-operator, shared context, agentic multiplayer | Sophisticated Late Majority, small teams | Phase 2 (Gordon Desk); enterprise-adjacent; highest LTV per account |

#### Pricing Rationale

The Pro price ($49) is anchored against the cost of one emotional trading mistake, not against competing tools. This makes the payback period intuitive: if Gordon prevents one revenge trade per month, it pays for itself. The Power tier ($149) is anchored against the cost of fragmented tool subscriptions (TradingView Pro + 3Commas Pro + one data feed = approximately $120/month with worse outcomes). Gordon's Power tier consolidates and executes.

The free tier is not a compromise — it is the trust engine. An operator who runs paper mode for 4 weeks has built a working model of how Gordon behaves with their capital and their theses. When they upgrade to live execution, they are upgrading from a known system. The paper-to-pro conversion is the most important funnel event in the business.

#### Phase 2 Revenue Extension: Take-Rate

When Gordon Desk is live and operator volume crosses a threshold that justifies venue partnership conversations, a transaction take-rate model becomes viable. The mechanics:
- Preferred venue routing for operators at power/desk tiers
- Revenue share with venues for order flow (distinct from PFOF — this is service fee, not informational)
- Onchain execution fees on DeFi routes (small basis-point fee on Gordon-routed transactions)

This is not a Phase 1 revenue model — it requires volume and venue relationships. It is worth noting as a Phase 2 unlock because it fundamentally changes the unit economics: at scale, a take-rate model has near-zero marginal cost of revenue, making the subscription tiers a floor, not a ceiling.

#### Phase 3 Revenue Extension: Embedded / Partnership

At Personal Finance OS scale, Gordon's persistent operator context (spending patterns, investment positions, income flows) becomes a data asset that can power embedded financial products (credit, insurance, tax, refinancing recommendations) with revenue-share or embedded product fees. This is a 3–5 year horizon — do not optimize for it now, but do not build the data architecture in ways that make it impossible.

---

## Part 3: Strategy Coherence Check

---

### Do All Elements Reinforce Each Other?

**Reinforcing loops (strong coherence):**

- The free tier (paper mode) builds operator context → context makes Gordon more useful → operators upgrade to live execution → upgraded operators generate data flywheel entries → flywheel makes Gordon more valuable per operator → retention increases → organic referrals increase. The paper-mode-as-funnel strategy and the data flywheel strategy are the same strategy.

- The plan-first preview addresses the primary trust barrier → trust enables permission mode graduation (paper → ask → auto) → auto mode operators generate higher inference spend but pay $149/month → the safety architecture that was initially a constraint becomes the upsell engine.

- The six-mode permission model serves as both a product differentiator (unique architecture), a safety mechanism (regulatory moat), and a pricing lever (auto mode = Power tier). One architectural decision does three strategic jobs.

- The DeFi + TradFi integration breadth is the reason the Crypto-Native Power User converts immediately → those conversions generate the first operator testimonials → testimonials drive Stuck Operator conversions → both cohorts compound the data flywheel.

**Tensions (acknowledge and manage):**

*Tension 1: CLI-first product vs. non-technical Stuck Operator*
The ICP includes some operators who are "medium-high" technical comfort — not engineers, but comfortable enough. A terminal UI will filter out a meaningful portion of the addressable Stuck Operator market. This is correct for Phase 1 (the filter improves signal quality and reduces support cost) but is a growth constraint that Gordon Desk must resolve. The tension is managed by treating the CLI as a deliberate Phase 1 filter, not a permanent market limitation.

*Tension 2: Trust-first design vs. conversion velocity*
Every step in the plan-first workflow is a step where an operator can abandon. The safety model that builds trust also creates conversion surface area. This is the correct trade-off — a broken trust event (unexpected autonomous trade) would kill the product permanently, while a slow funnel can be optimized. But it means Plan-First Conversion Rate must be actively managed, not assumed to be fine.

*Tension 3: Sub-agent inference cost vs. low-tier pricing*
At $49/month Pro, an operator running multiple workflow cycles per day could generate inference costs that compress margins significantly. The permission model helps (paper mode operators cost less), but the power tier pricing must be calibrated against actual P90 inference cost per active operator. If the most active operators are all on Pro tier, the unit economics break. This is a pricing design problem that should be addressed before public launch with actual cost telemetry from the friends-alpha cohort.

---

### 3 Critical Hypotheses

**Hypothesis 1: The trust mechanism converts**
*"Operators who see the plan-first preview are more likely to execute than operators who don't — and they are more likely to return."*

This is the foundational hypothesis of the entire product architecture. If plan-first preview generates anxiety (confusion, complexity, decision fatigue) rather than resolving it, the core differentiation collapses. The OMTM (Plan-First Conversion Rate) tests this directly. Everything else is downstream.

**Hypothesis 2: The paper-to-live graduation is a real funnel**
*"Operators who use paper mode for 2–4 weeks convert to live execution at a meaningful rate (>30%) without requiring active sales effort."*

The free tier only works as a growth mechanism if paper mode operators graduate to paid. If paper mode is "good enough" and operators never feel urgency to go live, the free tier creates audience but not revenue. This hypothesis is testable within the first 60–90 days of public launch.

**Hypothesis 3: The multi-venue span is a durable differentiator**
*"Operators who connect both crypto and equities venues churn at materially lower rates than operators using only one asset class."*

Multi-venue is the moat claim. But it only matters if operators actually use multiple venues through Gordon — and if that cross-venue use creates lock-in (not just convenience). If operators use Gordon for crypto only and continue to use a separate tool for stocks, the DeFi + TradFi thesis is not being validated. This hypothesis determines whether the integration investment is paying off in retention terms.

---

### 2–3 Low-Effort Experiments

**Experiment 1: Plan-First Abandonment Heuristic (Days 1–14)**
*Tests Hypothesis 1. Effort: Low (telemetry annotation).*

In the friends-alpha cohort, add a single annotation event when an operator reaches the plan preview step. Track: (a) percentage who confirm execution, (b) percentage who modify the plan before confirming, (c) percentage who abandon. If abandonment is >40%, instrument exit with a one-question prompt: "What stopped you?" The signal from 20–30 alpha operators is enough to determine whether the trust mechanism is working or needs UI/UX iteration before public launch. This requires no new features — only event logging.

**Experiment 2: Paper Mode Email / Prompt at Day 14 (Week 2–3)**
*Tests Hypothesis 2. Effort: Low (single email or in-product prompt).*

For paper-mode operators who have completed at least 3 paper-execution cycles in their first 14 days, send a single prompt: "Your paper trading results are in. Here's how your positions would have performed. Ready to try a live position?" Include a direct link to venue connection flow. Measure: (a) click-through rate, (b) venue connection rate among clickers, (c) first live execution rate within 7 days. This tests the paper-to-live graduation with near-zero engineering cost.

**Experiment 3: Crypto-Only vs. Multi-Venue Cohort Retention (Week 4–8)**
*Tests Hypothesis 3. Effort: Low (cohort tagging in analytics).*

Tag operators at onboarding into two cohorts: (a) connected crypto only, (b) connected both crypto and equities. At Day 30, compare: (a) weekly active sessions, (b) workflow cycle count, (c) voluntary churn (cancelled or went idle). If multi-venue operators show materially higher engagement (hypothesis predicts yes), this validates the DeFi + TradFi thesis as a retention mechanism — and justifies prioritizing equities venue depth in the Phase 1 roadmap. This requires no new features — only a cohort tag at registration.
