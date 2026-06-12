# P2 — Boot composition: GORDON banner + merged preflight panel (Items 14–15)

Locked operator decisions (do not relitigate): hybrid screen model (chat inline, no alt-buffer at boot); banner on EVERY launch; one merged Codex-style session panel + trading preflight under the banner. The boot moment paints the full initial viewport with content only — no `?1049`.

Shared architecture for both items: the existing `printBootCard()` (src/tui/index.tsx:165–250) prints raw ANSI to stdout BEFORE Ink mounts, gated by `process.stdout.isTTY` (src/tui/index.tsx:18–21). This spec EXTENDS that approach: a pre-Ink static block (banner + static rows) printed by pure string-building functions, plus an Ink-rendered live block (`BootLivePanel`) that mounts directly below where the pre-Ink output ended, so the user perceives ONE composition. Live rows hydrate post-mount; the static rows scroll into terminal history with the chat, exactly like today's boot card.

Suppression: non-TTY/CI is already covered by the `isTTY` gate. ACP and headless modes never reach `startGordonTUI` at all — ACP has its own entry (`src/app/acp-entry.ts`, served by `src/infra/acp/server.ts`), and `--headless` routes to `runHeadlessAndPrint` in `src/index.tsx` (line ~67) before the TUI launch at `src/index.tsx:340`. No new detection code is needed; do not add any.

---

### Item 14 — Block-glyph GORDON banner (S, P2)

**Current state:** `printBootCard()` at src/tui/index.tsx:165–250 prints a bordered info card with a small `≫ Gordon CLI (v0.9)` header — no logo. Teal is hand-written as `\x1b[38;2;52;238;176m` (src/tui/index.tsx:174) to match `GordonHeader`'s `rgb(52,238,176)` (src/tui/components/layout/GordonHeader.tsx:27). Version derivation (strip pre-release suffix) at src/tui/index.tsx:166–168. The Hermes width-responsive pattern lives at agents/hermes-agent-main/hermes-agent-main/ui-tui/src/banner.ts (LOGO_ART + LOGO_WIDTH) and components/branding.tsx:42–59 (`cols >= LOGO_WIDTH ? <ArtLines/> : compact wordmark`) — copy the PATTERN (width check → full art / wordmark fallback), not the code.

**Problem:** Gordon has zero product presence at launch — the boot moment is the one guaranteed impression every session, and right now it reads like a config dump. The banner is the identity moment for a vibe-trading product.

**Spec:**

CREATE `src/tui/boot/banner.ts` — pure, no I/O, raw-ANSI string builders (testable without a TTY):

```ts
/** 6-line ANSI-Shadow GORDON. Every line is exactly LOGO_WIDTH visible chars. */
export const GORDON_LOGO: readonly string[];
export const LOGO_WIDTH = 53;
/** Minimum terminal columns for the full logo (logo + 2-col left margin + slack). */
export const FULL_LOGO_MIN_COLUMNS = 60;

export interface BannerOptions {
  columns: number;   // process.stdout.columns ?? 120
  version: string;   // already pre-release-stripped
}
/** Raw-ANSI lines, no trailing newline. Caller joins with "\n". */
export function renderBanner(opts: BannerOptions): string[];
```

The logo, verbatim (this exact art ships in `GORDON_LOGO` — 6 lines, 53 columns each):

```
 ██████╗  ██████╗ ██████╗ ██████╗  ██████╗ ███╗   ██╗
██╔════╝ ██╔═══██╗██╔══██╗██╔══██╗██╔═══██╗████╗  ██║
██║  ███╗██║   ██║██████╔╝██║  ██║██║   ██║██╔██╗ ██║
██║   ██║██║   ██║██╔══██╗██║  ██║██║   ██║██║╚██╗██║
╚██████╔╝╚██████╔╝██║  ██║██████╔╝╚██████╔╝██║ ╚████║
 ╚═════╝  ╚═════╝ ╚═╝  ╚═╝╚═════╝  ╚═════╝ ╚═╝  ╚═══╝
```

