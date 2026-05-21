---
name: learn-finnhub
description: Gordon's Finnhub integration — tools covering stocks, ETFs, mutual funds, indices, bonds, crypto, forex, and macro data. When user asks "what stock data do you have?", "fundamentals on X?", "earnings calendar?", "analyst ratings on X", or about Finnhub integration
tags: [learning, finnhub, stocks, fundamentals, macro]
user-invocable: true
---

Gordon has many Finnhub-backed tools — the most comprehensive stock/macro coverage of any CEX-first trading CLI. All tools degrade gracefully when FINNHUB_API_KEY isn't set (returns `configured: false` with a BYOK diagnostic).

## Setup

```bash
# Get a free key: https://finnhub.io/register
echo "FINNHUB_API_KEY=your_key_here" >> ~/.gordon/.env
```

Free tier: **60 requests/minute**, covers quotes, candles, company news, basic fundamentals.
Premium tiers needed for: earnings estimates, congressional trades, insider sentiment, lobbying, patents, supply chain, transcripts.

## Tool Categories

### Events & Calendar
- **get_upcoming_earnings**: earnings calendar for next N days
- **get_earnings_estimates** / **get_revenue_estimates**: analyst EPS and revenue consensus
- **get_earnings_surprises**: historical actual vs estimate + beat rate
- **get_economic_calendar**: macro releases (CPI, NFP, FOMC, GDP)
- **get_ipo_calendar**: upcoming + recent IPOs
- **get_insider_transactions** / **get_insider_sentiment**: Form 4 filings + monthly sentiment
- **get_congressional_trading**: STOCK Act disclosures

### Fundamentals
- **get_company_profile**: name, industry, market cap, shares outstanding, IPO date
- **get_basic_financials**: P/E, P/B, P/S, margins, ROE, ROA, growth rates, beta
- **get_financials_reported**: raw 10-K/10-Q line items
- **get_peer_companies**: comparable tickers (industry/sector/subIndustry)
- **get_dividends** / **get_stock_splits**: payout and split history
- **get_esg_score**: environment, social, governance scores

### Analyst & Sentiment
- **get_analyst_ratings**: recommendation trend counts by period
- **get_price_target**: target mean/median/high/low
- **get_upgrade_downgrade**: analyst rating changes
- **get_social_sentiment**: Reddit + Twitter mention counts
- **get_news_sentiment**: aggregate buzz + bullish/bearish percent
- **get_company_news** / **get_market_news**: headlines, summaries, URLs

### Ownership
- **get_fund_ownership**: mutual fund + ETF holders
- **get_institutional_ownership**: 13F institutional positions

### Filings & Alt Data
- **get_sec_filings**: 10-K / 10-Q / 8-K list
- **list_earnings_transcripts** / **get_earnings_transcript**: full call transcripts
- **get_lobbying**: federal lobbying disclosures
- **get_usa_spending**: US government contract awards
- **get_uspto_patents**: patent filings
- **get_visa_applications**: H-1B / L-1 sponsorships
- **get_supply_chain**: supplier + customer correlations

### Market Data & Scanner
- **get_stock_quote**: real-time quote (price, change, day range)
- **get_stock_candles**: OHLCV history at any resolution
- **get_stock_symbols** / **symbol_lookup**: build universes, find tickers by name
- **get_market_status**: exchange open/closed/session
- **get_pattern_recognition**: chart patterns (triangles, flags, H&S, etc.)
- **get_support_resistance**: key price levels
- **get_aggregate_signal**: buy/sell/neutral technical consensus

### Funds & Indices
- **get_etf_holdings** / **get_etf_profile**: ETF constituents + metadata
- **get_etf_country_exposure** / **get_etf_sector_exposure**
- **get_mutual_fund_profile** / **get_mutual_fund_holdings**
- **get_mutual_fund_country_exposure** / **get_mutual_fund_sector_exposure**
- **get_index_constituents**: S&P 500, Nasdaq-100, Dow, Russell 2000 members

### Bonds & Rates
- **get_bond_yield_curve**: yield series by tenor (3m, 2y, 10y, 30y)
- **get_bond_profile**: bond metadata by ISIN

### Crypto (additive to native Binance/Hyperliquid)
- **get_finnhub_crypto_exchanges** / **get_finnhub_crypto_symbols**
- **get_finnhub_crypto_candles**: historical OHLCV for cross-exchange sanity checks
- **get_finnhub_crypto_profile**: asset metadata

### Forex & Economic
- **get_forex_rates**: live rates with configurable base currency
- **list_economic_codes** / **get_economic_data**: macro indicator series

## Radar Categories Fueled by Finnhub

When radar mode is on, these categories surface unsolicited suggestions:
- **earnings_approaching**: upcoming earnings for watchlist symbols
- **insider_flow_alert**: clustered insider buying
- **analyst_upgrade**: rating changes (upgrade/downgrade/init)
- **congressional_trade**: new STOCK Act filings

## Common Workflows

### Pre-earnings check
```
1. get_upcoming_earnings (days=7)
2. For each: get_earnings_estimates + get_earnings_surprises
3. Build a beat-rate ranking
```

### Fundamental screen
```
1. get_company_profile + get_basic_financials
2. Compare to get_peer_companies
3. Check get_institutional_ownership for smart-money positioning
```

### Macro regime check
```
1. get_economic_calendar (upcoming)
2. get_bond_yield_curve (curve shape)
3. get_forex_rates (dollar strength)
```

### ETF rotation
```
1. list get_etf_sector_exposure for SPY, QQQ, XLK, XLF, XLE
2. Compare current allocations
3. Spot over/under-weights
```

## Rate Limiting

Gordon enforces Finnhub's 60/min limit automatically via the per-endpoint rate limiter. If you hit the cap, tool calls return a 429 with the wait time. Premium endpoints (earnings estimates, insider sentiment, congressional, lobbying, etc.) return 403 on free-tier keys — not a bug, just a tier gap.
