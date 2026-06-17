# Gordon — Live-Week Operations Runbook (Model to Market)

**The 24/7 operations runbook + decision playbook for the Model to Market live trading week.** Last updated **2026-06-17**.

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

### Competition env (the live-runner reads these) — set at launch

| Var | Purpose |
|---|---|
| `COMP_STARTING_EQUITY` | the §12 baseline (set **`1000000`** explicitly — return is scored off the fixed $1M, not current equity) |
| `COMP_CUT_MS` | epoch-ms of the **Top-100 finals cut** (24 Jun 22:00 BST). Drives the phase gate AND the **pre-finals endgame sleeve** + the standing readout. |
| `COMP_DEADLINE_MS` | epoch-ms of the **contest end** (26 Jun 22:00 BST). Drives the liquidation horizon. |
| `COMP_STATE_PATH` | file path for **restart-safe** equity/risk history (e.g. `.gordon/comp-state.json`) — survive a process restart without losing the standing/Sharpe history |
| `COMP_FLATTEN_FLAG` | path to the **kill-switch flag file** — `touch` it to flatten the whole book, `rm` it to resume (Section 7) |
| `COMP_ALERT_PATH` | file the **critical-event alerts** append to (default `comp-alerts.log`) — `tail -f` it so you're not tied to the screen 24/7 |
| `COMP_FIELD_N` / `COMP_CUT_PCT` | field size (default 500) + cut percentile (default 0.8) for the standing's rank estimates |
| `GORDON_COMP_FLATTEN` | set to `1` as an alternative process-level kill-switch (flattens every cycle) |

> Convert the BST round times to epoch-ms before launch. `COMP_CUT_MS = Date.parse("2026-06-24T22:00:00+01:00")`, `COMP_DEADLINE_MS = Date.parse("2026-06-26T22:00:00+01:00")`.

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
3. **Preflight GO/NO-GO** — one read-only command runs every readiness check (bridge health, account, contract specs for all 15, spread sanity, guard state) → a single GO/NO-GO verdict:
   ```
   bun run scripts/competition/preflight.ts
   ```
   **Must read GO** (critical checks pass) before arming. Feed-off / disarmed-guards are expected pre-launch (noted, not failed).
4. **Smoke test** — verify the Gordon↔MT5 transport against the real account:
   ```
   bun run scripts/dev/mt5/mt5-smoke.ts            # account + quote + L2 depth + bars + symbol spec
   ```
   `--trade` places + cancels a tiny far-from-market limit (only fires if the sidecar is armed).
5. **Spread check (the decisive read)** — the single biggest live unknown: real spreads decide whether the book is net-positive or the ~0 relative-rank play. Run the moment the feed is on:
   ```
   bun run scripts/dev/mt5/competition-spread-check.ts
   ```
   Verdict GOOD (<2bps) / MARGINAL / POOR per instrument vs the empirical break-even. Record it — it feeds the Decision Playbook (Section 9).