Behavior of `renderBanner`:
- `columns >= FULL_LOGO_MIN_COLUMNS`: the 6 logo lines, each prefixed with one space of left margin, colored teal `\x1b[38;2;52;238;176m` + reset per line (single solid color — Gordon is monochrome-teal, not the Hermes gradient). Followed by one tagline line:
  `  v{version} · The Frontier Trading Agent · General Liquidity, Inc.` — version in bold teal, the rest dim (`\x1b[2m`).
- `columns < FULL_LOGO_MIN_COLUMNS`: compact wordmark, two lines:
  `  ≫ GORDON  v{version}` (teal bold `≫` + bold `GORDON`, dim version) and
  `  The Frontier Trading Agent · General Liquidity, Inc.` (dim). If even that overflows, truncate the tagline with `…` — never wrap.
- Returns `[]` for `columns <= 0` (defensive; callers shouldn't hit it).

Visual (≥60 cols):

```
  ██████╗  ██████╗ ██████╗ ██████╗  ██████╗ ███╗   ██╗
 ██╔════╝ ██╔═══██╗██╔══██╗██╔══██╗██╔═══██╗████╗  ██║
 ██║  ███╗██║   ██║██████╔╝██║  ██║██║   ██║██╔██╗ ██║
 ██║   ██║██║   ██║██╔══██╗██║  ██║██║   ██║██║╚██╗██║
 ╚██████╔╝╚██████╔╝██║  ██║██████╔╝╚██████╔╝██║ ╚████║
  ╚═════╝  ╚═════╝ ╚═╝  ╚═╝╚═════╝  ╚═════╝ ╚═╝  ╚═══╝
  v0.9 · The Frontier Trading Agent · General Liquidity, Inc.
```

EDIT `src/tui/index.tsx` — inside the existing `if (process.stdout.isTTY)` block (currently lines 18–21), call `renderBanner({ columns: process.stdout.columns ?? 120, version })` and write the joined lines before the panel (Item 15 wires the rest). The screen-clear `\x1b[2J\x1b[H` write stays first.

**Files:**
- CREATE `src/tui/boot/banner.ts` (logo art + width-responsive renderer)
- CREATE `src/tui/boot/banner.test.ts` (see test plan)
- EDIT `src/tui/index.tsx` (call `renderBanner` inside the existing isTTY block; import with `.ts` extension)

**Acceptance criteria:**
1. `bun test src/tui/boot/banner.test.ts` passes.
2. `bun tsc --noEmit -p tsconfig.json` is clean.
3. Run `bun run src/index.tsx` in a terminal ≥60 cols: the 6-line block logo renders in teal with the tagline beneath, before the panel.
4. Resize the terminal below 60 cols and relaunch: the 2-line compact wordmark renders instead; no logo line wraps.
5. `bun run src/index.tsx --headless "noop" 2>&1 | findstr "██"` produces no output (banner never printed in headless), and piping stdout (non-TTY) prints no banner.

**Test plan:** `src/tui/boot/banner.test.ts` (bun:test, co-located):
- every `GORDON_LOGO` line has visible length exactly `LOGO_WIDTH` (strip ANSI with `/\x1b\[[0-9;]*m/g` — same regex as `vlen` at src/tui/index.tsx:213);
- `renderBanner({ columns: 80 })` returns 7 lines (6 logo + tagline), each containing the teal escape `38;2;52;238;176` and ending with `\x1b[0m`;
- `renderBanner({ columns: 59 })` returns the compact wordmark (2 lines, contains `≫ GORDON`, no `██`);
- boundary: `columns: 60` → full logo; `columns: 0` → `[]`;
- version appears verbatim in both variants.

**Gotchas:**
- Raw ANSI only — no Ink, no chalk in `src/tui/boot/`. This code runs before React exists.
- The box-drawing glyphs (`█ ╗ ║ ╔ ╝ ╚ ═`) are all single-cell wide; do NOT add emoji or double-width chars to the banner (cell-width math breaks the framebuffer renderer's diffing assumptions elsewhere).
- Keep the teal literal `\x1b[38;2;52;238;176m` byte-identical to src/tui/index.tsx:174 — it is the brand color anchor matching `GordonHeader`'s `rgb(52,238,176)`.
- `.ts` extensions on relative imports (Bun convention).
- Do this item before Item 15 — Item 15's composition module imports `renderBanner`.

---

### Item 15 — Merged session + preflight panel (M, P2)

**Current state:**
- Boot card: `printBootCard()` src/tui/index.tsx:165–250 — bordered box with model/mode/session/directory rows, mode-colored via `MODE_ANSI` (lines 182–189), plus a rotating tip via `pickTip(TIPS)` (lines 95–163, persists `~/.gordon/tipHistory.json`). Config read synchronously by `readBootConfig()` (lines 40–87: `config.json` → permissionMode+model, `.env` → model fallback, `session.json` → threadId).
- `GordonHeader` (src/tui/components/layout/GordonHeader.tsx) duplicates the same card in Ink but is imported at src/tui/App.tsx:17 and **never mounted** (verified: no `<GordonHeader` JSX anywhere).
- `GordonWelcomeFeed` (src/tui/components/layout/GordonWelcomeFeed.tsx) — the BTC/ETH ticker + tip welcome feed — is built and **never mounted** (verified: zero JSX usages). Empty chat renders nothing above the prompt: src/tui/App.tsx ~1846–1853 renders `VirtualMessageList` only when `messages.length > 0`.
- Verified data sources for the new rows:
  - Guards: `isOutboundFetchGuardInstalled(): OutboundFetchGuardStatus` (src/infra/safety/outboundFetchGuard.ts:28, fields `installed/enabled/mode/warnViolations`), `isFilesystemWriteGuardInstalled(): FilesystemWriteGuardStatus` (src/infra/safety/filesystemWriteGuardInstaller.ts:35). Both synchronous; guards are installed at process entry in src/index.tsx (`installOutboundFetchGuard`/`installFilesystemWriteGuard`), so the accessors are accurate by TUI launch. `/doctor` consumes them the same way (`collectSandboxChecks`, src/app/setup/harness-checks.ts:222).
  - Kill switches: `listTrippedSwitches(): Array<{ key: KillSwitchKey; reason: string; trippedAt: number }>` (src/infra/safety/killSwitches.ts:206) — synchronous, state reloaded from disk at module init.
  - Audit chain: `verifyStoredAuditChain(): AuditChainVerification` (src/core/audit/store.ts:453; type at src/core/audit/signing.ts:132–134: `{ valid: true; checked } | { valid: false; checked; firstBreak }`). **Synchronous and unbounded** over every stored trace — must run post-mount, deferred (see hydration).
  - Radar: `isObserverRunning()` (src/infra/proactive/engine/observer.ts:287); `getProducerHealthTracker().report()` (src/infra/proactive/engine/producerHealth.ts:109, `report().producers.length` = registered producer count — 21 registered in src/infra/proactive/producers/index.ts:127–152); last card via `getSuggestionStore().getRecent(1)[0]?.createdAt` (src/infra/proactive/storage/suggestionStore.ts:64; `createdAt` is ISO string, src/infra/proactive/types.ts:154). All sync. The observer auto-start (if any) happens at src/index.tsx:327–335, before `startGordonTUI()`.
  - Venue + connectivity: config shape from `loadConfig()` (`exchanges[]`, `activeExchangeId`, `brokers[]`); the connectivity probe pattern is `exchangeStatus()` (src/app/commands/exchange.ts:307–366: `ExchangeFactory.create(...)` + `await exchange.testConnection()`).
  - Equity: `adapter.getFullAccountDetails().totalUsdtValue` — the pattern used by `PortfolioContextBuilder.buildFromExchange` (src/core/risk-kernel/portfolio-context.ts:68–72). `ExchangeFactory` at src/infra/exchange/factory.ts.
  - Ticker: `getCoinGeckoClient().getPrices(["BTC","ETH"])` (src/infra/data/providers/coingecko.ts:153) → `Map<string, CoinGeckoPrice>` with `usd` + `usd_24h_change`. Free, keyless, one HTTP call.

**Problem:** The trader's first question every session is "am I safe to trade and what's the market doing?" — today the boot card answers neither, and the empty chat is dead air. This panel is simultaneously the preflight check and the welcome feed.

**Spec:**

The composition has two contiguous sections. Pre-Ink static (printed by `src/tui/index.tsx` right after the banner) and the Ink live block (`BootLivePanel`, rendered at the top of the empty chat). No enclosing box — labeled rows with a 10-char dim label column, so the pre-Ink/Ink seam is invisible. Full target composition (≥60 cols, ask mode, hydrated):

```
  ██████╗  ██████╗ ██████╗ ██████╗  ██████╗ ███╗   ██╗
 ██╔════╝ ██╔═══██╗██╔══██╗██╔══██╗██╔═══██╗████╗  ██║
 ██║  ███╗██║   ██║██████╔╝██║  ██║██║   ██║██╔██╗ ██║
 ██║   ██║██║   ██║██╔══██╗██║  ██║██║   ██║██║╚██╗██║
 ╚██████╔╝╚██████╔╝██║  ██║██████╔╝╚██████╔╝██║ ╚████║
  ╚═════╝  ╚═════╝ ╚═╝  ╚═╝╚═════╝  ╚═════╝ ╚═╝  ╚═══╝
  v0.9 · The Frontier Trading Agent · General Liquidity, Inc.

  model     claude-sonnet-4-6 high              /model to change   ← pre-Ink
  mode      ask                                 /auto to change    ← pre-Ink (mode-colored)
  thread    thr_01HZXK24M9QW                                       ← pre-Ink
  cwd       C:\Users\adria\Downloads\gordon-cli-alpha              ← pre-Ink
  guards    fetch ✓ warn · fs ✓ warn                               ← pre-Ink
  switches  none tripped                                           ← pre-Ink
  radar     21 producers · last card 4m ago                        ← pre-Ink
                                                                   ── seam: Ink frame starts here
  venue     binance (paper) · connected ✓                          ← live
  equity    $12,408.32                                             ← live
  audit     chain ok (1,204 traces)                                ← live
  ──────────────────────────────────────────────────────
  BTC $67,432 +2.3%    ETH $3,521 -0.8%                            ← live ticker
  Tip: Type /scan to discover opportunities across all connected venues.
```

Pre-hydration the live rows read:

```
  venue     binance (paper) · connecting…
  equity    —
  audit     verifying chain…
  ──────────────────────────────────────────────────────
  fetching market data…
  Tip: Type /scan to discover opportunities across all connected venues.
```

Row split rationale (locked by the backlog): static rows = everything answerable synchronously at print time (session, guards, switches, radar snapshot); live rows = everything requiring network or unbounded work (connectivity, equity, audit verify, ticker). Each row lives in exactly one rendering domain — never print a placeholder pre-Ink that later "updates" (it can't; those lines are terminal history).

**1. CREATE `src/tui/boot/tips.ts`** — move `pickTip`, `TIPS`, and the tip-history persistence out of src/tui/index.tsx verbatim (no behavior change), plus a per-process cache so the pre-Ink path and Ink path see the same tip:

```ts
export const TIPS: readonly string[];                       // moved as-is from index.tsx:142–163
export function pickTip(tips: readonly string[]): string;   // moved as-is from index.tsx:95–140
/** Picks once per process, caches. BootLivePanel + boot print share this. */
export function getSessionTip(): string;
```

**2. CREATE `src/tui/boot/bootComposition.ts`** — pure builders for the static block:

```ts
import type { OutboundFetchGuardStatus } from "../../infra/safety/outboundFetchGuard.ts";
import type { FilesystemWriteGuardStatus } from "../../infra/safety/filesystemWriteGuardInstaller.ts";
import type { KillSwitchKey } from "../../infra/safety/killSwitches.ts";

export interface BootStaticInfo {
  version: string;
  model: string;                 // "auto" fallback, per readBootConfig
  effort: string | null;         // process.env.GORDON_EFFORT
  permissionMode: string;
  threadDisplay: string;         // threadId.slice(0, 24) or "new session"
  cwd: string;
  fetchGuard: OutboundFetchGuardStatus;
  fsGuard: FilesystemWriteGuardStatus;
  trippedSwitches: Array<{ key: KillSwitchKey; reason: string; trippedAt: number }>;
  radar: { running: boolean; producerCount: number; lastCardAgeMs: number | null };
}

/** Sync reads only: readBootConfig (moved here from index.tsx) + guard/kill-switch/radar accessors. Never throws. */
export function collectBootStaticInfo(): BootStaticInfo;

/** Raw-ANSI lines for the static rows (banner NOT included — caller composes). */
export function renderBootStaticRows(info: BootStaticInfo, columns: number): string[];
```

Row copy, verbatim:
- `model` value = `model` + (effort ? ` ${effort}` : ``); right hint `/model to change` (dim). Truncate value with `…` exactly like `modelDisplay` (src/tui/index.tsx:222–226).
- `mode` value colored with the existing `MODE_ANSI` map (move it from index.tsx:182–189 into this module). Right hint: paper → `/live to exit`, else `/auto to change`. When mode is `paper`, append loud badge ` [PAPER]` in bold yellow (`\x1b[1m\x1b[33m`) right after the mode word — this is the boot-time half of Item 4; the persistent status-line badge is Item 4's scope, not this one's.
- `thread` value = `threadDisplay`.
- `cwd` value = cwd, left-truncated `…` + tail as `dirDisplay` does (src/tui/index.tsx:228–229).
- `guards` value: per guard `fetch`/`fs` then ` ✓ {mode}` when `installed && enabled` (✓ teal, mode dim — e.g. `fetch ✓ warn`); `✗ off` in yellow when `!enabled`; `✗ NOT INSTALLED` in red when `enabled && !installed` (the inert-policy case `/doctor` flags as error). Join with ` · `.
- `switches` value: empty list → `none tripped` (dim). Non-empty → red bold. If any tripped key has `scope === "firm"` → `HALTED: firm — {reason}` (reason truncated to fit). Else → `tripped: {key list}` where each key renders `scope:id` or bare `scope` (the `keyOf` shape, src/infra/safety/killSwitches.ts:68–70), e.g. `tripped: venue:binance, strategy:s1`.
- `radar` value: `!running` → `off — set GORDON_PROACTIVE_AUTO_START=1 or /radar start` (dim). Running, `lastCardAgeMs === null` → `{n} producers · warming up`. Else `{n} producers · last card {age}` with age formatted `42s` / `4m` / `2h` / `3d` ago — write a tiny `formatAge(ms): string` in this module and export it (BootLivePanel reuses it; grep first — no existing shared helper for this).
- Label column: 2-space indent + label padded to 10 (`model`, `mode`, `thread`, `cwd`, `guards`, `switches`, `radar`), labels dim. Every row truncated so visible length ≤ `columns - 1`; hints dropped first when narrow (< 70 cols), then value truncation. Reuse the `vlen` ANSI-strip approach (move it here as an exported `visibleLength`).

**3. EDIT `src/tui/index.tsx`** — replace `printBootCard()` and its helpers entirely:

```ts
if (process.stdout.isTTY) {
  process.stdout.write("\x1b[2J\x1b[H");
  const columns = process.stdout.columns ?? 120;
  const info = collectBootStaticInfo();
  process.stdout.write(
    [...renderBanner({ columns, version: info.version }), "", ...renderBootStaticRows(info, columns), ""].join("\n") + "\n",
  );
}
```

DELETE from index.tsx: `printBootCard`, `readBootConfig` (moves into `collectBootStaticInfo`), `pickTip`, `TIPS` (move to boot/tips.ts), the standalone ` Tip: …` print (the tip moves into the live footer). `loadLabsFlagsIntoEnv()` stays first, untouched.

**4. CREATE `src/tui/boot/bootLiveData.ts`** — pure async orchestration, dependency-injected for tests:

```ts
export interface BootLiveData {
  venue: {
    label: string | null;            // "binance" | "binance +2" | null when none configured
    paper: boolean;                  // sandbox flag on the active exchange config
    connectivity: "connecting" | "connected" | "offline" | "none";
  };
  equityUsd: number | null;
  audit: { state: "checking" | "ok" | "broken" | "unavailable"; checked: number };
  ticker: Array<{ symbol: string; priceUsd: number; changePercent24h: number }> | null;
}

export interface BootLiveDeps {
  loadConfig: typeof import("../../infra/storage/config/config.ts").loadConfig;
  testVenue: () => Promise<{ connected: boolean }>;        // wraps exchangeStatus() active entry
  fetchEquity: () => Promise<number>;                      // adapter.getFullAccountDetails().totalUsdtValue
  verifyAudit: () => import("../../core/audit/signing.ts").AuditChainVerification;
  fetchTicker: () => Promise<BootLiveData["ticker"]>;      // getCoinGeckoClient().getPrices(["BTC","ETH"])
  timeoutMs?: number;                                      // default 5000
}

export function defaultBootLiveDeps(): BootLiveDeps;
/** Resolves every field independently; a failed/timed-out probe degrades that field only. Never rejects. */
export async function loadBootLiveData(deps?: BootLiveDeps): Promise<BootLiveData>;
```

Semantics:
- Each probe wrapped in `Promise.race` with the timeout and a `try/catch`. Connectivity timeout/throw → `"offline"`. No configured exchange → `connectivity: "none"`, `label: null`. Equity failure → `null`. Ticker failure → `null`. Audit: run `verifyStoredAuditChain()` inside a `setTimeout(0)`-deferred microtask wrapper (it is SYNC sqlite — defer it so the first Ink paint lands before the scan); throw → `"unavailable"`.
- Venue label: active exchange type (`config.exchanges.find(e => e.id === config.activeExchangeId)?.type`), with ` +N` suffix when more exchanges are configured. `paper` = active config's `sandbox === true` OR `permissionMode === "paper"`.

**5. CREATE `src/tui/components/layout/BootLivePanel.tsx`** — Ink component:

```ts
interface Props { hint: string }   // getSessionTip() result, passed by App
export function BootLivePanel({ hint }: Props): React.JSX.Element;
```

- Internal hook-local state for the `BootLiveData` (NOT App.tsx useState — the reducer rule applies to app state; this is transient fetch state owned by one leaf component). On mount: render the connecting frame, call `loadBootLiveData()` once, set state when it resolves. No polling, no intervals.
- Rows (same 10-char dim label column as the static block, `paddingLeft` aligned to 2):
  - `venue` — `"none"` → `no venue — /configure exchange to connect` (dim). Otherwise `{label}{paper ? " (paper)" : " (live)"} · ` + connectivity: `connecting…` (dim) / `connected ✓` (✓ in `rgb(52,238,176)`) / `offline — /doctor to diagnose` (yellow). `(live)` renders bold red — live money should never look calm.
  - `equity` — `—` while null and connecting; `$12,408.32` (toLocaleString, 2dp) when present; row hidden entirely when `venue.connectivity === "none"`.
  - `audit` — `verifying chain…` (dim) → `chain ok ({checked} traces)` / red bold `CHAIN BROKEN — run /audit verify` / `unavailable` (dim).
  - Divider `─` × min(columns, 60), dim (same as `GordonWelcomeFeed`'s `Divider`).
  - Ticker line — while `ticker === null` and loading: `fetching market data…` (dim); on failure: `market data unavailable` (dim); on success: `BTC $67,432 +2.3%    ETH $3,521 -0.8%` — symbol bold, price plain, change green when ≥ 0 / red when < 0.
  - `Tip: {hint}` (dim) — this absorbs both the old pre-Ink Tip line and `GordonWelcomeFeed`.
- The component renders nothing (`null`) if `process.stdout.columns` is unavailable — never crash on weird terminals.

**6. EDIT `src/tui/App.tsx`** — in the empty-state region (the conversation Box that currently renders `VirtualMessageList` only when `messages.length > 0`, ~line 1846–1853), add the live panel as the empty state:

```tsx
{messages.length === 0 ? (
  <BootLivePanel hint={getSessionTip()} />
) : (
  <VirtualMessageList messages={messages} scrollEnabled={!showPalette && !anyDialogOpen} />
)}
```

Once the first message lands the panel unmounts — the static block above persists in scrollback, the live values were transient. This closes Item 26 (empty chat never renders blank) — note the cross-ref in your PR description.

**7. DELETE `src/tui/components/layout/GordonWelcomeFeed.tsx`** — unmounted, fully superseded by `BootLivePanel` (repo rule: unused code is deleted, no shims).

**Files:**
- CREATE `src/tui/boot/tips.ts` (moved pickTip/TIPS + `getSessionTip` cache)
- CREATE `src/tui/boot/bootComposition.ts` (`collectBootStaticInfo`, `renderBootStaticRows`, `formatAge`, `visibleLength`, moved `MODE_ANSI`)
- CREATE `src/tui/boot/bootLiveData.ts` (`loadBootLiveData`, `defaultBootLiveDeps`, `BootLiveData`)
- CREATE `src/tui/components/layout/BootLivePanel.tsx` (Ink live block)
- CREATE `src/tui/boot/bootComposition.test.ts`, `src/tui/boot/bootLiveData.test.ts`, `src/tui/boot/tips.test.ts`
- EDIT `src/tui/index.tsx` (replace `printBootCard` + helpers with banner + static-rows calls; delete moved code)
- EDIT `src/tui/App.tsx` (mount `BootLivePanel` in the empty-state branch of the conversation Box; import with `.tsx`/`.ts` extensions)
- DELETE `src/tui/components/layout/GordonWelcomeFeed.tsx`

**Acceptance criteria:**
1. `bun tsc --noEmit -p tsconfig.json` clean.
2. `bun test src/tui/boot` passes; `bun test src/tui` introduces no new failures.
3. Launch `bun run src/index.tsx`: banner + static rows print instantly (before any spinner), live rows appear below showing `connecting…` placeholders, then hydrate. Boot is never blocked on network.
4. Launch with networking disabled (or no exchange configured): live rows show the degraded copy (`offline — /doctor to diagnose` / `no venue — /configure exchange to connect` / `market data unavailable`) within ~5s; the app remains fully usable.
5. Trip a kill switch (`/killswitch trip firm "test halt rationale"`), relaunch: `switches` row shows red `HALTED: firm — test halt rationale`. Reset, relaunch: `none tripped`.
6. With `GORDON_PROACTIVE_AUTO_START=1`: radar row shows `21 producers · warming up` on a fresh launch. Without it: `off — set GORDON_PROACTIVE_AUTO_START=1 or /radar start`.
7. In paper mode (`/paper`, relaunch): mode row shows bold-yellow `[PAPER]` and `/live to exit`; venue row shows `(paper)`.
8. Send a message: `BootLivePanel` unmounts, chat renders; static block remains in scrollback unchanged.
9. `grep -r "GordonWelcomeFeed" src/` returns nothing.

**Test plan:**
- `src/tui/boot/bootComposition.test.ts`: fixed `BootStaticInfo` fixture → exact row assertions (label padding, `/model to change` hint present at 100 cols, dropped at 65 cols); paper mode → `[PAPER]` + `/live to exit`; firm trip → `HALTED: firm`; scoped trips → `tripped: venue:binance`; guards `enabled && !installed` → `✗ NOT INSTALLED`; radar off/warming/aged variants; every output line `visibleLength ≤ columns - 1` at widths 50/60/80/120; `formatAge` boundaries (59s/60s/59m/60m/24h).
- `src/tui/boot/bootLiveData.test.ts`: all-success deps → fully populated `BootLiveData`; `testVenue` rejects → `connectivity: "offline"` while ticker/audit still populate; `testVenue` hangs → timeout → `"offline"` (use `timeoutMs: 20`); no-exchange config → `"none"` + label null; `verifyAudit` throws → `"unavailable"`; `loadBootLiveData` never rejects (assert with everything throwing).
- `src/tui/boot/tips.test.ts`: `pickTip` returns the longest-unseen tip (seed a `tipHistory.json` under a temp `GORDON_HOME`); corrupt history file → still returns a tip; `getSessionTip()` returns the same string on repeated calls in one process.
- `BootLivePanel` rendering is covered indirectly; do not add an ink-testing-library dependency — the data seams above carry the logic.

**Gotchas:**
- **NEVER run bare `bun test`** — it sweeps vendored repos under `agents/`. Scope: `bun test src/tui`.
- `verifyStoredAuditChain()` is synchronous and unbounded (loads every trace, src/core/audit/store.ts:453–467). It MUST be deferred off the mount render (post-first-paint) and must never run pre-Ink. Do not "fix" it with a limit param — that's a core/audit change outside this item's blast radius.
- Kill-switch state: under `NODE_ENV=test` persistence is disabled by design (src/infra/safety/killSwitches.ts:72–80) — tests that trip switches must trip in-process, not via fixture files.
- Reuse, don't rewrite: `MODE_ANSI` (index.tsx:182–189), `vlen` ANSI-strip (index.tsx:213), truncation patterns `modelDisplay`/`dirDisplay` (index.tsx:222–229), `pickTip` (index.tsx:95–140) — all MOVE into `src/tui/boot/`; the old copies in index.tsx are deleted in the same commit. Grep before writing any new formatting helper.
- `GordonHeader` (src/tui/components/layout/GordonHeader.tsx) is imported in App.tsx:17 but never mounted. Leave it and its import alone — other backlog items (compact status line, Item 4/5) may wire it; deleting it is not this item's call.
- No new reducer actions are needed: `bootPhase`/`runtimeReady` already exist in src/tui/state/types.ts; `BootLivePanel`'s fetch state is component-local by design. Do not add boot fields to `AppState`.
- Mode coloring exists in three places (`MODE_ANSI` boot, `MODE_COLOR` GordonHeader.tsx:25, `MODE_COLOR` PromptInputFooter.tsx:20) and they intentionally disagree today; Item 28 (semantic color layer) unifies them. Do not unify here — keep the boot `MODE_ANSI` values byte-identical to current behavior.
- Connectivity probe: prefer calling `exchangeStatus()` (src/app/commands/exchange.ts:307) inside `defaultBootLiveDeps` and picking the `isActive` entry over re-instantiating `ExchangeFactory` yourself — it already handles missing creds, errors, and rate-limit state.
- The agent tool surface (22 tools) is untouched by this work; if you find yourself editing anything under `src/infra/agents/`, stop — wrong layer.
- `process.stdout.columns` can be `undefined` in odd terminals — every width consumer defaults to 120 (pre-Ink) / renders null (Ink), matching existing code.
- Ordering: Item 14 first (banner module), then this. Items 4 and 5 (loud PAPER badge, persistent kill-switch badge) build persistent status-line UI — this item only owns the boot-time snapshot; keep copy consistent with them (`[PAPER]`, `HALTED: firm`).
- Conventions repeated: `.ts` extensions on relative imports; bun:test co-located; typecheck `bun tsc --noEmit -p tsconfig.json`; comments only for non-obvious WHY; no backwards-compat shims.
