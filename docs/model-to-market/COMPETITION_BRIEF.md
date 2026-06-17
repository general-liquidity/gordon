# Model to Market: The Quantitative Hack — Competition Brief

**The single reference for the competition.** Last updated **2026-06-17**.

> **Source-of-truth hierarchy** (organizer-stated): the **Syphonix platform "Rules" tab** (left nav of the participant console) is authoritative — the rules were updated after the 15 Jun kickoff and supersede the marketing pages. Discord (`Duncan` = tech lead, `Lotus` = ops) is the live clarification channel. The public marketing pages (`aienginehack.com/momq`, Luma) are stale where they conflict.
>
> Provenance tags below: **[RULES]** = official rules doc · **[DISCORD]** = organizer Discord answer · **[SITE]** = marketing page · **[CONFIRM]** = still to verify on the platform.

---

## 1. At a glance

| | |
|---|---|
| **What** | UK's first live AI-native trading competition. Solo (1-person teams). **400+ registered** (Duncan, Discord). Round progression is a **fixed number** advancing (not a percentage) — exact counts TBC by the organizer. |
| **Host** | AI Engine (Zoe Qin / Jamesin Seidel, Dawn Capital) × Syphonix |
| **Capital** | $1,000,000 virtual per participant, **30:1 max leverage**, zero principal risk |
| **Markets** | Final competition-tradeable set: FX(8) · Gold (XAUUSD) · Silver (XAGUSD) · 5 crypto. **No** stocks/indices/bonds/oil. **No** options. |
| **Format** | 1 week build → 1 week live paper trade → knockout rounds → top-100 final |
| **Live launch** | **21 Jun 2026, 22:00 BST** (Asia open) |
| **Final** | 27 Jun 2026, London, in-person **required** for the top 100 |
| **Prize pool** | $100k cash + partner bounties (NVIDIA hardware, Anthropic credits) |
| **Execution** | Order-book matching sim on real market data. **MT5 is the only programmatic API** (no Syphonix REST API). |
| **Governing law** | England. Paper-only; no real-money, not investment advice. |

---

## 2. Schedule (BST)

Authoritative dates from **[RULES]** §5, refined by **[DISCORD]**. Marketing pages disagree on times — trust the platform.

| Date / time (BST) | Phase | Detail |
|---|---|---|
| **15 Jun, 17:00–20:00** | Opening | Portal + **historical data** + tech-perk credits open; trading **disabled**; view account credentials, familiarize. |
| **18 Jun, 22:00** | 2nd registration deadline | — |
| **18 Jun** | **Test environment** | MT5 credentials + API + test env open; validate all pairs and execution. |
| **21 Jun, 22:00** | **OFFICIAL LAUNCH** | Live competition begins; accounts initialize at $1M. |
| **22 Jun, 22:00** | Round 1 close | Snapshot + 22:00–23:00 compliance audit; eliminations. |
| **23 Jun, 22:00** | Round 2 close | Snapshot + audit; eliminations. |
| **24 Jun, 22:00** | Round 3 close → **Top 100 cut** | Leaderboard goes **blind**; top 100 by score advance. |
| **24 Jun 22:00 – 26 Jun 22:00** | **Finals (blind)** | Top 100 compete; no live ranking shown. |
| **26 Jun, 22:00** | Trading closes | All positions liquidated; final PnL + Sharpe computed; 22:00–23:00 audit. |
| **27 Jun** | Final day, London | Panels, technical judging, networking, awards. In-person required. |

**Notes**
- **Equity carries over between rounds — it is NOT reset.** Confirmed twice **[DISCORD]**. Return is always measured off the fixed $1,000,000 baseline.
- Some schedule details were still "tentative" as of kickoff (venue/logistics). Re-check the platform.
- Early demo access exists for participants who post the LinkedIn promo, but **all data and the formal competition are equal for everyone**; early access is familiarization only **[DISCORD]**.

---

## 3. Account, leverage, instruments

**Account** **[RULES]** §2: simulated, $1,000,000 initial, **30:1 max leverage**, unified market environment (everyone sees the same quotes), zero principal risk.

