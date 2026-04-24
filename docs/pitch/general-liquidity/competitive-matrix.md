# Competitive Feature Matrix: Gordon / General Liquidity
*Skill: startup-competitors | Generated: 2026-04-16*

---

## Rating Key

| Rating | Meaning |
|---|---|
| **Strong** | Core capability, well-implemented, differentiated |
| **Adequate** | Capability exists, functional but not differentiated |
| **Weak** | Partial or degraded capability, significant gaps |
| **Missing** | Not present |

Confidence labels: [Data] = verified from public information | [Knowledge-Based] = from training/general knowledge | [Estimate] = inferred

---

## Feature Comparison Matrix

| Feature | Gordon | Public.com | NickAI | 3Commas QuantPilot | Robinhood Cortex | TradingView | DeFi Copilots (aixbt/Velvet) | Robo-Advisors (Betterment/Wealthfront) |
|---|---|---|---|---|---|---|---|---|
| **Multi-venue: Crypto Exchanges** | Strong (9 venues) [Data] | Missing [Data] | Adequate (limited detail) [Knowledge-Based] | Strong (crypto-focused) [Data] | Missing [Data] | Missing (no execution) [Data] | Adequate (DEX + some CEX) [Knowledge-Based] | Missing [Data] |
| **Multi-venue: Stock Brokers** | Strong (9 brokers) [Data] | Adequate (US equities, own custody) [Data] | Weak (equities mentioned) [Knowledge-Based] | Missing [Data] | Weak (Robinhood only) [Data] | Missing [Data] | Missing [Data] | Adequate (own custody) [Data] |
| **Onchain Execution** | Strong (Solana, EVM, Polkadot, Base) [Data] | Missing [Data] | Weak [Knowledge-Based] | Missing [Data] | Missing [Data] | Missing [Data] | Strong (DeFi-native) [Knowledge-Based] | Missing [Data] |
| **Plan-First Preview (structured diff before order)** | Strong [Data] | Missing [Data] | Missing [Data] | Missing [Data] | Missing [Data] | Missing [Data] | Missing [Data] | Missing [Data] |
| **Permission Modes (granular execution control)** | Strong (6 modes: auto/ask/strict/paper/observe/plan) [Data] | Missing (no published permission model) [Data] | Weak (workflow on/off logic only) [Knowledge-Based] | Weak (bot enable/disable) [Knowledge-Based] | Missing [Data] | Missing [Data] | Missing [Data] | Missing [Data] |
| **Chat-First Workflow** | Strong [Data] | Adequate [Knowledge-Based] | Weak (visual workflow builder) [Data] | Weak (research layer bolted on) [Data] | Weak (research summaries only) [Data] | Missing [Data] | Adequate (some copilots are chat-first) [Knowledge-Based] | Missing [Data] |
| **Backtesting** | Strong (Monte Carlo, walk-forward validation) [Data] | Missing [Data] | Missing [Knowledge-Based] | Adequate (strategy backtesting) [Knowledge-Based] | Missing [Data] | Adequate (Pine Script backtesting) [Knowledge-Based] | Missing [Data] | Missing [Data] |
| **Research Depth** | Strong (deep research + scanning + analyst agents) [Data] | Adequate (AI research layer) [Knowledge-Based] | Adequate (market research features) [Knowledge-Based] | Adequate (QuantPilot research layer) [Data] | Adequate (research summaries) [Data] | Strong (charting + data, no LLM synthesis) [Data] | Weak (mostly signals) [Knowledge-Based] | Weak (portfolio-level insights only) [Knowledge-Based] |
| **Paper / Simulation Mode** | Strong (full research + paper trading, free tier) [Data] | Missing (no sandbox at free tier) [Knowledge-Based] | Weak [Knowledge-Based] | Adequate (paper trading available) [Knowledge-Based] | Missing [Data] | Adequate (strategy testing) [Knowledge-Based] | Missing [Knowledge-Based] | Missing [Data] |
| **Audit Logging / Explainability** | Strong (every agent action loggable, plan preview is auditable) [Data] | Missing (no published audit trail) [Knowledge-Based] | Weak (workflow logs only) [Knowledge-Based] | Weak (trade history only) [Knowledge-Based] | Missing [Data] | Missing [Data] | Missing [Data] | Weak (performance reports only) [Knowledge-Based] |
| **Cross-Venue Context (unified portfolio view)** | Strong (persistent operator financial context across all venues) [Data] | Missing (single venue) [Data] | Weak [Knowledge-Based] | Weak (crypto-only portfolio) [Knowledge-Based] | Missing (Robinhood only) [Data] | Adequate (broker connect, manual) [Knowledge-Based] | Missing [Data] | Adequate (aggregated view) [Knowledge-Based] |
| **Execution Delegation (live orders via agent)** | Strong [Data] | Adequate (agentic brokerage model) [Data] | Adequate (workflow execution) [Data] | Adequate (bot execution) [Data] | Missing (research only) [Data] | Missing [Data] | Adequate (smart order routing for DeFi) [Knowledge-Based] | Adequate (auto-rebalance) [Data] |
| **Human-Above-the-Loop Architecture** | Strong (plan preview + permission modes enforce human authority) [Data] | Missing [Knowledge-Based] | Missing [Knowledge-Based] | Missing [Knowledge-Based] | N/A (no delegation) | N/A | Missing [Knowledge-Based] | Missing (fully autonomous) [Data] |
| **Operator Financial Context (data flywheel)** | Strong (persistent context per operator) [Data] | Missing [Knowledge-Based] | Missing [Knowledge-Based] | Weak (account history) [Knowledge-Based] | Weak (Robinhood history) [Knowledge-Based] | Missing [Data] | Missing [Knowledge-Based] | Adequate (financial profile) [Knowledge-Based] |

---

## Capability Cluster Summary

### Gordon's Exclusive Territory (no competitor has all of these)
- Plan-first preview
- Six-mode permission model
- Onchain + CEX + stocks in one unified context
- Human-above-the-loop architecture enforced at every venue call

### Contested Territory (multiple players have some version)
- Chat-first workflow (Public.com, some DeFi copilots)
- Research depth (Robinhood Cortex, TradingView, 3Commas QuantPilot)
- Backtesting (TradingView/Pine Script, 3Commas)
- Execution delegation (Public.com, NickAI, 3Commas bots)

### Where Competitors Are Stronger (honest assessment)
- **TradingView**: Charting and price visualization is deeper. Gordon does not compete on candlestick UX. [Data]
- **Robinhood Cortex**: Research summaries for retail equities, surface-level natural language — simpler UX for lower-intent users. [Data]
- **3Commas**: More battle-tested for crypto bot execution. Legacy users have years of history on the platform. [Knowledge-Based]
- **Public.com**: Better brand trust and distribution for US equities retail. More known entity. [Data]
- **Robo-advisors**: Better for fully passive, no-thesis investors. Gordon is wrong product for this segment. [Data]

---

## Notes on Confidence

Several NickAI feature assessments are [Knowledge-Based] or [Estimate] because detailed feature documentation was not publicly available at knowledge cutoff. NickAI launched March 12, 2026 — full feature set should be reassessed with live product access. Same applies to Public.com's permission model granularity.
