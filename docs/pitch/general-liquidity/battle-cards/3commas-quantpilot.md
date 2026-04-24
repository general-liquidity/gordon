# Battle Card: 3Commas QuantPilot vs Gordon / General Liquidity
*Skill: startup-competitors | Generated: 2026-04-16*

---

## Who They Are

3Commas is a crypto trading bot platform founded in 2017. [Knowledge-Based] They launched QuantPilot on April 2, 2026 — a research and strategy layer bolted onto their existing bot execution infrastructure. [Data] Their core business is crypto bot trading with DCA bots, grid bots, and composite bots. QuantPilot is an attempt to add AI-driven research and strategy generation on top of this legacy execution layer.

Their reputation in the crypto trading community is mixed. They have an established user base and years of bot trading history. They also have documented security incidents involving API key exposure that damaged trust significantly. [Knowledge-Based]

**Key claim:** QuantPilot adds AI research and strategy to 3Commas' proven bot execution.

**What they actually have:**
- Crypto-only bot execution across major CEX venues [Data]
- Strategy research layer (QuantPilot) for generating and refining trading strategies [Data]
- DCA, grid, and composite bot types [Knowledge-Based]
- Backtesting for crypto strategies [Knowledge-Based]
- No equities integration [Data]
- No onchain execution [Data]
- No plan-first preview [Data]
- No six-mode permission model [Data]

---

## Strengths (be honest)

- **Execution track record:** 3Commas has been running bots for 7+ years. Operators who use them have real trade history. The platform has processed high volumes. [Knowledge-Based]
- **Crypto venue depth:** Well-integrated with Binance, Bybit, OKX, Coinbase, and other major CEX venues. The integrations are battle-tested. [Knowledge-Based]
- **Existing user base:** A large, established crypto trading community already trusts 3Commas for bot execution. QuantPilot has a distribution advantage: it ships to existing users who already have connected accounts. [Knowledge-Based]
- **Bot type variety:** DCA bots, grid bots, combo bots — operators with specific bot preferences have options. [Knowledge-Based]
- **Pricing:** Entry tier is accessible (~$37/mo). Below Gordon's $49 Pro. [Knowledge-Based]
- **Research layer:** QuantPilot represents genuine product investment in the research-to-execution loop. If execution is catching up to Gordon's research depth, the gap narrows. [Estimate]

---

## Weaknesses

- **Crypto-only:** No stock broker integration, no onchain. The operator who has Schwab + Binance cannot unify their portfolio here. [Data]
- **Bot architecture is the wrong mental model:** A bot is a fixed rule set that runs until stopped. Gordon is an agent that reasons about changing conditions. The ICP who has been burned by bots ("I built something, it broke") actively associates 3Commas-style tools with their prior failures. [Data: customer research]
- **Security reputation damage:** Documented API key exposure incidents have eroded trust among informed operators. [Knowledge-Based] This is a persistent perception problem that QuantPilot's rebranding does not erase.
- **Research and execution are loosely coupled:** QuantPilot layered research onto a bot platform. The research output does not have a structured path to execution with risk parameters intact. [Estimate]
- **No plan-first preview:** The operator cannot see a structured diff of what the bot is about to do before it does it. [Data]
- **No permission modes:** Bot is either running or it isn't. There is no "ask me before every order" or "execute within these parameters automatically." [Knowledge-Based]
- **Legacy UX:** Bot configuration UX is complex and not chat-first. QuantPilot adds a chat/research layer but the underlying experience has not been redesigned. [Estimate]
- **No cross-venue context:** No unified portfolio view across crypto venues, and no stocks or onchain. [Data]

---

## How to Win Against Them

**Lead with the bot failure frame.**
"If you've used trading bots before, you know the failure mode: you set it up, it runs, something changes in the market, the bot doesn't adapt, you lose money and don't know why. Gordon isn't a bot. It's an agent that reads the market, proposes a plan, shows you what it's about to do, and executes only when you confirm."

**Lead with the cross-asset frame.**
"3Commas is crypto-only. If you have a Schwab account or a Robinhood account, 3Commas can't see it. Gordon operates across all your venues — crypto exchanges, stock brokers, and onchain wallets — with one unified context."

**Lead with the trust architecture.**
"QuantPilot adds AI research to 3Commas. But when it generates a strategy, how does it execute? Via the same bot infrastructure, with no plan preview, no permission model, no structured confirmation step. Gordon shows you a diff before anything fires."

**Use the security angle carefully (only in appropriate contexts).**
Do not lead with security incidents (it sounds like FUD). Do mention: "When you connect Gordon to your venues, it connects with the minimum permissions needed for each action. We never store API keys in a way that creates a blast radius." [Only use this if the operator raises trust concerns.]

---

## When They Win

- The operator is crypto-only and has no interest in stocks
- The operator has been using 3Commas bots for years and has existing infrastructure (strategies, bots, history) on the platform
- The operator wants a bot architecture (set-and-forget) and explicitly does not want to approve each action
- QuantPilot's research quality genuinely outpaces what Gordon offers for specific crypto strategy generation (assess honestly per demo)
- The operator is on a tight budget and $37 vs $49 is a real constraint
- The operator is comfortable with 3Commas' security model after the incidents and has not been personally affected

---

## Objections and Responses

**"I already use 3Commas — why switch?"**
"What does your 3Commas setup look like right now? If it's working, that's real. The question is whether you're also manually managing accounts that 3Commas can't see — stocks, onchain — and whether you'd want one system that can see all of it. If you're crypto-only and the bots are running well, the urgency is lower. If you've had bots break or you want to start trading stocks too, that's where Gordon is worth looking at."

**"3Commas has been around for years. Gordon is new."**
"3Commas has been around for years and launched QuantPilot two weeks ago. We're in the same cycle of 'AI layer on top of trading.' The difference is what's underneath. 3Commas added AI onto a bot runtime. Gordon was built from the ground up as an agent with a permission model — you're not fighting the architecture, you're working with it."

**"QuantPilot does research AND execution. Isn't that the same thing?"**
"QuantPilot generates strategy and then executes it via bots. Gordon generates strategy, shows you a plan with the exact orders and risk parameters, waits for your confirmation, and then executes across whichever venues you have — including your stock broker. The plan preview is the difference. With 3Commas, you're approving a bot configuration once. With Gordon, you're approving each strategic action before it fires."

**"3Commas is cheaper."**
"By $12/mo at the entry tier. If you're trading live capital across venues, the question isn't the $12 — it's what's the cost of a bad bot execution you didn't see coming. Gordon's plan preview is the insurance policy."

---

## Key Vulnerability

The 3Commas trust deficit from prior security incidents is not neutralized by QuantPilot. Operators who know the history will view any API key connection to 3Commas infrastructure with residual suspicion. Gordon's positioning as "connects to your venues directly, never stores more than needed" is directly contrasted against 3Commas' past API key exposure incidents.

The second vulnerability: QuantPilot's research-to-execution coupling is architecturally loose. If a strategy changes mid-execution, the bot doesn't adapt intelligently. Gordon's agent architecture is designed for exactly this — ongoing reasoning during a live position.

---

## Churn Signals (3Commas → Gordon)

Watch for operators who:
- Post about a bot "going rogue" or executing during a market condition they didn't intend
- Have DCA bots running on 3Commas but manually trade stocks separately
- Express frustration with 3Commas' UX complexity
- Ask "how do I audit what my bots did" — sign that explainability is a pain point
- Mention they've had to "babysit" their bots
- Are 3Commas users who also have Robinhood or Schwab accounts (unmet cross-venue need)
