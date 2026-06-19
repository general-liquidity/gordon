# Gordon — Live-Week Operations Runbook (Model to Market)

**The 24/7 operations runbook + decision playbook for the Model to Market live trading week.** Last updated **2026-06-19**.

This is the operational companion to:
- `docs/model-to-market/COMPETITION_BRIEF.md` — the single competition reference (schedule, scoring, rules).
- `docs/model-to-market/COMPETITION_ARCHITECTURE.md` — Gordon's system design.
- `momq-python/README.md` — the primary Python-native live product + operator commands.
- `scripts/mt5-bridge/README.md` — legacy TS fallback sidecar setup + endpoints.

Scope: how to bring Gordon up for the live window, keep it healthy 24/7, watch the live risk limits, and kill it fast. **Operational only — no strategy tuning here.**

---

## 1. Topology — one always-on Windows machine

The `MetaTrader5` Python package is **Windows-only** and talks to a **locally-running MT5 terminal**. Northflank (the $100 credit) is **Linux** and therefore **cannot host the MT5 terminal**. The primary live path is now **`momq-python`**, a single native Python process next to MT5. The TS bridge path remains a fallback/reference oracle, not the preferred launch path.

```
Windows VPS (always-on)
├─ 1. MetaTrader 5 terminal      ── logged into the Syphonix competition account
└─ 2. MOMQ native runner         ── momq-python/run.py
       └─ Mt5Client (MetaTrader5 Python package) ──IPC──► terminal
```

Data path:

```
MOMQ (Python) ──MetaTrader5 pkg──► MT5 terminal ──► Syphonix per-account sim
```

**Northflank hosts only non-MT5 services** — dashboards, data collection, auxiliary tooling. It must **never** run the MT5 terminal or the live trade loop. Keep the money path on the Windows box.

Fallback only: the old Bun runner can still use `scripts/mt5-bridge/mt5_bridge.py` + `Mt5BridgeClient` if the Python-native runner is unavailable.

---

## 2. The double safety guard (defense-in-depth)

**Orders fire only when BOTH guards are deliberately set.** In the native runner both guards are checked in-process; in the TS fallback they sit across Gordon + sidecar.

| Guard | Where | Owner | Effect when set | Effect when unset |
|---|---|---|---|---|
| `MT5_BRIDGE_ALLOW_TRADING=1` | native `Mt5Client` env (or sidecar fallback) | MT5 transport | `order_send` is allowed after validation | trading calls are refused with `guard="trading-disabled"` |
| `GORDON_LIVE_TRADING=1` | MOMQ live runner env | the live trader | the loop/probe may submit real orders | the loop reads/validates/sizes only — never submits |

**If either is unset, no real order is placed.** `GORDON_LIVE_TRADING` arms the strategy process; `MT5_BRIDGE_ALLOW_TRADING` is the final MT5 transport guard. The variable name is kept for compatibility with the TS sidecar, but in `momq-python` it is enforced by the native client.

This is **intentional defense-in-depth**, mirroring Gordon's deny-first permission philosophy: two processes, two operators-worth of intent, both required to move capital. The default for both is **off** — a fresh run reads state and price-checks orders but cannot trade. Arm both **only at go-live** (Section 8).

> Note the smoke/preflight checks confirm this: `Mt5OrderResult.guard` is populated ("trading-disabled") when the transport guard blocks, and `health.trading_enabled` reports the guard state.

---

## 3. Environment configuration

**Credential boundary (important):** in the primary native path the MT5 **account** credentials live in the local Windows process env for `momq-python` only. Do not put them in docs, commits, dashboards, or hosted Linux services.

### Native MT5 env — holds the account creds

| Var | Purpose |
|---|---|
| `MT5_LOGIN` | competition account number (optional if the terminal is already logged in) |
| `MT5_PASSWORD` | account password |
| `MT5_SERVER` | broker server name (the Syphonix MT5 server) |
| `MT5_TERMINAL_PATH` | path to `terminal64.exe` (optional; auto-detected if running) |
| `MT5_BRIDGE_ALLOW_TRADING` | **`1` to actually fire orders** — guard #1 (Section 2) |

### MOMQ live-runner env

| Setting | Value |
|---|---|
| `GORDON_LIVE_TRADING` | **`1` to submit real orders** — guard #2 (Section 2) |

### Competition env (the live-runner reads these) — set at launch