**Asset scope** **[RULES]** §3 + **[DISCORD]**: major FX pairs, **XAUUSD** (gold), **XAGUSD** (silver), and **5 crypto: BTCUSD, ETHUSD, SOLUSD, XRPUSD, BARUSD** (the catalog symbol is `BARUSD` / "BAR vs USD", but the UNDERLYING is **HBAR — Hedera**, per Discord — see the note below). The **venue catalog may list 30+ symbols**, but only the **final competition-tradeable 15** are in scope; **Gordon's live universe is the 15** (8 FX + XAUUSD + XAGUSD + 5 crypto) in `competitionStrategy.ts`. **No stocks, indices, bonds, or oil.** **No options** (use stop-losses; no option hedging). The list is final; still confirm live symbol strings, contract specs, tick sizes, leverage, and spreads at login.

> **[BARUSD = HBAR/Hedera — resolved]** The MT5 catalog symbol is `BARUSD` (description "BAR vs USD", base "BAR"), which is ambiguous — on Binance "BAR" is the Barcelona fan-token. Discord (**Lotus**, organizer) clarified the competition's "BAR" is **HBAR (Hedera)**. Our data-fetch maps `BARUSD → Binance HBARUSDT`, so `data/momq/bars/BARUSD_M15.json` is correctly Hedera. Keep the symbol `BARUSD` (it matches the catalog); the only residual is to confirm at login the live symbol string is still "BARUSD" (if renamed "HBARUSD", relabel).
> **[CONFIRM]** Pull the full instrument list from the console once logged in — contract specs, per-instrument leverage, tick size, and spreads feed Gordon's sizing.

---

## 4. Data

**Historical (provided)** **[DISCORD]**:
- **Coverage:** 1 month prior to launch.
- **Resolution:** tick-level.
- **Depth:** minimum **5 levels of order-book depth (L2)**.
- **Format:** parquet (~20 GB), timestamped bid/ask levels, sizes, instrument metadata. Download from the Syphonix **"Backtest data"** tab after login.
- **Gaps flagged by participants:** **crypto (incl. BAR/USD) is missing** from the Syphonix parquet → source it yourself (done — we fetched BTC/ETH/SOL/XRP + BAR=HBAR from Binance). No further backtest-data update is coming (Duncan, Discord). Some non-tradable symbols had partial coverage (Oil, AUDJPY, "XAUKUSD") — **these are NOT in the final tradable list** (see below), so ignore them.
- **FINAL tradable list confirmed (Duncan, Discord — "now final"):** exactly the **15** = FX(8) AUDUSD, EURCHF, EURGBP, EURUSD, GBPUSD, USDCAD, USDCHF, USDJPY · Metals(2) XAGUSD, XAUUSD · Crypto(5) **BARUSD**, BTCUSD, ETHUSD, SOLUSD, XRPUSD. This matches `COMPETITION_TRADEABLE` exactly, and confirms the symbol is literally **BAR/USD** (underlying HBAR/Hedera).
- **Only 1 month is provided** (size + 1-week live window). More history → use your own sources.

**External data is explicitly allowed** **[DISCORD]** — news APIs, prediction markets, public crypto feeds, etc. The platform does not provide these but does not restrict them.

**Live** **[DISCORD]**: the live API streams the same **5-level depth** in real time.

---

## 5. Execution mechanics & costs

**[DISCORD]**, Duncan:

- **Order-book matching model**, *not* dealing-desk. Limit orders rest as liquidity and fill by **queue position + available liquidity**; **partial fills** occur when volume is limited.
- **TRUE DEPTH LADDER (Duncan, Discord):** "Large orders can consume multiple levels, and fills are calculated across the available liquidity." → an order bigger than top-of-book walks the book + partial-fills. **This validates the depth-aware order sizing** (`depthSizing.ts` / `clampToDepth`) — size to fillable depth so FOK/IOC orders fill instead of bouncing.
- **Maker and taker** both supported (limit + marketable orders).
- **ACCESS = native MT5 Desktop Terminal — NO REST/WebSocket gateway (Duncan, Discord, confirmed):** "Trading will be through the native MT5 Desktop Terminal. Please prepare your environment accordingly." You run the MT5 terminal yourself (Windows), driven via the official `MetaTrader5` Python package. **This confirms Gordon's topology exactly** (OPERATIONS §1: Windows VPS → MT5 terminal → `mt5_bridge.py` sidecar → `Mt5BridgeClient`). There is no hosted API to integrate against — prepare the always-on Windows box now.
- The **real market order book is an INPUT to a per-account simulation**. You do **not** trade the live production book; other participants **cannot** interact with your orders (matching is internal/per-account; not yet transparent).
- **Slippage, liquidity constraints, and market impact are simulated.** Validate in the test env from the 18th.
- **Costs: NO commission. Swap/financing is TBD per the final specs** (early Discord said "no swap," the final rules left it unconfirmed — **confirm at login**; assume it may apply). Modelled friction = **spread + slippage + market impact** (+ swap if confirmed).
- **Sub-millisecond execution; no trading-frequency limit** on the platform side (MT5 API layer may impose its own). Safe-harbor ≤ **500 requests/sec** (above that, only penalized if it causes system anomalies).

