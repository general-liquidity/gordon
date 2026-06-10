---
name: holder-concentration
description: Token holder-concentration / exit-liquidity risk — top-N concentration, HHI, effective holders, insider control. When user says "who holds TOKEN", "whale concentration", "holder distribution", "am I exit liquidity", "is supply concentrated", or wants a holder-distribution read before buying a token.
arguments: [token]
argument-hint: Token contract address + chain (e.g. ethereum, base, solana)
tags: [crypto, onchain, concentration, risk]
user-invocable: true
status: active
last-reviewed: 2026-06-10
---

Assess who actually owns {token}'s supply. If a handful of wallets hold most of it — especially team/VC wallets — you're the exit liquidity by design.

**Scope:** Any chain supported by a configured wallet-intelligence provider (Covalent/GoldRush, Moralis, Nansen, Arkham, …). Gordon no longer ships chain-specific execution kits (AgentKit, Basescan, CDP SQL). If no provider is configured, stop and say so — do not fabricate a distribution.

## Step 1: Fetch the top holders

Use the wallet-intelligence adapter (Covalent `token_holders_v2` when `GOLDRUSH_API_KEY` / `COVALENT_API_KEY` is set, or the highest-priority provider that exposes `getTokenHolders`). Pass `{ chain, tokenAddress: '{token}', limit: 20 }`.

If no provider is available, stop and tell the operator which API keys unlock holder data (`GOLDRUSH_API_KEY`, `MORALIS_API_KEY`, `NANSEN_API_KEY`, …).

## Step 2: Score concentration

`compute_microstructure({ operation: 'holder_concentration', params: { holders: [{ address, balance, label? }], totalSupply, topN: 10 } })`

Map each holder's balance + the token's total/circulating supply. (If the source gives share % rather than absolute balance, pass `balance` = share and `totalSupply` = 100 — the math is scale-invariant.)

Returns top-1 %, top-N %, HHI + effective number of holders, insider-controlled %, exchange %, and a verdict (high / moderate / low).

## Step 3: The labels caveat (important)

Raw holder APIs give **addresses + balances, not entity labels.** The insider-controlled flag (team + investor + foundation) is only meaningful if you supply `label` on the holders — fetch labels from Nansen or Arkham when those keys are configured. Without labels:
- The **concentration** read (top-N, HHI, effective holders) is reliable from raw balances.
- The **insider %** field is a lower bound — treat unlabeled whales as unknown, not benign.