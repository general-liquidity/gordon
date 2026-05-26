---
name: filing-analysis
description: Analyze SEC filings + earnings calls + transcripts for a ticker. When user says "what did they file?", "analyze AAPL's 10-K", "what's in the earnings transcript", "any guidance change", or wants structured signal extraction from filings rather than reading the prose end-to-end
arguments: [ticker]
argument-hint: Stock ticker (e.g., AAPL, NVDA, TSLA)
tags: [fundamentals, earnings, sec, filings]
user-invocable: true
status: active
last-reviewed: 2026-05-26
---

Analyze recent filings + earnings material for {ticker}. The goal is structured extraction — sentiment, guidance revision, key risk factors, management confidence — not prose summary. Use before earnings plays, after material 8-K filings, or when researching a new name.

## Step 1: Profile + recent context
- `get_fundamentals({ ticker: '{ticker}', metric: 'profile' })` — sector, market cap, recent IPO?
- `get_news({ source: 'edgar', symbol: '{ticker}', sinceMinutes: 10080 })` — recent EDGAR filings (7 days)
- `get_news({ source: 'stocks', symbol: '{ticker}', sinceMinutes: 1440 })` — Yahoo + Finnhub (24h)

Flag any 8-K filings — these are material-event filings (guidance change, exec departure, M&A, lawsuit). 10-Q/10-K are scheduled; 8-K is "something happened."

## Step 2: Earnings surprise history
- `get_fundamentals({ ticker: '{ticker}', metric: 'earnings' })` — historical EPS surprises
- `get_fundamentals({ ticker: '{ticker}', metric: 'estimates' })` — current analyst estimates

Surprise pattern: chronic beats build cushion (earnings plays favor the long side); chronic misses → asymmetric downside risk. Last 4 quarters is enough.

## Step 3: Analyst delta
- `get_fundamentals({ ticker: '{ticker}', metric: 'analysts' })` — recent upgrades/downgrades + price target shifts

If the consensus has shifted noticeably (5%+ price-target move, downgrade waterfall, etc.) since the last filing, the market is already repricing the fundamentals before the next earnings. Either you missed it or there's still room.

## Step 4: Validate any quoted earnings signal
If you have a structured earnings-signal candidate (e.g. from a transcript), validate it before persisting:
`compute_microstructure({ operation: 'earnings_signal', params: { candidate: { ticker, sentimentScore, managementConfidence, guidanceRevision, keyRiskFactors, tradingBias }, transcript } })`

The validator flags hallucinated quotes, internal contradictions, and miscalibrated bias. Don't write signals into memory that fail validation.

## Step 5: Cross-check with insider + institutional flow
- `get_fundamentals({ ticker: '{ticker}', metric: 'insider' })` — insider sentiment + recent trades
- If available via MCP / cold-tier: institutional ownership change, congressional trades, lobbying spend

Insiders selling into a guidance raise is a red flag; insiders buying into a guidance cut is a strong contrarian signal.

## Step 6: Synthesize into a trade thesis (if applicable)
A filing analysis produces one of:
- **Bullish thesis**: surprise pattern + analyst delta + insider buying + management confidence raised + sector tailwind
- **Bearish thesis**: chronic misses + downgrade waterfall + insider selling + guidance lowered
- **No edge**: mixed signals, no asymmetric conviction. Most cases land here — be willing to say so.

## Step 7: Memory + audit
- `memory_write({ kind: 'observation', content: 'Filing analysis on {ticker}: <summary>', symbol: '{ticker}', tags: ['earnings', 'fundamentals'] })`
- `audit_event({ action: 'OBSERVATION', summary: 'filing-analysis {ticker}: <bullish/bearish/no-edge>', parameters: <key findings> })`

If a thesis emerges, hand off to `create_plan` with the rationale citing the filing-derived signals. Filings provide context; the trade still needs entry / stop / size discipline.

Earnings plays specifically: never enter the day-of without an explicit pre-event plan + pre-event size cap. Surprises are surprises.