> Implication: with zero commission/swap, high-frequency *diversified* compounding carries no per-trade drag — favourable for the chosen posture (§9). But the dry-run must model spread/slippage to stay honest.

---

## 6. Scoring (the objective function)

From **[RULES]** §§11–16. Implemented exactly in `src/core/risk-management/competition-scoring.ts`.

> **[RULES, confirmed 2026-06-16]** Verified against the updated platform rules: the 70/15/10/5 Final Score formula below is **unchanged**. The update **added Section 17 (Best Sharpe Ratio Award)** — see §8.5. Sections 1–16 and 18–21 are as transcribed.

### 6.1 Final Score

```
Final Score = 0.70 · ReturnRank
            + 0.15 · DrawdownRank
            + 0.10 · SharpeRank
            + 0.05 · RiskDiscipline
```

All ranks are **cross-sectional / relative**: each metric is converted to a 0–100 score against the **active** field (best = 100, worst = 0; a sole participant = 100). **Return dominates at 70%.**

### 6.2 Metrics

- **Return** `Return_i = (Equity_final - 1,000,000) / 1,000,000` (off the fixed baseline; equity carries across rounds).
- **Max Drawdown** `MaxDD_i = max_t (PeakEquity - Equity) / PeakEquity` — lower is better. **Measured CUMULATIVELY from the original $1M, NOT reset per round** (Lotus, Discord: MaxDD/return are tracked "from the original $1M"). So an early deep drawdown is permanent in the DD rank — which *reinforces* the survive-smoothly posture (every drawdown counts for the whole competition). Our standing monitor already computes DD on the full equity curve, so this matches; only Risk-Discipline (§13) resets per round.
- **Sharpe (non-annualized)** on **15-minute equity returns**: `Sharpe_i = Mean(r) / Std(r)`, where `r_t = (E_t − E_{t-1}) / E_{t-1}`.
  - `Std = 0 → Sharpe = 0`. *(A perfectly smooth line has zero variance → Sharpe 0; you need positive mean **with** nonzero variance.)*
  - **< 8 valid 15-min observations → Sharpe Rank capped at 50.**
- **Rank normalization** `Rank Score_i = 100 · (N − rank_i) / (N − 1)`, `N = 1 → 100`. Ties share a rank.

### 6.3 Risk Discipline (§13) — starts at 100/round, resets each round, floor 0

| Rule | Threshold | Penalty |
|---|---|---|
| Margin usage = UsedMargin/Equity | > 90% for ≥ 30 min | −20 |
| | > 95% for ≥ 15 min | −30 |
| | > 98% for ≥ 10 min | compliance review |
| Leverage = GrossNotional/Equity | > 28× for ≥ 30 min | −20 |
| | > 29× for ≥ 15 min | −30 |
| | ~30× for ≥ 10 min | compliance review |
| Single-instrument exposure | > 90% for ≥ 30 min | −10 |
| Net directional exposure | > 95% for ≥ 30 min | −10 |

Directional trading is allowed; what's penalized is **prolonged, extremely concentrated, near-full-leverage** risk.

### 6.4 Red-lines (§14) — instant disqualification / elimination

- **Forced liquidation (margin wipeout)** → immediate elimination, no advancement.
- System/quote/latency/matching/settlement **exploits**, or circumventing limits → DQ.
- **API abuse** (flooding, bypassing limits, attacks, unauthorized access) → DQ. Safe-harbor ≤ 500 req/s.
- **Multi-account** participation, **collusion / pre-arranged trading / cross-account risk transfer** → DQ.

### 6.5 Tie-breakers (§16)

