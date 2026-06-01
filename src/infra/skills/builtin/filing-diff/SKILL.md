---
name: filing-diff
description: Year-over-year SEC filing diff — surface only the NEW and REMOVED language in a company's 10-K Risk Factors or MD&A versus the prior year. When user says "what changed in TICKER's 10-K", "diff the risk factors", "any new risks this year", "compare this year's filing to last year", or wants the forensic year-over-year read on a filing.
arguments: [ticker]
argument-hint: US stock ticker (e.g. AAPL, NVDA, SMCI)
tags: [fundamentals, sec, equities, forensic]
user-invocable: true
status: active
last-reviewed: 2026-06-01
---

The forensic "single best read": what did a company quietly ADD or REMOVE in its filing this year? A newly-added customer-concentration paragraph or a deleted key-supplier line is information that never hits a press release. This skill surfaces only the changed language and ignores the boilerplate carried over from last year.

**Scope:** US SEC registrants only (the data source is EDGAR). No equivalent feed for foreign-private-issuer 20-Fs or non-US listings — say so rather than guessing.

## Step 1: Get the year-over-year diff
`get_filing_text({ ticker: '{ticker}', form: '10-K', section: 'risk_factors', compareToPriorYear: true })`

This fetches the latest 10-K AND the prior-year 10-K from EDGAR, extracts the Risk Factors section from both, and diffs them **server-side** — so you get back only the small `added[]` / `removed[]` segment lists plus counts and a summary, not 60KB of filing text. Use `section: 'mdna'` for the Management's Discussion instead.

The result carries both filings' `accessionNumber` + `filingDate` so you can cite exactly which two filings were compared.

## Step 2: Read the delta, not the boilerplate
- **added[]** — language present this year but not last year. New risk disclosures are where management is quietly flagging something. A new paragraph on customer concentration, supplier dependence, litigation, going-concern, or regulatory exposure is the signal.
- **removed[]** — language dropped from last year. A deleted risk can mean it resolved — or that management stopped disclosing it. Both are worth a look.
- `unchangedCount` — carried-over boilerplate; ignore it.

## Step 3: Read the full section if a change needs context
If an added/removed segment is ambiguous, pull the full section to read around it:
`get_filing_text({ ticker: '{ticker}', section: 'risk_factors' })` (text mode — returns the section body, capped).

## Step 4: Act on it
- A material new risk → cross-reference with `forensic-screen` (is the accounting also flagging?) and `filing-analysis` (guidance / insider flow) before forming a thesis.
- The diff tells you WHERE management's disclosure changed — it does not tell you the trade. `memory_write` the finding and `audit_event` it if it informs a plan.

## Notes
- Diff mode restricts to a named section (`risk_factors` or `mdna`) — a full-document diff is too noisy to be useful.
- Section extraction is heuristic (Item-marker delimited). If a filer uses a non-standard layout and the section comes back empty, fall back to `section: 'full'` text mode and read directly.
- The diff is a similarity comparison: lightly-reworded boilerplate is treated as unchanged; genuinely new/removed sentences surface. It flags candidates to read, not conclusions.
