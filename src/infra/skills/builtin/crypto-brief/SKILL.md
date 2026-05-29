---
name: crypto-brief
description: "Comprehensive confidence-tiered crypto morning brief. When user says /crypto-brief, 'crypto morning brief', 'what's happening in crypto today', 'overnight crypto recap', or wants the full crypto intelligence rundown (macro, on-chain, DeFi, funding/OI, narratives, regulatory, watchlist) — assemble a structured, signal-tiered brief from Gordon's existing data sources, calibrated to the operator's profile. Distinct from /morning-brief (generic, asset-agnostic). Pure composition — no new code, no scraping."
arguments: [focus?]
argument-hint: Optional sector/token focus (e.g. 'DeFi', 'SOL ecosystem'). Default: the operator's sector hierarchy from working memory.
tags: [daily, crypto, routine, intelligence, brief]
user-invocable: true
status: active
last-reviewed: 2026-05-29
---

Assemble the **crypto intelligence brief** — the structured, signal-tiered morning rundown a crypto-primary operator actually needs, vs the generic [[morning-brief]]. The premise (from "I Stopped Spending 4 Hours a Day on Crypto Research"): the crypto info ecosystem is engineered to trigger emotional reactions, not deliver actionable data. The brief replaces doomscrolling with one calibrated, skeptical synthesis.

Pure-composition skill. It composes Gordon's *existing* data — news + sentiment, on-chain integrations, funding/OI, regime, crowd-positioning, regulatory feeds, portfolio/watchlist. **No social scraping** (deliberately out of scope) and it **writes no new store** — the brief is synthesis, not a parallel observation log; persist anything worth keeping via the journal.

## Step 0: Calibrate to the operator

Read working memory first — risk tolerance, venue/account type, market focus, and (if recorded) the operator's sector hierarchy and watchlist. Every filtering decision below is governed by it. A conservative long-term holder gets a different brief than an aggressive DeFi farmer. If the profile is thin, ask once which sectors/tokens matter, then proceed.

## Confidence tiering (applies to every item)

Tag each item so the operator can triage at a glance:
- **[HIGH SIGNAL]** — confirmed, multi-source, actionable.
- **[MODERATE SIGNAL]** — credible, single strong source or partial confirmation.
- **[EARLY SIGNAL]** — plausible but unconfirmed; worth watching, not acting.
- **[NOISE — MONITORING]** — flagged for awareness, likely manufactured or low-quality.
- Prefix time-sensitive items with ⏰ and state the expiry ("matters before the US open / before the 8h funding reset").

If a section has no genuine signal today, say "quiet" and move on — never pad a section with low-quality filler. Some mornings three things happened; some mornings nothing did.

## Section 1: Macro & market pulse
BTC dominance, total market cap move, BTC/ETH price + volume context, Fear & Greed. Any macro event that moves risk assets today (Fed, CPI, yields, DXY). Equity correlation only if it matters today. Source: `get_market_data` + `get_news` (macro filter).

## Section 2: Top movers by sector
Outperformers/underperformers vs the market, broken out by the operator's sectors (L1/L2/DeFi/AI/RWA/infra/memecoin/etc.). Flag unusual volume spikes that may precede catalysts. Use `get_market_data` for movers; `compute_regime` for the prevailing tape.

## Section 3: On-chain signals
Whale moves, exchange net flows (inflow = sell pressure, outflow = accumulation), stablecoin mint/burn, DEX volume spikes, protocol TVL moves. Source: Gordon's Defillama / Base / CDP / Solana / Chainlink integrations. Lead with flows that contradict the price tape (the most informative case).

## Section 4: DeFi monitor
TVL changes on watchlist protocols, notable yield shifts above the operator's threshold, new incentive programs, and **risk events** — depeg alerts, liquidation cascades, exploit reports. Source: Defillama protocol/fees + news exploit filter.

## Section 5: Funding, OI & derivatives
Funding rate + open-interest context on majors and watchlist perps; recent liquidation clusters. Source: funding producer + `compute_microstructure` (crowd_positioning). This is the short-term-move section — flag funding/OI extremes with ⏰.

## Section 6: Narrative & signal quality (organic vs manufactured)
What themes are getting coordinated attention. **Crucially, run the organic-vs-manufactured check using on-chain/flow confirmation, NOT social scraping** (which Gordon deliberately doesn't do): a narrative is [HIGH SIGNAL] only when attention is *backed by* organic flow/TVL/volume; when price/attention runs without on-chain or flow confirmation, tag it [NOISE — MONITORING] and say so. Use `compute_microstructure` (crowd_positioning, manufactured_imbalance) + funding/OI divergence as the manufactured-attention tell. This is the discipline the article calls for, done with Gordon's signals rather than CT scraping.

## Section 7: Regulatory & institutional
Regulatory headlines that actually matter (US/EU/Asia), ETF flow context, notable filings. Source: EDGAR feed + news regulatory filter. Headlines only — skip the noise.

## Section 8: Portfolio & watchlist context
How the operator's held positions and watchlist tokens performed overnight; any news directly relevant to positions; risk flags. This section is always prioritized — it's the only one calibrated to what the operator actually holds. Cross-reference [[exit-review]] if a position is approaching a risk flag.

## Action items
Concrete, specific, time-bounded. Not "watch BTC" — "⏰ SOL funding flipped negative + OI rising into the 12:00 UTC reset; if you're considering the long, the entry window is pre-reset." Decisions worth making today, investigations worth running, opportunities with a clear expiry. Every action item carries a confidence tier.

## Output discipline
- Keep it tight — a 5-minute read, not a data dump (per the operator's "natural prompts → actionable output" preference).
- Every item: 1–2 sentence synthesis + the source. No fluff, no "in conclusion."
- **Never include price predictions.** Synthesize what the data says together; don't forecast.
- Synthesize, don't summarize — surface what price + news + on-chain + funding say *together* that no single source says alone.

## Audit
```
audit_event({
  action: 'OBSERVATION',
  summary: 'crypto-brief: <N> high-signal items, <M> time-sensitive, top theme <X>',
  parameters: { high_signal_count, time_sensitive_count, sections_with_signal, top_action_item }
})
```

## Honest caveats

- **No social scraping.** The article's X/Telegram/Discord branch is deliberately out of scope (the `mastra-browser-deferred` amplification surface). Gordon's manufactured-attention check uses on-chain/flow confirmation instead — weaker on pure-social pumps, but it never ingests an unvetted scrape surface.
- **Synthesis, not a store.** The brief writes nothing persistent on its own. Anything worth keeping goes through the journal — do not create a parallel brief-history store.
- **The brief doesn't trade.** It replaces doomscrolling with clarity; it does not make decisions. Selection, sizing, and execution stay behind the normal plan/approval flow and the operator's call.
- **Quiet is a valid output.** If nothing has signal, say so. The value is filtering, not volume — a brief that manufactures urgency to fill sections is the exact failure mode the article is escaping.
- Distinct from [[morning-brief]] (generic/asset-agnostic). Composes with [[exit-review]] (position risk), [[ai-output-check]] (verify any AI-surfaced claim before acting), and the crowd-positioning / manufactured-imbalance signals.