Final Score → higher Return → lower MaxDD → higher Sharpe → higher Risk Discipline → "more reasonable trading activity" → organizer review.

### 6.6 Transparency (§8)

During Rounds 1–3, participants see a **near-real-time leaderboard + peer trading logs + positions + risk metrics at 5-minute latency**. **Finals are blinded** (own account only). Post-competition, the organizer publishes final standings, verified logs, and any penalty rulings (Trade/Order IDs only; no PII).

---

## 7. Trading interfaces & integration

**Three nominal surfaces, but for an automated system only one matters** **[DISCORD]**:

| Surface | Reality |
|---|---|
| **MT5** | **The only programmatic path.** Full API for automation via the `MetaTrader5` Python package. Credentials open **18 Jun**. |
| **Syphonix AI Agent** | Chat/AI-agent UI for non-coders. **No separate REST API** ("we will prepare one" — non-committal). Using it would sideline Gordon → out. |
| **Chat interface** | Same as above — the organizers' agent, not ours. |

> **Key correction:** there is **no Syphonix REST API**. The repo's `src/infra/broker/adapters/syphonix.ts` (a REST `BrokerAdapter` scaffold) is the **wrong abstraction** for execution and must be repurposed to an **MT5 adapter**. It stays gated-off and harmless until then.

### 7.1 Gordon ↔ MT5 architecture

```
Gordon (Bun/TS, Windows)  ──►  MT5 bridge (MetaTrader5 Python pkg)  ──►  MT5 terminal  ──►  Syphonix sim
   strategy · risk · scoring         order / quote / positions / account IPC          execution venue
```

- The `MetaTrader5` Python package requires a **local Windows MT5 terminal** (not native Linux; Northflank is Linux). The operator runs **Windows 11**, so MT5 + bridge + Gordon co-locate locally for dev.
- For the **24/7 live week**, run on an **always-on Windows VPS**. Northflank ($100 credit) hosts Gordon's non-MT5 services (data, dashboards), not the MT5 terminal.

### 7.2 The bridge — BUILT

- **Python sidecar** `scripts/mt5-bridge/mt5_bridge.py` — wraps the `MetaTrader5` package behind a localhost JSON API. Endpoints: `/health /account /positions /orders /symbols /symbol /quote /depth (L2) /bars /order /cancel /close`. Binds to `127.0.0.1` only; **deny-first trading guard** (`/order`,`/cancel`,`/close` validate via `order_check` and refuse to fire unless `MT5_BRIDGE_ALLOW_TRADING=1`). MT5 API surface used: `account_info`, `positions_get`, `orders_get`, `symbols_get`/`symbol_info`, `symbol_info_tick`, `market_book_get` (L2), `copy_rates_*`, `order_send`/`order_check`.
- **Typed client** `src/infra/broker/mt5/bridgeClient.ts` (`Mt5BridgeClient`) — Gordon-side transport, 8 tests.
- **BrokerAdapter** `src/infra/broker/adapters/mt5.ts` (`Mt5Adapter`, brokerId `mt5`) — maps onto the normalized broker contract; registered in the factory + inclusion gate (approved). 7 adapter tests. `BrokerCredentials.apiKey` = bridge token, `baseUrl` = bridge URL; the MT5 account login/password/server live in the **sidecar env**, never in Gordon.
- **Run it:** install MT5 terminal + log in → `pip install -r scripts/mt5-bridge/requirements.txt` → set `MT5_LOGIN/MT5_PASSWORD/MT5_SERVER`, `MT5_BRIDGE_TOKEN`, `MT5_BRIDGE_ALLOW_TRADING=1` → `python scripts/mt5-bridge/mt5_bridge.py` → `bun run scripts/dev/mt5/mt5-smoke.ts` to verify against the real account. See `scripts/mt5-bridge/README.md`.

---

## 8. Prizes, judging, partner perks

### 8.1 Cash (§ marketing /momq/prizes)

| Place | Prize |
|---|---|
| 1st | $30,000 |
| 2nd | $15,000 |
| 3rd | $6,000 |
| 4th | $5,000 |
| 5th | $4,000 |
| 6th–25th | $1,000 each |
| **Best Sharpe Ratio** | **$10,000** (eligibility-gated — see §8.5) |
| **Best Technology Setup** | **$10,000** |

"One winner takes $50k" = sweeping 1st ($30k) + Best Sharpe ($10k) + Best Tech ($10k).

