# ICP Definition: Gordon / General Liquidity
*Skill: startup-icp-definer | Generated: 2026-04-16*
*Note: Framework adapted from B2B to B2C/prosumer — buyer and user are the same person (the retail operator).*

---

## Executive Summary

**Primary Operator Profile:** The Stuck Operator — a self-directed retail investor aged 22–34 with market conviction, multiple brokerage accounts, and the execution infrastructure gap.
**Primary Pain:** Has the thesis. Can't enforce it. Knows what they should do. Can't stop themselves from doing the wrong thing.
**Urgency Level:** High — triggered by a recent loss, failed automation attempt, or copy-trading burn.
**Willingness to Pay:** High for discipline infrastructure; low for another data tool.

---

## Operator Profile (replaces Company Profile in B2C context)

### The Stuck Operator

| Attribute | Definition | Rationale |
|---|---|---|
| Age | 22–34 | Peak intersection of crypto-native identity + income to invest + frustration with current tools |
| Income | $40–120k | Has disposable capital; not wealthy enough for a financial advisor; too sophisticated for passive index investing |
| Portfolio size | $5k–$75k actively managed | Enough to care deeply about execution quality; small enough that institutional tools are priced out |
| Accounts | 2–4 brokerages/exchanges (Robinhood + Coinbase + one more) | Already inside the system; access is not the problem |
| Content diet | Finance Twitter/X + algo/quant content simultaneously | Understands the gap between what sophisticated traders do and what tools let them do |
| Technical comfort | Medium-high — uses Claude Code, Cursor, or has tried APIs | Will not be intimidated by a terminal UI; may even prefer it |
| Automation history | Has attempted bot-building (ChatGPT + Alpaca, Pine Script, 3Commas) | Has proven motivation and hit the complexity wall |
| Geography | US-first (also UK, AU, EU where crypto + equities overlap) | Regulatory alignment; English-first community |

### Trigger Events (what makes them look for Gordon right now)

| Trigger | Description | Urgency |
|---|---|---|
| Recent emotional trading failure | Revenge trade, FOMO entry, held past their own stop — knew it was wrong in the moment | High |
| Failed DIY automation attempt | Built something with ChatGPT + Alpaca or Pine Script, it broke or didn't work as intended | High |
| Copy trading burn | Followed a signal service or influencer, took losses, felt no control | High |
| Watched a move they "saw coming" | Had a thesis that played out, couldn't capture it cleanly | Medium-High |
| Institution vs. retail article/post | Reads about HFT, algorithmic dominance, or the 7-13% positive P&L stat for retail | Medium |
| Gordon early access announcement | Sees the product in developer community, finance Twitter, or from a friend in the alpha | Medium |

### Fit Criteria

| Criterion | Perfect Fit | Good Fit | Disqualifier |
|---|---|---|---|
| Current accounts | Has crypto + equities accounts | Has one or the other | Completely new to investing |
| Automation history | Tried to build a bot or use an API | Has thought about it seriously | Never considered systematic trading |
| Content diet | Follows both finance Twitter AND quant/algo content | Follows one or the other | Passive index investor only |
| Technical comfort | Terminal-comfortable (Claude Code, Cursor, CLI user) | Not afraid of a config file | Only comfortable with mobile apps |
| Portfolio intent | Actively manages positions, has thesis-based trades | Occasionally trades around a thesis | Set-and-forget passive only |
| Loss history | Has experienced at least one significant emotional trading failure | Intellectually understands the risk | Has never traded actively |

---

## Persona 1: The Stuck Operator (Primary — buyer = user)

*Gordon is a direct consumer product. The person who pays is the person who uses it. The "economic buyer" and "end user" are the same human.*

```
┌─────────────────────────────────────────────────────────────────┐
│ THE STUCK OPERATOR                                              │
├─────────────────────────────────────────────────────────────────┤
│ Age: 25–32                                                      │
│ Occupation: Software engineer / tech worker / finance adjacent  │
│ Income: $60–100k                                                │
│ Portfolio: $15–40k actively managed                             │
│ Location: US (SF, NYC, Austin, remote)                          │
│ Tech comfort: High                                              │
├─────────────────────────────────────────────────────────────────┤
│ DAILY REALITY:                                                  │
│ • Reads Cobie, Avi Bhatt, Murad, or macro Twitter in the AM    │
│ • Has a thesis. Usually a good one.                             │
│ • Opens Robinhood or Coinbase, hesitates, maybe trades wrong   │
│ • Has a TradingView tab open in the background                  │
│ • Has tried: ChatGPT + Alpaca API, Pine Script, 3Commas        │
│ • All of them either broke, were too complex, or didn't work    │
│   the way they meant                                            │
├─────────────────────────────────────────────────────────────────┤
│ PAINS:                                                          │
│ 1. "I know what I should do. I can't make myself do it."       │
│ 2. "The entry was right. I sized it wrong and got shaken out." │
│ 3. "I've tried building automation three times. It breaks."    │
│ 4. "I use 4 different tools and none of them talk to each      │
│    other."                                                      │
│ 5. "Copy trading felt like giving up control. Also I lost      │
│    money."                                                      │
├─────────────────────────────────────────────────────────────────┤
│ DESIRED OUTCOME:                                                │
│ "Something that enforces my own rules on me, so I trade like   │
│ I know how to trade, not like I feel in the moment."           │
├─────────────────────────────────────────────────────────────────┤
│ WHAT THEY NEED TO BELIEVE BEFORE BUYING:                        │
│ 1. "This actually executes — it's not just another chatbot."   │
│ 2. "It won't do something I didn't ask for."                   │
│ 3. "I can start on paper and move to live when I'm ready."     │
│ 4. "It covers both my crypto and my stocks."                   │
└─────────────────────────────────────────────────────────────────┘
```

