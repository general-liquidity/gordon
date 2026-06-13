---
name: mean-reversion-fade
strategy: mean-reversion
status: verified
regime: [ranging, chop]
instruments: [BTC/USDT, ETH/USDT]
---

## Hypothesis

In a ranging/choppy regime with fading volume, a failed breakout traps the
momentum buyers who chased it. Their forced exit (stops + margin) pushes price
back through the range, so fading the failed breakout toward the mean has
positive expected value. The edge is the trapped crowd's exit, not a prediction
of direction — it exists only while the regime is range-bound and volume is NOT
expanding (expansion means the breakout is real and the crowd is right).

## Invariants

| id | metric | comparator | threshold | description |
|---|---|---|---|---|
| ev-net-positive | netEdgeBps | > | 0 | Edge survives the round-trip cost (fees + slippage) |
| regime-ranging | regime | in | ranging,chop | Only valid in a range-bound regime |
| volume-fading | volumePattern | in | flat,decreasing | Trapped-crowd thesis needs non-expanding volume |
| liquidity-floor | avgVol1mUsd | >= | 100000 | Enough depth to exit the fade without self-impact |

## Kill Conditions

| id | metric | comparator | threshold | description |
|---|---|---|---|---|
| ev-decayed | netEdgeBps | <= | 0 | Net edge has decayed to/through zero after costs |
| regime-flip | regime | not-in | ranging,chop | Regime left the range — breakouts now run |
| volume-expanding | volumePattern | == | increasing | Expanding volume = real breakout, crowd is right |
| winrate-broke | winRate | < | 0.45 | Realized win rate fell below the fade's break-even |

## Verification

Gauntlet: bar-permutation (mcpt) p < 0.05 on 18mo BTC/USDT + ETH/USDT 15m;
walk-forward 6 folds, PBO < 0.5; deflated Sharpe > 0 after the multiple-testing
haircut; net of a 2bps round-trip cost assumption (ic-tracker). Incubated in
paper/shadow for 30 sessions before promotion to `status: live`.