### 8.2 Partner bounties

- **NVIDIA Hardware Prize** — most innovative use of Nemotron / NVIDIA compute among finalists (part of technology judging). No support channel; prize only.
- **Anthropic Credit Prize** — best use of Claude / Anthropic API in strategy design, signal generation, or execution. **Gordon is Claude-native → natural fit.**

### 8.3 Tech-prize eligibility (§9) — applies to Top 25

After **Round 3 (24 Jun)**, eligible participants submit (form on the platform):
1. **GitHub repo** link (code).
2. Overview of **partner technologies** used + how.
3. **Data usage** details.
4. A **demonstration** of how the project works.

**Judging criteria** (3 axes): **System Design** (architecture quality, scalability, robustness) · **AI Integration** (how effectively AI drives signal-gen / risk-management / execution) · **Execution Approach** (strategy clarity, risk-adjusted returns, performance). **IP stays with the participant**; access is for judging only.

### 8.4 Developer credits / perks

| Partner | Perk | Access |
|---|---|---|
| **Anthropic** | $50 API credits | `platform.claude.com` offer link (from Luma/Discord) |
| **Pydantic** | $50 Logfire inference credits | `pydantic.dev/hackathon` |
| **Doubleword** | Inference API access | via the Pydantic AI gateway (Logfire); $100 free at `unlimiteddirtcheaptokens.com`, mention "AIEngine" |
| **Northflank** | $100 platform credit | `app.northflank.com/signup`; GPU (L4) interest form separately |

### 8.5 Best Sharpe Ratio Award — $10,000 (§17)

Implemented in `competition-scoring.ts` (`selectBestSharpeAward` / `isBestSharpeEligible`).

**Eligibility — ALL four required:**
1. **Reach the Finals** (Top 100).
2. **Finish within the Top 50 of the final overall ranking.**
3. **No red-line violations.**
4. **≥ 30 trades executed.**

**Metric:** non-annualized 15-min-return Sharpe (`Mean(r)/Std(r)`) over the **entire competition period** (21–26 Jun), not just the finals. **Winner** = highest Sharpe among the eligible; ties break on **higher Final Return**, then **lower MaxDD**.

> **Strategic consequence — the Best Sharpe award is return-gated too.** You cannot win it with a low-return smooth book: a **Top-50 overall finish** (return-driven, §17) is a hard gate, alongside the **≥30-trade floor**. The smooth barbell core (§9) clears the trade floor and wins the Sharpe/Drawdown ranks — but, exactly as in the main competition, a *median-return* book may not reach Top-50 on its own. So the Best Sharpe prize rides on the same return lever: the **endgame sleeve** is what can push us into Top-50 territory. A few-big-bets approach risks failing both the Top-50 gate (blow-up) and the trade floor.

---

## 9. Strategy posture (FROZEN — survive-and-rank + endgame sleeve, finalized 2026-06-17)

> Supersedes the earlier "diversified aggressive compounding / prioritize 1st" framing. The exhaustive
> alpha search found **no return edge** that clears realistic cost, so the return rank (70%) is a variance
> lottery we can't *earn*. The authoritative, executable version of this posture — including the launch
> sequence and the pre-committed decision tree — is **`OPERATIONS.md` §9 (Decision Playbook)**; the tech
> framing is in `TECH_SETUP_DECK.md`. This section is the summary.

**Goal:** maximize the **composite finish**, not chase 1st with variance. Bank the controllable ~25–30% (Drawdown 15% + Sharpe 10% + Risk-Discipline 5%) by surviving smoothly, and take the one sanctioned swing at the return rank at the *decisive* moment.

**Approach — barbell: smooth core + ring-fenced one-shot sleeve.**
- **Core (frozen `COMPETITION_RISK_SURVIVAL`):** a dollar-neutral discrete-hysteresis **RV-reversion** book over the within-cluster crypto + metals pairs — many small, low-variance, market-neutral trades. Smooth equity → wins the Sharpe (10%) + Drawdown (15%) ranks; breadth clears the **§17 ≥30-trade** floor.
- **Sleeve (one-shot, ring-fenced reserve):** a single liquidation-safe leveraged bet that fires ONLY at the decisive moment — the **Round-3 endgame if we're below the Top-100 cut** (a median smooth book does NOT clear it alone), or the **finals if lagging**. Sized so a total loss can't red-line the core. Deployed on **real standing data only** (no auto-fire on the placeholder model).
- All ceilings stay under the §13 thresholds (leverage < 28×, margin < 90%, single-instrument < 90%, net-directional < 95%); **never concentrate enough to risk forced liquidation** (instant elimination, the one unrecoverable error).
- **Best Tech + Anthropic bounty are decoupled from the trading dial** — they ride on Gordon's architecture and the submission.

