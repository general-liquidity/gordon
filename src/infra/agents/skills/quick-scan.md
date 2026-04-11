# Quick Scan

Run a rapid multi-symbol market scan to surface the best opportunities across a configurable universe in under 30 seconds. Used when the user wants a fresh read on the market without specifying individual symbols.

## When to use

- User opens a session and asks "what looks good right now?"
- Morning brief time — need a fast sweep before deeper analysis
- User has no specific thesis and wants discovery
- Scanner should run before committing to a deeper `/dd` on any one symbol

## The flow

1. Pick a universe — default is top 20 by volume on the user's active venue. User can override with a specific watchlist or "crypto majors" / "stocks SPX 100" / etc.
2. For each symbol, run a lightweight multi-indicator pass (RSI, trend, volume, recent range break)
3. Score each on a 0-100 composite and rank
4. Return the top 5-10 with a one-line thesis each
5. Suggest `/dd <symbol>` for the top 1-2 if the user wants to go deeper

## Tools used

- `scan_market` — the main multi-symbol scanner
- `get_trending_tokens` — parallel check for momentum
- `score_market` — ranking composite

## What good output looks like

Brief ranked list, each entry: `symbol | thesis | score | confidence`. No full technical reports — the point is discovery, not analysis. If nothing scores above 60, say so honestly rather than forcing a recommendation.

## Common failure modes

- Returning everything instead of just the top candidates
- Scanning too broad a universe (makes the scan slow and the output noisy)
- Suggesting trades in the scan output — this is discovery, not `/swing-entry`