---

## Persona 2: The Crypto-Native Power User (Secondary — first 100 operators)

```
┌─────────────────────────────────────────────────────────────────┐
│ THE CRYPTO-NATIVE POWER USER                                    │
├─────────────────────────────────────────────────────────────────┤
│ Age: 22–30                                                      │
│ Occupation: Web3 developer, DeFi researcher, protocol team,    │
│             or crypto-adjacent tech                             │
│ Portfolio: $25–100k actively managed, heavy crypto             │
│ Location: Global (US, EU, SEA, LatAm)                          │
│ Tech comfort: Very high — has used APIs, writes scripts        │
├─────────────────────────────────────────────────────────────────┤
│ DAILY REALITY:                                                  │
│ • Uses Binance Advanced, Hyperliquid, and possibly Uniswap     │
│ • Monitors multiple chains, DEX flows, onchain wallets         │
│ • Has custom alerts, maybe a home-built bot                    │
│ • Follows onchain analysts (Lookonchain, Nansen, Arkham)       │
│ • Has missed entries because monitoring is fragmented           │
├─────────────────────────────────────────────────────────────────┤
│ PAINS:                                                          │
│ 1. "I monitor 6 things to trade one thing."                    │
│ 2. "My bot handles execution but not research or sizing."      │
│ 3. "I'm good at crypto. I want to start trading stocks too     │
│    but starting over with a whole new stack is exhausting."    │
│ 4. "There's no product that does onchain AND CEX AND stocks."  │
├─────────────────────────────────────────────────────────────────┤
│ DESIRED OUTCOME:                                                │
│ "One environment for research, planning, and execution across  │
│ everything I trade — including onchain."                        │
├─────────────────────────────────────────────────────────────────┤
│ WHY THEY CONVERT FIRST:                                         │
│ Lowest time-to-value. Already has accounts. Has the mental     │
│ model. Has felt the pain of fragmentation acutely.             │
│ Most likely to become champions.                               │
└─────────────────────────────────────────────────────────────────┘
```

---

## Persona 3: The Sophisticated Late Majority (Gordon Desk era, ~18 months out)

```
┌─────────────────────────────────────────────────────────────────┐
│ THE SOPHISTICATED LATE MAJORITY                                  │
├─────────────────────────────────────────────────────────────────┤
│ Age: 30–45                                                      │
│ Occupation: Finance professional, entrepreneur, HNW individual │
│ Portfolio: $100k–$500k actively managed                        │
│ Tech comfort: Medium — uses tools but doesn't build            │
├─────────────────────────────────────────────────────────────────┤
│ WHY THEY COME LATER:                                            │
│ • Need a more polished interface (Gordon Desk)                  │
│ • More risk-averse; need institutional-grade audit log          │
│ • May want a financial advisor to use Gordon alongside them    │
│ • Will pay more ($200+/month) once category is proven          │
└─────────────────────────────────────────────────────────────────┘
```

---

## Pain Point Hierarchy

