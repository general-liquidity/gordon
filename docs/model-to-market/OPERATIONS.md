# Gordon — Live-Week Operations Runbook (Model to Market)

**The 24/7 operations runbook for the Model to Market live trading week.** Last updated **2026-06-16**.

This is the operational companion to:
- `docs/model-to-market/COMPETITION_BRIEF.md` — the single competition reference (schedule, scoring, rules).
- `docs/model-to-market/COMPETITION_ARCHITECTURE.md` — Gordon's system design.
- `scripts/mt5-bridge/README.md` — the bridge sidecar setup + endpoints.

Scope: how to bring Gordon up for the live window, keep it healthy 24/7, watch the live risk limits, and kill it fast. **Operational only — no strategy tuning here.**

---

## 1. Topology — one always-on Windows machine

The `MetaTrader5` Python package is **Windows-only** and talks to a **locally-running MT5 terminal**. Northflank (the $100 credit) is **Linux** and therefore **cannot host the MT5 terminal**. So the execution path lives on **one always-on Windows machine / VPS**, running three co-located processes:

```
Windows VPS (always-on)
├─ 1. MetaTrader 5 terminal      ── logged into the Syphonix competition account
├─ 2. mt5_bridge.py (sidecar)    ── scripts/mt5-bridge/mt5_bridge.py
│      └─ localhost JSON API on 127.0.0.1:8788, wraps the MetaTrader5 pkg
└─ 3. Gordon live runner         ── scripts/competition/live-runner.ts (the live execution loop)
       └─ Mt5BridgeClient (src/infra/broker/mt5/bridgeClient.ts) ──HTTP──► sidecar
```

Data path:

```
Gordon (Bun/TS) ──HTTP──► mt5_bridge.py ──IPC──► MT5 terminal ──► Syphonix per-account sim
```

**Northflank hosts only non-MT5 services** — dashboards, data collection, auxiliary tooling. It must **never** run the MT5 terminal, the sidecar, or the live trade loop. Keep the money path on the Windows box.

The bridge binds to **`127.0.0.1` only** (not reachable off the machine), so all three processes must be on the same host. This is by design: the localhost-only bind is part of the safety posture.

---

## 2. The double safety guard (defense-in-depth)

**Orders fire only when BOTH guards are deliberately set.** Two independent layers, each in a different process:

| Guard | Where | Owner | Effect when set | Effect when unset |
|---|---|---|---|---|
| `MT5_BRIDGE_ALLOW_TRADING=1` | **Sidecar** env (`mt5_bridge.py`) | the bridge | `/order` `/cancel` `/close` actually call `order_send` | endpoints run `order_check` only and **refuse to fire** (validate-only) |
| `GORDON_LIVE_TRADING=1` | **Gordon live runner** env | the live trader | the loop submits real orders through the bridge | the loop reads/validates/sizes only — never submits |

**If either is unset, no real order is placed.** The sidecar guard is the last line: even a fully-armed Gordon cannot fire if `MT5_BRIDGE_ALLOW_TRADING` is not `1`, because the bridge will only `order_check`. Conversely, an armed sidecar does nothing on its own — Gordon won't submit without `GORDON_LIVE_TRADING=1`.

This is **intentional defense-in-depth**, mirroring Gordon's deny-first permission philosophy: two processes, two operators-worth of intent, both required to move capital. The default for both is **off** — a fresh run reads state and price-checks orders but cannot trade. Arm both **only at go-live** (Section 8).

> Note the smoke-test confirms this: `Mt5OrderResult.guard` is populated ("trading-disabled") when the sidecar guard blocks, and `health.tradingEnabled` reports the sidecar's state.

---

## 3. Environment configuration

**Credential boundary (important):** the MT5 **account** credentials live in the **sidecar env only** — never in Gordon. Gordon points at the bridge, not at MT5.

### Sidecar env (`mt5_bridge.py`) — holds the account creds

| Var | Purpose |
|---|---|
| `MT5_LOGIN` | competition account number (optional if the terminal is already logged in) |
| `MT5_PASSWORD` | account password |
| `MT5_SERVER` | broker server name (the Syphonix MT5 server) |
| `MT5_TERMINAL_PATH` | path to `terminal64.exe` (optional; auto-detected if running) |
| `MT5_BRIDGE_PORT` | default `8788` |
| `MT5_BRIDGE_TOKEN` | shared secret; callers must send it as `X-Bridge-Token` |
| `MT5_BRIDGE_ALLOW_TRADING` | **`1` to actually fire orders** — guard #1 (Section 2) |

### Gordon live-runner env — points at the bridge, never sees the account creds

`Mt5BridgeClient` (and the `Mt5Adapter` `BrokerCredentials`) describe the **bridge**:

| Setting | Value |
|---|---|
| `apiKey` (`BrokerCredentials.apiKey`) | `MT5_BRIDGE_TOKEN` — must match the sidecar's token |
| `baseUrl` (`BrokerCredentials.baseUrl`) | `http://127.0.0.1:8788` (or `http://127.0.0.1:${MT5_BRIDGE_PORT}`) |
| `GORDON_LIVE_TRADING` | **`1` to submit real orders** — guard #2 (Section 2) |