| Var | Purpose |
|---|---|
| `COMP_STARTING_EQUITY` | the §12 baseline (set **`1000000`** explicitly — return is scored off the fixed $1M, not current equity) |
| `COMP_CUT_MS` | epoch-ms of the **Top-100 finals cut** (24 Jun 22:00 BST). Drives the phase gate AND the **pre-finals endgame sleeve** + the standing readout. |
| `COMP_DEADLINE_MS` | epoch-ms of the **contest end** (26 Jun 22:00 BST). Drives the liquidation horizon. |
| `COMP_STATE_PATH` | file path for **restart-safe** equity/risk history + RV hysteresis state (e.g. `.gordon/comp-state.json`) — survive a process restart without losing the standing/Sharpe history or low-churn pair holds |
| `COMP_FLATTEN_FLAG` | path to the **kill-switch flag file** — `touch` it to flatten the whole book, `rm` it to resume (Section 7) |
| `COMP_ALERT_PATH` | file the **critical-event alerts** append to (default `comp-alerts.log`) — `tail -f` it so you're not tied to the screen 24/7 |
| `COMP_FIELD_N` / `COMP_CUT_PCT` | field size (default 500) + cut percentile (default 0.8) for the standing's rank estimates |
| `COMP_PEER_RETURNS_PATH` | JSON file of peer return fractions from the leaderboard (operator-maintained). Calibrates the standing to **real** rank and **arms the Round-3 endgame sleeve**; absent ⇒ endgame gated off (§9.2) |
| `COMP_RV_PROFILE` | optional RV core profile: `default` (frozen config), `wide` (17 Jun low-churn candidate), or `wide-crypto` (same candidate, crypto-only pairs). Use only after the spread check / soak. |
| `COMP_RV_LOOKBACK` / `COMP_RV_ENTRY_Z` / `COMP_RV_EXIT_Z` / `COMP_RV_MAX_PAIRS` / `COMP_RV_PER_PAIR_FRACTION` / `COMP_RV_CLUSTERS` | optional explicit RV overrides (`COMP_RV_CLUSTERS=all|crypto`) for controlled live/dry experiments; leave unset unless intentionally testing. |
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
2. **Python env** — install the native product once:
   ```
   cd momq-python
   pip install -e '.[mt5,halo]'
   ```
   At go-live, the native env includes `MT5_BRIDGE_ALLOW_TRADING=1` (guard #1).
3. **Preflight (READY -> GO)** — one read-only command runs every readiness check (MT5 health, account, contract specs for all 15, spread sanity, guard state):
   ```
   python momq-python/scripts/preflight.py
   ```
   Two phases: run it **before arming** -> expect critical checks pass with guards intentionally off. After arming both guards (Section 8), re-run. **NO-GO** = a genuine critical blocker (bad MT5 / missing specs). Wide spreads are posture input, not an infrastructure failure.
4. **Smoke test** — verify the native MT5 transport against the real account:
   ```
   python momq-python/scripts/smoke.py BTCUSD      # account + quote + L2 depth + bars + symbol spec
   ```
   This is read-only.
5. **Spread check (the decisive read)** — the single biggest live unknown: real spreads decide whether the book is net-positive or the ~0 relative-rank play. Run the moment the feed is on:
   ```
   python momq-python/scripts/spread_check.py
   ```
   Verdict GOOD (<2bps) / MARGINAL / POOR per instrument vs the empirical break-even. Record it — it feeds the Decision Playbook (Section 9).
6. **Live runner** — set the competition env (Section 3) + `GORDON_LIVE_TRADING=1` (guard #2), then:
   ```
   COMP_STARTING_EQUITY=1000000 COMP_CUT_MS=... COMP_DEADLINE_MS=... \
   COMP_STATE_PATH=.gordon/comp-state.json COMP_FLATTEN_FLAG=.gordon/FLATTEN \
   GORDON_LIVE_TRADING=1 python momq-python/run.py
   ```
   The runner: discrete-hysteresis RV core → depth-aware reconcile → fills (slippage tracked) → the **automatic margin breaker** + **standing monitor** each cycle. It logs the live standing + any alerts every cycle.
7. **Standing watch (read-only dashboard)** — in a second terminal, monitor the standing WITHOUT arming trading:
   ```
   COMP_STARTING_EQUITY=1000000 COMP_CUT_MS=... COMP_DEADLINE_MS=... \
   COMP_STATE_PATH=.gordon/comp-state.json COMP_PEER_RETURNS_PATH=.gordon/peer-returns.json \
   python momq-python/scripts/standing_watch.py
   ```
   And `tail -f comp-alerts.log` (or `$COMP_ALERT_PATH`) for critical-event alerts.
8. **Maker fill probe (live Round 1 only, tiny and guarded)** — after the book is stable, measure whether resting limits actually fill and whether adverse selection is acceptable:
   ```
   PROBE_SYMBOLS=BTCUSD,ETHUSD PROBE_CYCLES=5 PROBE_WAIT_S=60 \
   GORDON_LIVE_TRADING=1 python momq-python/scripts/maker_probe.py
   ```
   Switch `COMP_EXECUTION=maker` only if the probe shows useful fill rate and non-negative adverse selection.

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

**These are enforced in code, not just watched.** The selected live path is the barbell runner, not the legacy single-leg `liveTrader` path. Its risk controls are: low per-pair RV sizing, taker spread gates, depth clamping, ring-fenced one-shot sleeve, peer-board-gated endgame sleeve, the whole-book margin breaker, and the manual flatten flag. The old `COMPETITION_RISK_SURVIVAL` constants remain as the posture reference/parity object, but the native barbell runner sizes through `COMP_RV_*`, `BarbellConfig`, and the ring fence rather than `sizeCompetitionTrade`.

Every live ceiling sits **well under** the §13 thresholds (leverage < 28×, margin < 90%, single-instrument < 90%, net-directional < 95%). The non-negotiable hard guard is the native margin circuit breaker: flatten the whole book before margin can approach the 30% stop-out.

---

## 6. Reconnect, heartbeat & monitoring (24/7)

The live runner's loop is **reconnect-tolerant by design** — wrapped in try/catch so a transient terminal hiccup never throws the loop dead; it logs, backs off, and retries on the next tick. The native `Mt5Client` surfaces clear `Mt5ClientError` failures when the terminal/feed cannot satisfy a read.

> **DISCONNECT = NO SAFETY NET (Duncan, confirmed):** if the MT5 terminal disconnects, **open positions REMAIN OPEN — there is no auto-flattening on a client-side disconnect.** So while we're disconnected our **survival breaker cannot run**, and margin can drift toward the 30% stop-out (= elimination) unattended. Connection uptime is survival-critical. Run the box on stable power/network, keep the terminal logged in, and treat any prolonged MT5 read failure as a P0 — reconnect FAST, and if you can't, flatten from the MT5 terminal UI or another machine before margin runs down. The breaker only protects us *while connected*.

Monitoring checklist (run continuously):

- **Native health** — `python momq-python/scripts/preflight.py` reports MT5 health, account, feed, specs, spreads, and `trading_enabled`.
- **Account state** — the runner/watch read `account_info` (equity / balance / margin / free margin / **margin_level**). Watch `margin_level` as the early-warning for the forced-liquidation red line.
- **Positions / orders** — the runner reads native `positions_get` / `orders_get` to reconcile what's open vs. what the strategy targets.
- **Logfire traces** — with `LOGFIRE_TOKEN` set, agent/tool traces export for live observability.
- **Real-time leaderboard** — during Rounds 1–3 the platform shows a near-real-time leaderboard + peer logs + risk metrics at ~5-minute latency. **Finals (after 24 Jun) are blinded** — you see only your own account, so rely on `/account`, `/positions`, and Logfire then.
- **Terminal liveness** — keep the MT5 terminal logged in; if the feed stops ticking (bid/ask 0), positions still need managing but new sizing is starved. The smoke test flags a dead feed explicitly.
- **Live standing** — the runner and `python momq-python/scripts/standing_watch.py` print our §11–17 standing every cycle: Return / 15-min Sharpe / max-DD / risk-discipline + estimated rank, stance, and whether the sleeve would arm. This is the primary decision surface (Section 9). Realized **slippage** is logged too — watch it vs the spread-check baseline.
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
3. **Stop the live runner** — kill the process. The MT5 terminal keeps running so you retain manual read/close access. (The `COMP_STATE_PATH` state is preserved — a restart resumes the standing and RV hysteresis holds.)
4. **Disarm the transport guard (guard #1)** — unset `MT5_BRIDGE_ALLOW_TRADING` and restart the native runner before any further automation. In the TS fallback, this means restart `mt5_bridge.py` with the guard unset.

To **flatten** via the venue directly: close in the MT5 UI (or native client close tooling) **then** disarm.

> Resting safe state: both guards unset. The flag-file flatten is the everyday panic-button; the transport guard is the hard stop.

---

## 8. Pre-launch checklist

Run this immediately before **21 Jun 22:00 BST**. Arm the two guards **only at this point** — they are off until go-live.

- [ ] **Windows box up** — always-on Windows machine/VPS confirmed reachable; clock synced to BST.
- [ ] **Trading channel selected + account funded** — in the console (`https://quanthack.syphonix.com/` → Console), **select & confirm the trading channel (MT5)**; the $1M is funded only after this (Lotus, Discord). The live competition MT5 connection opens at the **21 Jun 22:00 launch** — have the box + native runner staged to connect -> preflight -> arm the instant it's live.
- [ ] **MT5 terminal** logged into the competition account; live feed ticking (not bid/ask 0).
- [ ] **Account creds local only** — `MT5_LOGIN` / `MT5_PASSWORD` / `MT5_SERVER` set in the Windows native runtime env; **not** present in docs, commits, hosted services, or dashboards.
- [ ] **Preflight green** — `python momq-python/scripts/preflight.py` passes pre-arm and after arming both guards.
- [ ] **State dir created** — `mkdir -p .gordon` (holds `comp-state.json` with equity/risk/RV-state + the `FLATTEN` kill-flag; the runner also auto-creates it, but make it explicitly).
- [ ] **Smoke test green** — `python momq-python/scripts/smoke.py BTCUSD` passes (account + quote + depth + bars + symbol spec).
- [ ] **Spread check recorded** — `python momq-python/scripts/spread_check.py` run + verdict noted (drives the §9.1 posture).
- [ ] **The final 15-symbol competition universe matches the live catalog** + per-instrument contract specs / tick size / spreads confirmed at login. Symbols are resolved from the venue catalog at runtime, never hardcoded.
- [ ] **Competition env set** — `COMP_STARTING_EQUITY=1000000`, `COMP_CUT_MS` (24 Jun 22:00 BST), `COMP_DEADLINE_MS` (26 Jun 22:00 BST), `COMP_STATE_PATH`, `COMP_FLATTEN_FLAG`, `COMP_ALERT_PATH` (Section 3).
- [ ] **Risk preset confirmed** — `COMPETITION_RISK_SURVIVAL` (frozen default); ceilings under §13. Swap to `AGGRESSIVE` never — the ring-fenced sleeve is the only sanctioned return-gamble.
- [ ] **Standing watch + alert tail running** — `python momq-python/scripts/standing_watch.py` in a second terminal; `tail -f $COMP_ALERT_PATH`.
- [ ] **Optional perks** — `LOGFIRE_TOKEN` for tracing; `DOUBLEWORD_API_KEY` if used.
- [ ] **Both guards set — deliberately, at go-live** — `MT5_BRIDGE_ALLOW_TRADING=1` (native MT5 client transport guard) **and** `GORDON_LIVE_TRADING=1` (runner). Until both are `1`, the stack is validate-only.
- [ ] **Maker probe ready** — `python momq-python/scripts/maker_probe.py` dry-runs pre-launch; live tiny-fill probe is reserved for Round 1 after arming.
- [ ] **Sleeve what-if ready** — `python momq-python/scripts/sleeve_what_if.py --state .gordon/comp-state.json --symbol SOLUSD` works once state exists.
- [ ] **Kill switch rehearsed** — Section 7 confirmed: the flag-file flatten (`touch $COMP_FLATTEN_FLAG`) flattens + resumes, and the disarm/stop/transport-guard escalation works, before capital is live.
- [ ] **Decision Playbook (Section 9) reviewed** — the sleeve decision table + non-negotiables are pre-committed.

> Resting safe state between sessions / after the close: **both guards unset.** The stack then reads and validates but cannot move capital.

---

## 9. Decision Playbook — pre-committed judgment (decide NOW, not at 2am)

The finals are **blind** and the window is 5 days; the judgment calls must be pre-decided so execution under pressure is mechanical. The honest frame: **return (70% weight) is a variance lottery we can't earn** — the smooth surviving book banks the controllable ~25–30% (Drawdown + Sharpe + Risk-Discipline ranks) for free, and the **one-shot sleeve is the only lever on return**. Critically, the standing monitor showed a median-return smooth book lands ~mid-field and **does not clear the Top-100 finals cut on its own** (clearing it needs return in roughly the top ~29%). So the sleeve is likely *necessary to reach the finals*, not just to win them — but only deploy it on **real** standing data.

### 9.1 Launch read → posture (do once, when the feed opens)
- **Run the spread check** (Section 4 step 5). Record per-instrument bps.
  - Crypto majors **< ~2 bps** → the RV book is plausibly **net-positive**; the latest sweep says a more active book can work, but do not hot-swap on one quote — run the conservative discrete core through a live soak first.
  - **Wide (> ~4 bps)** -> cost is binding. The 17 Jun 1-month sweep favored the **low-churn discrete RV candidate** (`lookback 96`, `entryZ 2.5`, `exitZ 0.75`, `maxPairs 11`), but the extended M15 crypto check is the better launch proxy: at 5bps/side and 0.5%/pair, 32 configs cleared full-period DD `<5%` and estimated 30+ trades over five days. The trade-floor-safe robust setting was `COMP_RV_PER_PAIR_FRACTION=0.005 COMP_RV_LOOKBACK=144 COMP_RV_ENTRY_Z=2.0 COMP_RV_EXIT_Z=0 COMP_RV_MAX_PAIRS=11` (`COMP_RV_CLUSTERS=crypto` if dropping metals). **NB:** keep the frozen default unless the live spread check / dry soak confirms the smaller wide-spread posture; do not hot-swap on the 1-month numbers alone.
- **Confirm the survive-and-rank preset** (`COMPETITION_RISK_SURVIVAL`) — do NOT swap to AGGRESSIVE for the core; the sanctioned return-gamble is the *sleeve*, ring-fenced.

### 9.2 Calibrate the field (once Round-1/2 peer data is visible) — and ARM the endgame sleeve
- Rounds 1–3 expose peer returns at 5-min latency (§8). **Write those peer return fractions into `$COMP_PEER_RETURNS_PATH`** as a JSON array (e.g. `[0.021, -0.08, 0.15, ...]`) and keep it refreshed. The live runner reads it each cycle, calibrates the field via `standingFieldCalibrator`, and uses it for BOTH the standing readout and the sleeve decision — so **the rank and the clears-cut call become real, not modeled**, and the **endgame sleeve becomes armed**.
- **This file is the switch for the Round-3 endgame sleeve.** No file ⇒ the runner keeps the placeholder model and the endgame stays gated OFF (finals-only) — a deliberate safety default so the one-shot never auto-deploys on a guess. Populate it before the Round-3 endgame.

### 9.3 The sleeve decision (the one controllable lever)

| Phase | Standing (from the watch) | Action |
|---|---|---|
| **Rounds 1–2** | any | **HOLD the sleeve.** Survive, let the core run, preserve the one-shot. |
| **Round 3 (endgame)** | clearing the Top-100 line | **HOLD** — you'll make the finals; save the sleeve for the #1 push. |
| **Round 3 (endgame)** | BELOW the Top-100 line | **DEPLOY** — the core won't close the gap. The endgame sleeve auto-fires **only when the peer-return board (`$COMP_PEER_RETURNS_PATH`) is wired** (it calibrates the standing to real rank); **without it the endgame is gated OFF** (finals-only) and clearing the cut is a manual call — so in Round 3, keep that file populated from the leaderboard (§9.2). |
| **Finals** | in a prize slot (top of field) | **HOLD / lock in** — protect the slot; swinging is dominated. |
| **Finals** | mid / lagging | **DEPLOY** — swing for #1; nothing to lose on rank. |

- **Before deploying**, run `python momq-python/scripts/sleeve_what_if.py --state .gordon/comp-state.json --symbol SOLUSD` against the live standing to see the win/lose -> rank spread (so you commit with the magnitude in front of you).
- **Sizing is automatic and non-overridable**: liquidation-safe (`maxSafeLeverage` over the relevant horizon) + ring-fenced (a total sleeve loss can't red-line the core). **Never hand-size the sleeve to risk forced liquidation** — that's elimination (§14), the one unrecoverable error.

### 9.4 When to hit the manual kill-switch (`touch $COMP_FLATTEN_FLAG`)
The automatic margin breaker handles the *survival* case. Use the **manual** flatten for judgment calls the breaker won't catch:
- anomalous book behavior / a suspected bug or fat-finger,
- MT5 terminal instability you can't quickly resolve (flatten to a safe state, then debug),
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