| Rank | Pain | Urgency | Cost | Frequency | Actively Solving? | Score |
|---|---|---|---|---|---|---|
| 1 | Emotional execution failure (knows what to do, can't enforce it) | H | H | H | Y | 11 |
| 2 | Execution-systematization gap (has thesis, can't build infrastructure) | H | H | H | Y | 11 |
| 3 | Tool fragmentation (4-6 tabs/apps for one trade) | H | M | H | Y | 10 |
| 4 | Copy trading structural failure (gave up control, still lost) | H | H | M | N | 8 |
| 5 | Information asymmetry (always arriving after institutions) | M | H | H | N | 8 |
| 6 | Failed DIY automation (built something, it broke) | H | M | M | Y | 9 |
| 7 | Crypto-equities fragmentation (different tool for each) | M | M | H | N | 7 |

**Primary pain to lead with:** #1 and #2 are co-equal — they're the same underlying problem (discipline infrastructure gap). Lead with: *"You already know what to do. Gordon makes sure you actually do it."*

---

## Buying Center (adapted for direct consumer)

For a B2C consumer product, the "buying center" is one person plus their influencer network:

| Role | Who | Power | How to Win |
|---|---|---|---|
| Operator (buyer + user) | The Stuck Operator | Decision-maker | Paper mode on-ramp, plan-first trust, multi-venue coverage proof |
| Community influencer | Finance Twitter account, Discord alpha leader, quant blogger | Recommender | Early access, creator tier, showcase their trades done with Gordon |
| Peer champion | A friend in the alpha cohort | Social proof | Friends-alpha program → word of mouth |
| Trust blocker (internal) | The operator's risk-aversion | Veto risk | Paper mode, permission modes, audit log, no-autonomous-execution-without-approval |

**Note:** The #1 "blocker" is the operator's own fear that the agent will do something unexpected with real money. The plan-first "structured diff" preview directly addresses this. It is the trust mechanism that converts interested prospects into paying operators.

---

## Where to Find Them

**Communities:**
- r/algotrading, r/CryptoCurrency, r/stocks, r/options, r/wallstreetbets (power users)
- Finance Twitter/X (Avi, Murad, Cobie followers)
- Crypto Discord servers (DeFi Research, Bankless community, Messari Discord)
- Hacker News (Show HN for the CLI launch)
- GitHub (developers who star trading bot repos)
- Claude Code / Cursor community (highest-fit technical profile)

**Identification signals:**
- Has public trading content on X (even low-follower accounts)
- Stars or forks trading bot repos on GitHub
- Asks questions about Alpaca API, CCXT, or 3Commas on Reddit
- Has both a crypto and a brokerage account (visible via referral links in posts)
- Posts about algo trading failures or "built a bot that" stories

**First-channel recommendation:** Finance Twitter/X + Hacker News. Both are high-concentration Stuck Operator environments. Claude Code launched on HN; Gordon's launch should follow the same pattern.

---

## Anti-Personas (who NOT to target in Phase 1)

| Type | Why They're Bad Fits Now |
|---|---|
| Passive index investors | No active trading intent; feature set is overkill; no willingness to pay |
| Complete beginners (no accounts yet) | Time-to-value is too long; onboarding cost too high |
| Professional fund managers | Regulatory constraints, compliance needs, liability — requires institutional-grade product, not Gordon CLI |
| Pure DeFi/NFT speculators | Often want fully autonomous agents, no permission gates; will fight the safety model |
| "Get rich quick" retail traders | High churn, high support cost, misaligned with Gordon's thesis-driven discipline approach |

---

## ICP Evolution Plan

**Phase 1 — Now (Gordon CLI, friends-alpha → waitlist → public):**
Crypto-Native Power Users + Stuck Operators with technical comfort. Target through: GitHub, HN, Finance Twitter, Cursor/Claude Code community. Goal: first 100 paying operators.

**Phase 2 — Gordon Desk (12–18 months):**
Sophisticated Late Majority. Visual interface removes terminal barrier. Target through: finance Twitter, YouTube, partner/creator program. Goal: 10,000 paying operators.

**Phase 3 — Personal Finance OS (24–36 months):**
The broader Gen Z financial operator. Gordon becomes the default financial home for a generation that treats managing money the way they treat managing code. Target through: all channels + embedded in partner products. Goal: millions of operators.

---

## Validation Status

| Validation | Status | Notes |
|---|---|---|
| 10+ interviews completed | ✗ | Friends-alpha cohort is first real data source; high priority |
| Pain confirmed | ✓ (proxy) | 60+ verbatim community quotes confirm pain hierarchy; needs primary research |
| Budget confirmed | Partial | Comparable products (Cursor $20, Claude Code $100) establish willingness-to-pay at $50–150/month |
| Buying process understood | ✓ | Single-person decision, trust-gated, paper mode is the on-ramp |
| Design partners identified | ✓ | Friends-alpha cohort IS the design partner cohort |

---

## First 100 Users Breakdown

| Cohort | Size | Channel | Why |
|---|---|---|---|
| Friends-alpha operators | 20–30 | Invited by founder | Highest-trust, most feedback-rich |
| Finance Twitter + GitHub early access | 30–40 | Show HN + Twitter launch | Highest concentration of Stuck Operators |
| Crypto-native Discord | 20–30 | DeFi/quant Discord communities | Pre-existing tool fragmentation pain |
| Cursor/Claude Code community crossover | 10–15 | Claude Code community, HN | Technical comfort + AI-first mindset |

---

## Interview Questions for ICP Validation

| Category | Question | What You Learn |
|---|---|---|
| Current process | "Walk me through the last trade you made — from idea to execution." | Full workflow; where the gaps are |
| Pain | "What's the most frustrating part of that process?" | Primary pain to lead with |
| Failed automation | "Have you ever tried to build your own trading automation?" | Identifies high-fit operators |
| Tool landscape | "How many apps or tools are you using to manage your trades?" | Tool fragmentation depth |
| Trust | "If an AI agent were going to make a trade on your behalf, what would it need to show you first?" | Permission model validation |
| Switching | "What would have to be true about a tool for you to pay $50/month for it?" | Willingness-to-pay threshold |
| Best-fit | "Is there someone you know who has this problem more acutely than you do?" | Referral path + ICP sharpening |
