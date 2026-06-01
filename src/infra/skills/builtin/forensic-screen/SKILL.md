---
name: forensic-screen
description: Forensic accounting screen on an equity — Beneish M (manipulation), Altman Z (distress), Piotroski F (strength), Sloan accruals (earnings quality). When user says "is this company cooking the books", "forensic check on TICKER", "bankruptcy risk", "earnings quality", "Beneish/Altman/Piotroski", or wants a fraud/distress read before trusting reported earnings.
arguments: [ticker]
argument-hint: Stock ticker (e.g., AAPL, SMCI, NVDA)
tags: [fundamentals, forensic, equities, sec, risk]
user-invocable: true
status: active
last-reviewed: 2026-05-30
---

Run the four classic forensic screens on {ticker}. The screen is a probability flag, not proof — a bad score means OPEN THE FILING, never short on the number alone.

## Step 1: Pull two years of reported financials
`get_financials_reported({ symbol: '{ticker}', freq: 'annual' })` — raw income statement / balance sheet / cash-flow line items straight from the filings, most-recent-first. You need the latest two annual reports (Beneish + Piotroski are year-over-year; Altman + Sloan need only the current year).

If Finnhub is unconfigured or returns nothing, fall back to `get_fundamentals` or Alpha Vantage for the same line items.

## Step 2: Map the line items
Finnhub's reported financials use inconsistent XBRL concept tags across filers — the same idea is tagged differently company to company. Map carefully into the forensic input for BOTH years:

- `sales` (Revenues / RevenueFromContractWithCustomer / SalesRevenueNet)
- `cogs` (CostOfGoodsAndServicesSold / CostOfRevenue)
- `sga` (SellingGeneralAndAdministrativeExpense)
- `netIncome` (NetIncomeLoss), `cfo` (NetCashProvidedByUsedInOperatingActivities)
- `receivables` (AccountsReceivableNetCurrent)
- `currentAssets` (AssetsCurrent), `currentLiabilities` (LiabilitiesCurrent)
- `ppeNet` (PropertyPlantAndEquipmentNet), `depreciation` (DepreciationDepletionAndAmortization)
- `totalAssets` (Assets), `totalLiabilities` (Liabilities), `longTermDebt` (LongTermDebtNoncurrent)
- `retainedEarnings` (RetainedEarningsAccumulatedDeficit), `ebit` (OperatingIncomeLoss)
- `marketCap` (price × shares — from `get_fundamentals` profile), `sharesOutstanding` (CommonStockSharesOutstanding)

A missing tag is fine — the screen returns a null score for anything it can't compute (no false flags). Don't invent numbers to fill a gap.

## Step 3: Run the screen
`compute_microstructure({ operation: 'forensic_screen', params: { current: {...thisYear}, prior: {...lastYear} } })`

Returns Beneish M (> -2.22 = manipulation risk), Altman Z (< 1.81 distress / > 2.99 safe), Piotroski F (0-9, ≥6 strong), Sloan accruals (|x| > 25% red flag), and a verdict (INVESTIGATE / CLEAN / INSUFFICIENT).

## Step 4: Act on the verdict
- **INVESTIGATE** → open the actual filing. Cross-check with `filing-analysis` (guidance, insider flow) before forming a thesis. The score tells you WHERE to look, not WHAT to conclude.
- **CLEAN** → fundamentals don't raise a forensic flag; that's not a buy signal, just the absence of a red one.
- **INSUFFICIENT** → too few line items mapped; get more data before relying on it.

## Notes
- Beneish runs on LAST year's data, so a manipulation may already be unwinding by the time it flags; it misses some real frauds and false-flags some clean firms. Treat it as one input, not a verdict.
- `memory_write` the finding and `audit_event` it if it informs a plan.