The client defaults `baseUrl` to `http://127.0.0.1:${MT5_BRIDGE_PORT|8788}` and reads the token from `MT5_BRIDGE_TOKEN` if not passed explicitly.

### Optional — tracing / inference perks

| Var | Purpose |
|---|---|
| `LOGFIRE_TOKEN` | Pydantic Logfire tracing (perk: $50 inference credits) — enables trace export for monitoring |
| `DOUBLEWORD_API_KEY` | Doubleword inference API (via the Pydantic AI gateway) |

---

## 4. Start sequence for the live window

**Live window: 21 Jun 22:00 BST → 26 Jun 22:00 BST.** Bring up the stack **in order** — each layer depends on the one below it.

1. **MT5 terminal** — launch on the Windows box; confirm it is logged into the competition account and the live feed is connected (price ticking).
2. **Sidecar** — set the sidecar env (Section 3), then:
   ```
   pip install -r scripts/mt5-bridge/requirements.txt   # first time only
   python scripts/mt5-bridge/mt5_bridge.py
   ```
   At go-live, the sidecar env includes `MT5_BRIDGE_ALLOW_TRADING=1` (guard #1).
3. **Smoke test** — verify the Gordon↔MT5 transport against the real account before arming the loop:
   ```
   bun run scripts/dev/mt5-smoke.ts
   ```
   Reads account + quote + L2 depth + bars + symbol spec. `health.tradingEnabled` reflects the sidecar guard. Add `--symbol EURUSD` to check a specific pair; `--trade` places and immediately cancels a tiny far-from-market limit (only fires if the sidecar is armed). **Smoke must be green before proceeding.**
4. **Live runner** — start the live execution loop with `GORDON_LIVE_TRADING=1` (guard #2):
   ```
   bun run scripts/competition/live-runner.ts
   ```
   The runner sizes every order through the **competition risk preset** (Section 5) and submits via the bridge.

### Round cadence (BST) — see COMPETITION_BRIEF.md §2 for the full table

| When | What |
|---|---|
| **21 Jun 22:00** | Official launch; accounts initialize at $1M |
| **22 Jun 22:00** | Round 1 close — snapshot + 22:00–23:00 compliance audit; eliminations |
| **23 Jun 22:00** | Round 2 close — audit; eliminations |
| **24 Jun 22:00** | Round 3 close → **Top-100 cut; leaderboard goes BLIND** |
| **24 Jun 22:00 → 26 Jun 22:00** | **Finals (blind)** — no live ranking shown; trade your own book |
| **26 Jun 22:00** | Trading closes; all positions liquidated; final PnL + Sharpe computed |

Equity **carries across rounds** — it is not reset. Keep the stack up continuously through eliminations; only the leaderboard visibility changes at the 24th.

---

## 5. Live risk limits to watch (Section 13 of the rules)

The **Risk Discipline** score (§13) resets to 100 each round and is penalized for *prolonged, extremely concentrated, near-full-leverage* risk. Watch these continuously:

| Limit | Threshold to stay under | Penalty if breached |
|---|---|---|
| **Margin usage** (UsedMargin/Equity) | **< 90%** | −20 (>90% ≥30 min); −30 (>95% ≥15 min); review (>98% ≥10 min) |
| **Leverage** (GrossNotional/Equity) | **< 28×** | −20 (>28× ≥30 min); −30 (>29× ≥15 min); review (~30× ≥10 min) |
| **Single-instrument exposure** | **< 90%** | −10 (>90% ≥30 min) |
| **Net directional exposure** | **< 95%** | −10 (>95% ≥30 min) |

### THE RED LINE (§14) — instant elimination, no advancement

- **Forced liquidation (margin wipeout) → immediate elimination.** Never let margin run to a forced-liquidation. This is the single non-negotiable.
- Also DQ: exploiting quote/latency/matching/settlement, API abuse / flooding (safe-harbor ≤ 500 req/s), multi-account, collusion / pre-arranged trading.

**These are enforced in code, not just watched.** The **competition risk preset** (`src/core/risk-management/competition-risk-preset.ts`) sizes every order as a **min-of-caps** so the most conservative constraint always binds:
- `COMPETITION_RISK_DEFAULTS` (survive-and-compound): 0.5% per-trade risk, 3× leverage, 15% vol target, 3% daily-loss kill, 60% exposure cap, 0.25 fractional Kelly.
- `COMPETITION_RISK_AGGRESSIVE` (go-for-1st posture): 1.5% per-trade, 6× per-position leverage (forces a wide diversified book), 35% vol target, 8% daily-loss kill, ~10× gross exposure, 0.4 fractional Kelly.

Every ceiling in both presets sits **well under** the §13 thresholds (leverage < 28×, margin < 90%, single-instrument < 90%, net-directional < 95%) and never concentrates enough to risk forced liquidation. The `daily_loss_kill` constraint **halts trading for the day** (verdict `halt`) when the day's PnL hits the kill level — protecting drawdown rank and keeping the book away from the red line. The preset is **pure and never throws**; it is selected via the run config, not auto-wired.

---

## 6. Reconnect, heartbeat & monitoring (24/7)

The live runner's loop is **reconnect-tolerant by design** — wrapped in try/catch so a transient bridge/terminal hiccup never throws the loop dead; it logs, backs off, and retries on the next tick. The transport surfaces clear failures: `Mt5BridgeClient` throws `Mt5BridgeError` with `"MT5 bridge unreachable … is mt5_bridge.py running?"` when the sidecar is down, so a dropped sidecar is visible immediately.

Monitoring checklist (run continuously):

- **Bridge health** — `GET /health` returns `{ ok, tradingEnabled, account }`. `ok:false` or a missing `account` means the terminal/sidecar lost the connection. `tradingEnabled` must read `true` during the live window (guard #1). The smoke test exercises this path.
- **Account state** — `GET /account` (equity / balance / margin / free margin / **margin_level**). Watch `margin_level` as the early-warning for the forced-liquidation red line.
- **Positions / orders** — `GET /positions`, `GET /orders` to reconcile what's open vs. what the runner thinks is open.
- **Logfire traces** — with `LOGFIRE_TOKEN` set, agent/tool traces export for live observability.
- **Real-time leaderboard** — during Rounds 1–3 the platform shows a near-real-time leaderboard + peer logs + risk metrics at ~5-minute latency. **Finals (after 24 Jun) are blinded** — you see only your own account, so rely on `/account`, `/positions`, and Logfire then.
- **Terminal liveness** — keep the MT5 terminal logged in; if the feed stops ticking (bid/ask 0), positions still need managing but new sizing is starved. The smoke test flags a dead feed explicitly.

---

## 7. Kill switch — how to halt trading fast

Escalating, fastest-first. Any one of these stops new orders:

1. **Disarm Gordon (guard #2)** — unset `GORDON_LIVE_TRADING` (or set to anything other than `1`) and restart the runner. The loop drops to read/validate-only; no new submissions.
2. **Stop the live runner** — kill `scripts/competition/live-runner.ts`. No process, no orders. The sidecar and terminal keep running so you retain read access to manage open positions.
3. **Disarm the sidecar (guard #1)** — set `MT5_BRIDGE_ALLOW_TRADING=0` (or unset) and restart `mt5_bridge.py`. Now **nothing** can fire through the bridge even if Gordon is armed — `/order` `/cancel` `/close` validate-only. This is the hard stop at the transport layer.

To **flatten** positions rather than just halt new entries, use the bridge directly while it is still armed: `POST /close` per ticket (or close from the MT5 terminal UI), **then** disarm. Disarming the sidecar first will block `/close` too — order matters: close, then disarm.

> The full kill is: stop the runner → close positions if needed → disarm the sidecar. Either guard alone halts *new* trading instantly; both unset is the resting safe state.

---

## 8. Pre-launch checklist

Run this immediately before **21 Jun 22:00 BST**. Arm the two guards **only at this point** — they are off until go-live.

- [ ] **Windows box up** — always-on Windows machine/VPS confirmed reachable; clock synced to BST.
- [ ] **MT5 terminal** logged into the competition account; live feed ticking (not bid/ask 0).
- [ ] **Account creds in the sidecar env only** — `MT5_LOGIN` / `MT5_PASSWORD` / `MT5_SERVER` set on the sidecar; **not** present anywhere in Gordon's env.
- [ ] **Bridge token matches** — `MT5_BRIDGE_TOKEN` identical on the sidecar and in Gordon's `apiKey`; `baseUrl` = `http://127.0.0.1:8788`.
- [ ] **Smoke test green** — `bun run scripts/dev/mt5-smoke.ts` passes (account + quote + depth + bars + symbol spec). Re-run with the final symbol list.
- [ ] **Final tradeable instrument list confirmed** on the platform/console — the 30+ instruments + per-instrument contract specs / leverage / tick size / spreads (released at login). Symbols are resolved from the venue catalog at runtime, never hardcoded.
- [ ] **Risk preset selected** — `COMPETITION_RISK_AGGRESSIVE` (or `DEFAULTS`) wired into the run config; ceilings confirmed under §13 thresholds.
- [ ] **Optional perks** — `LOGFIRE_TOKEN` set for tracing; `DOUBLEWORD_API_KEY` if used.
- [ ] **Both guards set — deliberately, at go-live** — `MT5_BRIDGE_ALLOW_TRADING=1` on the sidecar **and** `GORDON_LIVE_TRADING=1` on the runner. Until both are `1`, the stack is validate-only by design.
- [ ] **Kill switch rehearsed** — Section 7 steps confirmed working (disarm runner, stop runner, disarm sidecar) before capital is live.

> Resting safe state between sessions / after the close: **both guards unset.** The stack then reads and validates but cannot move capital.