6. **Live runner** — set the competition env (Section 3) + `GORDON_LIVE_TRADING=1` (guard #2), then:
   ```
   COMP_STARTING_EQUITY=1000000 COMP_CUT_MS=... COMP_DEADLINE_MS=... \
   COMP_STATE_PATH=.gordon/comp-state.json COMP_FLATTEN_FLAG=.gordon/FLATTEN \
   GORDON_LIVE_TRADING=1 bun run scripts/competition/live-runner.ts
   ```
   The runner: discrete-hysteresis RV core → depth-aware reconcile → fills (slippage tracked) → the **automatic margin breaker** + **standing monitor** each cycle. It logs the live standing + any alerts every cycle.
7. **Standing watch (read-only dashboard)** — in a second terminal, monitor the standing WITHOUT arming trading:
   ```
   COMP_STARTING_EQUITY=1000000 COMP_CUT_MS=... COMP_DEADLINE_MS=... \
   bun run scripts/competition/standing-watch.ts
   ```
   And `tail -f comp-alerts.log` (or `$COMP_ALERT_PATH`) for critical-event alerts.

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
- **`COMPETITION_RISK_SURVIVAL` (the FROZEN default — survive-and-rank):** 0.5% per-trade risk, 3× leverage, 12% vol target, 3% daily-loss kill, 3× gross exposure, 0.25 fractional Kelly. Chosen after the exhaustive search found no edge: concede the luck-dominated return rank, bank the controllable Drawdown/Sharpe ranks + survival.
- `COMPETITION_RISK_AGGRESSIVE` (go-for-1st gamble — NOT the default): 1.5% per-trade, 6× per-position leverage, 35% vol target, 8% daily-loss kill, ~10× gross exposure, 0.4 fractional Kelly. Only swap in to gamble the return rank.

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
- **Live standing** — the runner (and the read-only `standing-watch.ts`) print our §11–17 standing every cycle: Return / 15-min Sharpe / max-DD / risk-discipline + estimated rank, stance, and whether the sleeve would arm. This is the primary decision surface (Section 9). Realized **slippage** is logged too — watch it vs the spread-check baseline.
- **Critical-event alerts** — the runner fires alerts (to `$COMP_ALERT_PATH` + console) on `SURVIVAL_BREAKER`, `KILL_SWITCH`, `MARGIN_PRESSURE` (margin level below the warn level, above the breaker), `SLEEVE_DEPLOYED`, and `ORDER_ISSUE`. `tail -f` the alert file so you don't have to watch the screen for 5 days.

---

## 7. Kill switch & survival flatten — how to halt fast

**Automatic (built-in, always on):** the runner's **margin circuit breaker** flattens the WHOLE book the moment account margin level falls to/through `breakerLevelPct` (default 50%, sitting well above the 30% stop-out = elimination). It runs *before* the strategy each cycle, so a survival emergency flattens rather than trading. It fires a `SURVIVAL_BREAKER` critical alert.

**Manual flatten (operator panic-button) — fastest, no restart:** create the kill-switch flag file:
```
touch .gordon/FLATTEN        # = $COMP_FLATTEN_FLAG → flatten the whole book this cycle
rm .gordon/FLATTEN           # resume
```
or set `GORDON_COMP_FLATTEN=1`. The runner flattens to zero targets (reconciles every position out) and fires a `KILL_SWITCH` alert — **no restart needed**, and it self-resumes when you remove the flag.

**Escalating halt (stops NEW orders), fastest-first:**
1. **Flag-file flatten** (above) — flattens + holds flat while the flag exists.
2. **Disarm Gordon (guard #2)** — unset `GORDON_LIVE_TRADING` and restart the runner → read/validate-only.
3. **Stop the live runner** — kill the process. Sidecar + terminal keep running so you retain read access to manage open positions. (The `COMP_STATE_PATH` history is preserved — a restart resumes the standing.)
4. **Disarm the sidecar (guard #1)** — `MT5_BRIDGE_ALLOW_TRADING=0` + restart `mt5_bridge.py`. Hard stop at the transport: nothing fires even if Gordon is armed.

To **flatten** via the venue directly: `POST /close` per ticket (or close in the MT5 UI) **then** disarm — order matters (disarming the sidecar first blocks `/close` too).

> Resting safe state: both guards unset. The flag-file flatten is the everyday panic-button; the sidecar disarm is the hard transport stop.

---

## 8. Pre-launch checklist

Run this immediately before **21 Jun 22:00 BST**. Arm the two guards **only at this point** — they are off until go-live.

- [ ] **Windows box up** — always-on Windows machine/VPS confirmed reachable; clock synced to BST.
- [ ] **MT5 terminal** logged into the competition account; live feed ticking (not bid/ask 0).
- [ ] **Account creds in the sidecar env only** — `MT5_LOGIN` / `MT5_PASSWORD` / `MT5_SERVER` set on the sidecar; **not** present anywhere in Gordon's env.
- [ ] **Bridge token matches** — `MT5_BRIDGE_TOKEN` identical on the sidecar and in Gordon's `apiKey`; `baseUrl` = `http://127.0.0.1:8788`.
- [ ] **Preflight GO** — `bun run scripts/competition/preflight.ts` reads **GO** (critical checks pass).
- [ ] **Smoke test green** — `bun run scripts/dev/mt5/mt5-smoke.ts` passes (account + quote + depth + bars + symbol spec).
- [ ] **Spread check recorded** — `bun run scripts/dev/mt5/competition-spread-check.ts` run + verdict noted (drives the §9.1 posture).
- [ ] **The 15 tradeable instruments confirmed** on the platform/console + per-instrument contract specs / tick size / spreads (released at login). Symbols are resolved from the venue catalog at runtime, never hardcoded.
- [ ] **Competition env set** — `COMP_STARTING_EQUITY=1000000`, `COMP_CUT_MS` (24 Jun 22:00 BST), `COMP_DEADLINE_MS` (26 Jun 22:00 BST), `COMP_STATE_PATH`, `COMP_FLATTEN_FLAG`, `COMP_ALERT_PATH` (Section 3).
- [ ] **Risk preset confirmed** — `COMPETITION_RISK_SURVIVAL` (frozen default); ceilings under §13. Swap to `AGGRESSIVE` never — the ring-fenced sleeve is the only sanctioned return-gamble.
- [ ] **Standing watch + alert tail running** — `standing-watch.ts` in a second terminal; `tail -f $COMP_ALERT_PATH`.
- [ ] **Optional perks** — `LOGFIRE_TOKEN` for tracing; `DOUBLEWORD_API_KEY` if used.
- [ ] **Both guards set — deliberately, at go-live** — `MT5_BRIDGE_ALLOW_TRADING=1` (sidecar) **and** `GORDON_LIVE_TRADING=1` (runner). Until both are `1`, the stack is validate-only.
- [ ] **Kill switch rehearsed** — Section 7 confirmed: the flag-file flatten (`touch $COMP_FLATTEN_FLAG`) flattens + resumes, and the disarm/stop/sidecar-disarm escalation works, before capital is live.
- [ ] **Decision Playbook (Section 9) reviewed** — the sleeve decision table + non-negotiables are pre-committed.

> Resting safe state between sessions / after the close: **both guards unset.** The stack then reads and validates but cannot move capital.

---

## 9. Decision Playbook — pre-committed judgment (decide NOW, not at 2am)

The finals are **blind** and the window is 5 days; the judgment calls must be pre-decided so execution under pressure is mechanical. The honest frame: **return (70% weight) is a variance lottery we can't earn** — the smooth surviving book banks the controllable ~25–30% (Drawdown + Sharpe + Risk-Discipline ranks) for free, and the **one-shot sleeve is the only lever on return**. Critically, the standing monitor showed a median-return smooth book lands ~mid-field and **does not clear the Top-100 finals cut on its own** (clearing it needs return in roughly the top ~29%). So the sleeve is likely *necessary to reach the finals*, not just to win them — but only deploy it on **real** standing data.

### 9.1 Launch read → posture (do once, when the feed opens)
- **Run the spread check** (Section 4 step 5). Record per-instrument bps.
  - Crypto majors **< ~2 bps** → the RV book is plausibly **net-positive**; run as-is.
  - **Wide (> ~4 bps)** → it's the **~0 relative-rank play**: still run it (smooth + survive wins the DD/Sharpe ranks vs a gambling field), but consider pruning the widest-spread pairs from the RV clusters.
- **Confirm the survive-and-rank preset** (`COMPETITION_RISK_SURVIVAL`) — do NOT swap to AGGRESSIVE for the core; the sanctioned return-gamble is the *sleeve*, ring-fenced.

### 9.2 Calibrate the field (once Round-1/2 peer data is visible)
- Rounds 1–3 expose peer returns at 5-min latency (§8). Feed them through `standingFieldCalibrator.calibrateReturnField(peerReturns)` and pass the result as the standing's `field` (and, if peer equity curves are exposed, `sharpeField`/`drawdownField` via `calibrateMetricField`). This replaces the placeholder gambling-field models so **the standing's rank — and the clears-cut decision — become real, not modeled.** Until then, treat the rank estimates as indicative.

### 9.3 The sleeve decision (the one controllable lever)

| Phase | Standing (from the watch) | Action |
|---|---|---|
| **Rounds 1–2** | any | **HOLD the sleeve.** Survive, let the core run, preserve the one-shot. |
| **Round 3 (endgame)** | clearing the Top-100 line | **HOLD** — you'll make the finals; save the sleeve for the #1 push. |
| **Round 3 (endgame)** | BELOW the Top-100 line | **DEPLOY** — the core won't close the gap; the endgame sleeve fires automatically (driven by `COMP_CUT_MS`) to climb into the finals. |
| **Finals** | in a prize slot (top of field) | **HOLD / lock in** — protect the slot; swinging is dominated. |
| **Finals** | mid / lagging | **DEPLOY** — swing for #1; nothing to lose on rank. |

- **Before deploying**, run `sleeveWhatIf` against the live standing to see the win/lose → rank spread (so you commit with the magnitude in front of you).
- **Sizing is automatic and non-overridable**: liquidation-safe (`maxSafeLeverage` over the relevant horizon) + ring-fenced (a total sleeve loss can't red-line the core). **Never hand-size the sleeve to risk forced liquidation** — that's elimination (§14), the one unrecoverable error.

### 9.4 When to hit the manual kill-switch (`touch $COMP_FLATTEN_FLAG`)
The automatic margin breaker handles the *survival* case. Use the **manual** flatten for judgment calls the breaker won't catch:
- anomalous book behavior / a suspected bug or fat-finger,
- bridge/terminal instability you can't quickly resolve (flatten to a safe state, then debug),
- a `MARGIN_PRESSURE` alert that isn't self-resolving and you want to de-risk *now*,
- end-of-round housekeeping if you want to go flat into an audit window.
Remove the flag to resume. The book reconciles back to target on the next cycle.

### 9.5 Monitoring cadence
- **Continuous, hands-off:** `tail -f $COMP_ALERT_PATH` — act only on alerts.
- **Active checks:** at each round boundary (22:00 nightly) and through the Round-3 **endgame** (the decisive cut) — read the standing watch, update the field calibration, make the sleeve call.
- **Finals:** blind — rely on `/account`, `/positions`, the standing watch (own equity only), and the alert log.

### 9.6 The non-negotiables (never override)
1. **Never risk forced liquidation** — it's instant elimination, the only unrecoverable error.
2. **Both guards off** is the resting state; arm only deliberately.
3. **Don't swap the core to AGGRESSIVE** — the ring-fenced sleeve is the only sanctioned return-gamble.
4. **The sleeve is one-shot** — once the reserve is spent, it's gone; deploy at the *decisive* moment (Round-3 endgame if below the cut, or the finals), not on noise.