The core is the **frozen** `COMPETITION_RISK_SURVIVAL` preset in `competition-risk-preset.ts`; the sleeve is the only sanctioned return-gamble (ring-fenced, one-shot). `COMPETITION_RISK_AGGRESSIVE` remains in the file but is **NOT** the live posture.

> Why not a few 30× bets on the core? It's a relative tournament with attrition: most aggressive entrants blow up (forced liquidation = auto-elimination). Gordon's no-wipeout governance **survives by construction**, which is itself a ranking edge — and the skill prizes (Sharpe, Tech) are where a disciplined system dominates the field. The bounded return-swing lives in the ring-fenced sleeve, not the core.

---

## 10. What's built vs. open

**Built (this prep):**
- `core/risk-management/competition-scoring.ts` — exact §11–17 objective function (Final Score, ranks, non-annualized 15-min Sharpe + cap, §13 discipline, red-line DQ, tie-breakers) + the §17 Best Sharpe Award eligibility/winner selection (`selectBestSharpeAward`). 16 tests.
- `backtest/competition-dry-run.ts` — money-path rehearsal; reports the official metrics. 16 tests.
- `core/risk-management/competition-risk-preset.ts` — the frozen `COMPETITION_RISK_SURVIVAL` default (the live core); `COMPETITION_RISK_AGGRESSIVE` retained but not used.
- **Live execution: the MT5 barbell path** — `scripts/competition/live-runner.ts` → `barbellLiveRunner.ts` (RV core + ring-fenced sleeve + survival breaker + standing monitor + kill-switch). The single live entry point (NOT `competition-runner.ts`, which is legacy prep scaffolding).

**Built (this prep), cont'd:**
- **MT5 bridge — DONE** (§7.2): Python sidecar + `Mt5BridgeClient` + `Mt5Adapter` (registered, gate-approved). 15 tests. Validate against the real account via `scripts/dev/mt5/mt5-smoke.ts`; wire to Syphonix's MT5 creds on the 18th (just swap the sidecar env).

**Open / TODO:**
- **Wire the live peer-return board** — populate `$COMP_PEER_RETURNS_PATH` from the Round-1–3 leaderboard so the standing calibrates to real rank and the endgame sleeve arms (§9 / OPERATIONS §9.2). Launch-gated.
- **Confirm at login** — exact tradeable list + contract specs, the `BARUSD` symbol string, and whether swap/financing applies (then enable it in the cost model).
- **Tech-setup deck (Track C)** — structured to the 3 judging axes + Anthropic-bounty angle.

> Done since the earlier draft: the dry-run cost layer (spread + slippage; swap gated on confirmation), the survive-and-rank posture freeze, and the full MT5 live path. Strategy selection ran (exhaustive alpha search → no cost-clearing edge → the survive-and-rank posture).

**To CONFIRM on the platform:**
- [x] Current scoring formula + risk limits on the Rules tab — **confirmed 2026-06-16**: 70/15/10/5 unchanged; §17 Best Sharpe Award added.
- [x] Final competition-tradeable 15-symbol list — **confirmed by Duncan / Discord** and matches `COMPETITION_TRADEABLE`.
- [ ] Per-instrument contract specs, leverage, tick size, spreads.
- [ ] Exact launch time (21 Jun 22:00 vs 23:00 BST — both cited).
- [ ] Finals cutoff terminology (24 Jun blind cut vs 26 Jun trading close).
- [ ] MT5 API rate limits (frequency constraints live in the MT5 layer).

---

## 11. Related docs

- `docs/model-to-market/COMPETITION_ARCHITECTURE.md` — Gordon's system architecture for the tech-setup submission.
- `docs/model-to-market/SYPHONIX_INTEGRATION.md` — original integration runbook (⚠️ **partly superseded**: assumed a Syphonix REST API; the real path is MT5 — see §7).
