---
name: holder-concentration
description: Token holder-concentration / exit-liquidity risk on a Base/EVM token — top-N concentration, HHI, effective holders, insider control. When user says "who holds TOKEN", "whale concentration", "holder distribution", "am I exit liquidity", "is supply concentrated", or wants a holder-distribution read before buying a token.
arguments: [token]
argument-hint: Token contract address (Base/EVM)
tags: [crypto, onchain, concentration, risk]
user-invocable: true
status: active
last-reviewed: 2026-05-30
---

Assess who actually owns {token}'s supply. If a handful of wallets hold most of it — especially team/VC wallets — you're the exit liquidity by design.

**Scope:** Base / EVM tokens only (the wired holder sources are Basescan + CDP). No Solana/other-chain holder source is wired yet — say so rather than guessing.

## Step 1: Fetch the top holders
`get_base_token_holders({ contractAddress: '{token}', limit: 20 })` — top holders with balances + per-holder share (needs BASESCAN_API_KEY). Or `get_base_top_holders` (CDP SQL) as an alternative source.

If neither is configured, stop and tell the operator the holder data source isn't available — do not fabricate a distribution.

## Step 2: Score concentration
`compute_microstructure({ operation: 'holder_concentration', params: { holders: [{ address, balance, label? }], totalSupply, topN: 10 } })`

Map each holder's balance + the token's total/circulating supply. (If the source gives share % rather than absolute balance, pass `balance` = share and `totalSupply` = 100 — the math is scale-invariant.)

Returns top-1 %, top-N %, HHI + effective number of holders, insider-controlled %, exchange %, and a verdict (high / moderate / low). This adds rigor (HHI, effective holders) over the crude top-10 share that `get_base_token_holders` reports on its own.

## Step 3: The labels caveat (important)
Basescan/CDP give **addresses + balances, not entity labels.** The insider-controlled flag (team + investor + foundation) is only meaningful if you supply `label` on the holders — and that labeling needs Arkham/Nansen, which is NOT wired. So:
- The **concentration** read (top-N, HHI, effective holders) is reliable from raw balances.
- The **insider/exit-liquidity** flag is only as good as the labels you can attach. If you have no labels (the default), report the concentration honestly and flag that insider attribution is unavailable — don't imply a clean insider read when you simply couldn't label the wallets.

## Step 4: Interpret
- High concentration + labeled insiders dominating → genuine exit-liquidity risk; size down or pass.
- High concentration, unlabeled → "concentrated, but I can't tell if it's insiders, an exchange, or a contract." That uncertainty is itself the finding.
- Dispersed (high effective-holder count) → lower concentration risk on this axis (not a green light overall).

Cross-reference an exchange-labeled wallet (sell-side liquid, not insider) differently from a team/VC wallet. `memory_write` + `audit_event` if it informs a decision.
