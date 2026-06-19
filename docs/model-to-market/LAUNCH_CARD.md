# Launch Card — Model to Market (at-the-keyboard, 21 Jun 22:00 BST)

The one-page, copy-paste launch sequence. Full detail in `OPERATIONS.md`; decision logic in `OPERATIONS.md §9`.
**Resting state = both guards OFF.** Arm only deliberately, at go-live.

Launch timestamps (epoch-ms, pre-computed — BST = UTC+1):
- **LAUNCH** 21 Jun 22:00 → `1782075600000`
- **`COMP_CUT_MS`** (Top-100 cut, 24 Jun 22:00) → `1782334800000`
- **`COMP_DEADLINE_MS`** (close, 26 Jun 22:00) → `1782507600000`

---

## A. Before 22:00 — stage + USE THE SETUP WINDOW (live data + test account, trading disabled)
> Duncan (Discord): tonight you get **live market data + a test account for connectivity/validation**, but **trading is NOT enabled until the competition starts (22:00)**. So the decisive spread read happens HERE, read-only, before any arming pressure.
1. **Windows box** up, clock synced to BST; **MT5 *desktop* terminal** installed + logged into the test account. **MT5 desktop client only** (the `MetaTrader5` Python package is Windows-only — fine, Gordon runs on Windows). Add account: File → Login to Trade Account → **Login = your account ID**, password, **Server = `3.11.134.149:443`** (the Syphonix MT5 server — NOT the default `MetaQuotes-Demo`, which is why connections fail). Green bottom-right = data feed up; error `10026` on a test order = trading disabled (expected pre-launch).
2. **Console** (`https://quanthack.syphonix.com/` → Console): **select & confirm the trading channel — MT5** → the $1M funds after this. **This is irreversible and the selection window closes 17:00 on the 19th** (MT5 is the default if unset). MT5 is *mandatory* for us: the **AI-Native channel has no API / no key creation / no agent customization** (organizer-confirmed) — it cannot drive Gordon.
3. **Sidecar deps**: `pip install -r scripts/mt5-bridge/requirements.txt` (first time).
4. **Sidecar env set** (account creds live here ONLY — never in Gordon): `MT5_LOGIN` (=account ID) / `MT5_PASSWORD` / `MT5_SERVER` (=`3.11.134.149:443`), `MT5_BRIDGE_TOKEN`. Leave `MT5_BRIDGE_ALLOW_TRADING` **unset** (validate-only).
5. **`mkdir -p .gordon`** (state + kill-flag + peer-returns live here; already gitignored).
6. **Validate READ-ONLY against the live setup data** (this is the high-value pre-work):
   ```
   bun run scripts/competition/preflight.ts                  # expect READY
   bun run scripts/dev/mt5/mt5-smoke.ts                      # account + quote + L2 depth + specs
   bun run scripts/dev/mt5/competition-spread-check.ts       # ← THE DECISIVE READ, now before 22:00
   ```
   Record the spread verdict → it sets the §9.1 posture (frozen core vs wide-crypto/prune) calmly, not under the clock.
7. **Dry-run rehearsal** for muscle memory (safe — in-process sim, never the bridge):
   ```
   bun run scripts/competition/rehearsals/barbell-rehearsal.ts      # money-path + survival
   bun run scripts/competition/rehearsals/sleeve-timing-rehearsal.ts # sleeve gating
   ```

## B. At/after 22:00 — connect → validate → arm
```sh
# 1. Start the sidecar (guard #1 still OFF — validate-only)
python scripts/mt5-bridge/mt5_bridge.py

# 2. PREFLIGHT (read-only) — expect READY (critical checks pass, guards off)
bun run scripts/competition/preflight.ts

# 3. Transport smoke + the decisive spread read
bun run scripts/dev/mt5/mt5-smoke.ts
bun run scripts/dev/mt5/competition-spread-check.ts     # record the verdict → drives §9.1

# 4. ARM both guards (deliberate): MT5_BRIDGE_ALLOW_TRADING=1 on the sidecar (restart it),
#    then re-run preflight → expect GO.

# 5. START the live runner (the env below) — barbell core is the default posture
export COMP_STARTING_EQUITY=1000000
export COMP_CUT_MS=1782334800000
export COMP_DEADLINE_MS=1782507600000
export COMP_STATE_PATH=.gordon/comp-state.json
export COMP_FLATTEN_FLAG=.gordon/FLATTEN
export COMP_ALERT_PATH=.gordon/comp-alerts.log
export COMP_PEER_RETURNS_PATH=.gordon/peer-returns.json   # empty [] now → endgame gated (safe)
export GORDON_LIVE_TRADING=1                              # guard #2
bun run scripts/competition/live-runner.ts
```

## C. Monitor (second terminal, read-only)
```sh
COMP_STARTING_EQUITY=1000000 COMP_CUT_MS=1782334800000 COMP_DEADLINE_MS=1782507600000 \
  bun run scripts/competition/standing-watch.ts
tail -f .gordon/comp-alerts.log
```

## D. Kill / flatten (fastest first)
- **Flatten now (no restart):** `touch .gordon/FLATTEN`  ·  resume: `rm .gordon/FLATTEN`
- Disarm Gordon: unset `GORDON_LIVE_TRADING`, restart runner.
- Hard stop: `MT5_BRIDGE_ALLOW_TRADING=0`, restart the sidecar.

## E. Round 3 endgame (24 Jun, before the cut) — arm the sleeve on REAL data
- Paste the leaderboard's peer **return fractions** into `.gordon/peer-returns.json` as a JSON array, e.g. `[0.021, -0.08, 0.15, ...]`, and keep it refreshed.
- That calibrates the standing to real rank and **arms the endgame sleeve** if we're below the Top-100 line. Empty/absent ⇒ endgame stays gated (finals-only). See `OPERATIONS.md §9.3`.
- Posture is `COMPETITION_RISK_SURVIVAL` (frozen). Only consider the wide RV candidate AFTER the spread check, via `COMP_RV_PROFILE=wide-crypto` — and re-validate on 18-mo data before trusting it (§9.1).

## Non-negotiables
1. Never risk forced liquidation (30% stop-out = elimination). 2. Both guards off = resting state. 3. The sleeve is one-shot — deploy only at the decisive moment.
