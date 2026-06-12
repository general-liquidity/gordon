# P5 — Component/Design-System Coherence (Items 28–33)

Handoff-ready specs. Implementer context: Bun + Ink TUI at `src/tui/`. Repo conventions that apply to every item below:

- `.ts`/`.tsx` extensions on relative imports (Bun convention; existing files mix `.js` and `.ts(x)` suffixes in imports — match whatever the file you're editing already uses).
- Tests: bun:test, co-located `*.test.ts`. **Never run bare `bun test`** (it sweeps vendored repos under `agents/`) — scope: `bun test src/tui`.
- Typecheck gate: `bun tsc --noEmit -p tsconfig.json` must be clean.
- App-level state changes go through the reducer (`src/tui/state/types.ts` action union, SCREAMING_SNAKE names like `SET_SHOW_HELP`) — no new `useState` in `App.tsx`. Component-local UI state (cursor index, step id) stays local.
- Theme tokens come from `src/tui/themes/themes.ts` (`GordonTheme`, 6 themes incl. daltonized) via `useTheme()` / `useThemeColor()` in `src/tui/themes/ThemeProvider.tsx`.
- The agent tool surface must stay exactly 22 tools (none of these items touch it — do not "drive by" agent files).
- No backwards-compat shims; unused code gets deleted. Comments only where WHY is non-obvious.

---

### Item 28 — Semantic color utility layer (M, P5 — run as background hygiene alongside P3 IA work)

**Current state:**
- The token system exists and is complete: `GordonTheme` at `src/tui/themes/themes.ts:9–42` defines `moneyProfit/moneyLoss/moneyNeutral`, `riskSafe/riskWarning/riskDanger/riskCritical`, `signalBuy/signalSell/signalNeutral`, 10 `agent*` tokens, `ui*` chrome tokens, across 6 themes (`THEMES`, `themes.ts:132–139`, incl. `dark-daltonized`/`light-daltonized` where profit is blue and loss is yellow). Access hooks: `useTheme()` / `useThemeColor(token)` at `src/tui/themes/ThemeProvider.tsx:30–41`.
- Almost nothing uses it. Verified by grep: only `ThemePicker.tsx` references theme tokens among all of `src/tui/components/`. Meanwhile **384** literal `color="<namedColor>"` occurrences exist across `src/tui/components/` + `src/tui/design-system/` (pattern: `grep -rEoh 'color="(red|green|yellow|cyan|cyanBright|magenta|blue|gray|grey|white|redBright|greenBright|yellowBright|magentaBright|blueBright|whiteBright)"'`), plus **19** raw `rgb(...)` string literals in components. (The backlog said 238 — the tree moved; these are today's counts.)
- Duplicated hand-rolled risk-color lambdas (verified):
  - `src/tui/components/browsers/ApprovalBrowser.tsx:53` — `const riskColor = (level) => level === "critical" ? "red" : level === "high" ? "yellow" : "green"`
  - `src/tui/components/permissions/ToolExecutionPermissionRequest.tsx:54–55` — `riskClass === "high" ? "red" : "medium" ? "yellow" : "green"`
  - `src/tui/components/permissions/TradeExecutionPermissionRequest.tsx:43` — same shape
  - `src/tui/components/layout/PressEnterToContinue.tsx:14` — severity variant
  - `src/tui/components/dialogs/ApprovalDialog.tsx:119` (inside `StandardApproval`) — inline `riskClass === "medium" ? "yellow" : "green"`
- Money-direction helper duplicated: `changeColor(n)` at `src/tui/components/charts/DataTable.tsx:132–136` (returns `"green"`/`"red"`/`undefined`), consumed by 6 other files (`RichContent.tsx`, `LivePositions.tsx`, `EnrichedQuoteRenderer.tsx`, `PositionRenderer.tsx`, `ScanResultRenderer.tsx`, `StrategyRenderer.tsx`). `LivePositions.tsx:60` also hardcodes `side === "long" ? "green" : "red"` in a module-level `COLUMNS` table.
- Brand color hardcoded as `"rgb(52,238,176)"` in 8+ component files (e.g. `GordonSelect.tsx:22` default `focusColor`, `GordonHeader.tsx`, `PromptInput.tsx`).

**Problem:** Six themes ship, including daltonized ones built for exactly this product's red/green-critical audience — and switching theme changes almost nothing on screen. For a vibe trader, P&L and risk color IS the interface; a colorblind operator currently gets the daltonized theme name and none of the daltonized colors.

**Spec:**

CREATE `src/tui/design-system/colorMap.ts` — single source of truth mapping domain semantics → theme tokens. Pure functions (theme passed in, testable without React) plus thin hooks:

```ts
import type { GordonTheme } from "../themes/themes.ts";

export type RiskLevel = "low" | "medium" | "high" | "critical";
export type SignalSide = "buy" | "sell" | "long" | "short" | "neutral";

/** low→riskSafe · medium→riskWarning · high→riskDanger · critical→riskCritical */
export function getRiskColor(level: RiskLevel, theme: GordonTheme): string;

/** value>0→moneyProfit · value<0→moneyLoss · 0/NaN→undefined (inherit — matches existing changeColor semantics so tables don't gain noise) */
export function getMoneyColor(value: number, theme: GordonTheme): string | undefined;

/** buy|long→signalBuy · sell|short→signalSell · neutral→signalNeutral */
export function getSignalColor(side: SignalSide, theme: GordonTheme): string;

/** Case-insensitive agent name → agent token. gordon→agentGordon, scanner→agentScanner,
 *  analyst|researcher→agentAnalyst, planner→agentPlanner, executor→agentExecutor,
 *  monitor→agentMonitor, teacher→agentTeacher, backtester→agentBacktester,
 *  critic→agentCritic, auditor→agentAuditor. Unknown → uiMuted. */
export function getAgentColor(agent: string, theme: GordonTheme): string;

// Hooks — wrap useTheme() from ../themes/ThemeProvider.tsx
export function useRiskColor(level: RiskLevel): string;
export function useMoneyColor(value: number): string | undefined;
export function useSignalColor(side: SignalSide): string;
export function useAgentColor(agent: string): string;
```

Export all of the above from `src/tui/design-system/index.ts`.

**Deliberate visual change:** the migration makes `high` risk render `riskDanger` (red family) everywhere. `ApprovalBrowser.tsx:53` currently shows `high` as yellow — that was one of the inconsistencies; do not preserve it.

**Migration strategy — two waves:**

*Wave 1 (mandatory in this item): risk-bearing components.* Replace every hand-rolled lambda above with `getRiskColor`/`useRiskColor`. Files: `ApprovalDialog.tsx` (all three variants — Standard/High/Critical, including border colors), `ToolExecutionPermissionRequest.tsx`, `TradeExecutionPermissionRequest.tsx`, `ApprovalBrowser.tsx`, `PressEnterToContinue.tsx`. Then money path: delete `changeColor` from `DataTable.tsx` (no shims) and migrate its 6 consumers to `getMoneyColor(value, useTheme())`; in `LivePositions.tsx` move the module-level `COLUMNS` array inside the component (`useMemo` keyed on `theme`) so `side` uses `getSignalColor` and `pnl` uses `getMoneyColor`. Replace `"rgb(52,238,176)"` literals with `theme.uiBrand` (`GordonSelect` default `focusColor` becomes `useTheme().uiBrand`).

*Wave 2 (mechanical, behind the ratchet): everything else.* Find with: `grep -rEn 'color="(red|green|yellow|cyan|cyanBright|magenta|blue|gray|grey|white|redBright|greenBright|yellowBright)"' src/tui/components src/tui/design-system`. Mapping guide: financial green/red → `getMoneyColor`/`getSignalColor`; risk/severity → `getRiskColor`; `cyanBright` headers/branding → `theme.uiBrand`; warning yellow → `theme.riskWarning` (or `variantAlert` in notification contexts); gray/dim labels → keep `dimColor` (terminal-native) or `theme.uiMuted`; borders → `theme.uiBorder`/`theme.uiFocus`. Wave 2 may land file-by-file across later PRs — the ratchet test below enforces monotonic progress.

**Regression lint (the thing that makes this stick):** CREATE `src/tui/design-system/colorMap.lint.test.ts` — a bun:test that scans component sources for raw color literals:

```ts
// Scans: src/tui/components/**/*.{ts,tsx}, src/tui/design-system/*.tsx
// (excluding *.test.*; src/tui/themes/themes.ts is out of scope by construction)
const NAMED = "(?:red|green|yellow|blue|magenta|cyan|white|gray|grey|black)(?:Bright)?";
const FORBIDDEN = [
  new RegExp(`(?:color|borderColor)=\\{?["']${NAMED}["']`),     // JSX attribute literals
  new RegExp(`["']rgb\\(\\d{1,3},\\s*\\d{1,3},\\s*\\d{1,3}\\)["']`), // raw rgb strings
];
const ALLOWLIST: string[] = [ /* seed with every file still dirty at implementation time */ ];
```

Two assertions: (1) every NON-allowlisted scanned file matches zero forbidden patterns — failure message names the file, line, and matched text plus the hint `Use colorMap.ts (getRiskColor/getMoneyColor/getSignalColor/getAgentColor) or theme tokens via useTheme().`; (2) every ALLOWLIST entry still matches at least one pattern — so cleaning a file forces removing it from the list, and the list only shrinks. Wave-1 files must NOT be in the seed allowlist.

**Files:**
- CREATE `src/tui/design-system/colorMap.ts` (semantic color functions + hooks)
- CREATE `src/tui/design-system/colorMap.test.ts` (mapping unit tests)
- CREATE `src/tui/design-system/colorMap.lint.test.ts` (ratchet lint)
- EDIT `src/tui/design-system/index.ts` (export new functions/hooks)
- EDIT `src/tui/components/dialogs/ApprovalDialog.tsx` (`StandardApproval`/`HighApproval`/`CriticalApproval` risk + border colors → `useRiskColor`)
- EDIT `src/tui/components/permissions/ToolExecutionPermissionRequest.tsx`, `TradeExecutionPermissionRequest.tsx` (delete local `riskColor` lambdas)
- EDIT `src/tui/components/browsers/ApprovalBrowser.tsx` (delete `riskColor` at line 53)
- EDIT `src/tui/components/layout/PressEnterToContinue.tsx` (severity ternary → `getRiskColor`; map `warning`→`medium`, `critical`→`critical`, else `low`)
- EDIT `src/tui/components/charts/DataTable.tsx` (delete `changeColor`)
- EDIT `src/tui/components/status/LivePositions.tsx` (COLUMNS into component, `getSignalColor`/`getMoneyColor`)
- EDIT `src/tui/components/messages/RichContent.tsx`, `src/tui/renderers/EnrichedQuoteRenderer.tsx`, `PositionRenderer.tsx`, `ScanResultRenderer.tsx`, `StrategyRenderer.tsx` (replace `changeColor` imports)
- EDIT `src/tui/design-system/GordonSelect.tsx` (default `focusColor` → `uiBrand`)

**Acceptance criteria:**
1. `bun test src/tui/design-system` passes; `colorMap.test.ts` asserts the four mappings against `DARK_THEME` and `DARK_DALTONIZED_THEME` (proving daltonized actually changes output: `getMoneyColor(1, DARK_DALTONIZED_THEME) === "rgb(51,153,255)"`).
2. `colorMap.lint.test.ts` passes, and deliberately re-adding `color="green"` to `ApprovalDialog.tsx` makes it fail with a message naming that file.
3. `grep -n "changeColor" src/tui -r` returns nothing.
4. `grep -rn 'riskColor =' src/tui/components` returns nothing.
5. Launch the TUI, `/theme` → `dark-daltonized`: an open position's P&L renders blue/yellow, an approval dialog's risk label renders the daltonized risk colors (manual check).
6. `bun tsc --noEmit -p tsconfig.json` clean.

**Test plan:**
- `colorMap.test.ts`: each function × {dark, light, dark-daltonized}; `getMoneyColor(0)` and `getMoneyColor(NaN)` → `undefined`; `getAgentColor("RESEARCHER")` → `agentAnalyst` value; `getAgentColor("unknown-agent")` → `uiMuted`; `getRiskColor` exhaustive over the 4-member union.
- `colorMap.lint.test.ts`: as specced (it is itself the regression test).

**Gotchas:**
- `useInput`, `Text`, `Box` come from `../ink-custom`, NOT `ink`. Theme hooks from `../themes/ThemeProvider` — check existing import suffix style per file.
- `ThemePicker.tsx` passes `theme.moneyProfit` etc. as variables — the lint patterns won't (and shouldn't) flag it.
- Do NOT change `src/tui/themes/themes.ts` token VALUES in this item; item 30 adds one token (`uiInfo`) — if you implement both, add it there once.
- `DataTable`'s `Column.color` callback signature `(v) => string | undefined` stays; only the functions feeding it change. Moving `COLUMNS` inside `LivePositions` must not break the `position:updated` subscription logic (`LivePositions.tsx:137–166`) — don't touch it.
- Wave 2 is allowed to trail; the ratchet allowlist is the contract. Do not "fix" allowlisted files with sed — use Edit per region.
- Items 30 and 31 depend on this file existing. Land 28 first.

---

### Item 29 — `MultiStepPicker<T>` abstraction (M, P5)

**Current state:**
- Five components hand-roll the same step-FSM + Esc-goes-back + footer-hint pattern:
  - `src/tui/components/browsers/BrokerPicker.tsx` — `type Step = "action" | "broker" | "apiKey" | "apiSecret"` (line 36), local `useState` per collected field, Esc handling at lines 44–49.
  - `src/tui/components/browsers/ExchangePicker.tsx` — 12-member `Step` union (lines 57–69), branching graph (action → switch/add-live/add-sandbox/remove → credential chain with conditional passphrase/wallet steps), shared `header`/`footer` JSX (lines 253–264).
  - `src/tui/components/browsers/ModelPicker.tsx` — 2-step `"provider" | "model"` FSM (line 75).
  - `src/tui/components/wizards/BacktestWizard.tsx` — numeric `step` 0–4 with per-step key handling in one big `useInput` (lines 57+).
  - `src/tui/components/wizards/SDKScaffoldWizard.tsx` — same shape.
- `src/tui/components/wizards/Wizard.tsx` (generic linear wizard, lines 8–52) has **zero importers** (verified: only `SetupWizard`/`BacktestWizard` are imported in `App.tsx`, both self-contained) — it's the "underused abstraction" the review flagged.
- All pickers mount from `App.tsx` local dialog state (`showModelPicker` etc., `App.tsx:553–559`) — that wiring is item 9's problem, not this item's.

**Problem:** Every new venue/provider flow re-implements step navigation, double-fire guards, and inconsistent footer copy — five slightly-different FSMs is how Esc behavior and hints drift apart in the exact flows where a vibe trader types API secrets.

**Spec:**

CREATE `src/tui/design-system/MultiStepPicker.tsx`. Graph FSM (not linear — `ExchangePicker` branches), with the transition logic extracted as a pure, tested function:

```ts
import type { ReactNode } from "react";

export interface PickerStepContext<TData> {
  data: Partial<TData>;
  /** Merge a field into collected data. */
  set: <K extends keyof TData>(key: K, value: TData[K]) => void;
  /** Navigate to a named step (pushes history — Esc pops it). */
  go: (stepId: string) => void;
  /** Complete: fires onComplete(data as TData). */
  done: () => void;
  /** Abort: fires onCancel(). */
  cancel: () => void;
}

export interface PickerStep<TData> {
  /** Step heading rendered under the picker title. Omit to render none. */
  title?: string;
  /** Dim helper line under the title. */
  hint?: string;
  render: (ctx: PickerStepContext<TData>) => ReactNode;
}

export interface MultiStepPickerProps<TData> {
  /** Uppercase brand header, e.g. "EXCHANGE SETUP". Rendered bold in theme.uiBrand. */
  title: string;
  /** Dim suffix next to the title, e.g. "(active: binance)". */
  titleNote?: string;
  steps: Record<string, PickerStep<TData>>;
  initialStep: string;
  onComplete: (data: TData) => void;
  onCancel: () => void;
  /** Render "Step N of M" + progress dots. Only meaningful for linear flows. Default false. */
  showProgress?: boolean;
}

export function MultiStepPicker<TData>(props: MultiStepPickerProps<TData>): JSX.Element;

// Pure FSM core, exported for tests:
export interface PickerMachineState { stepId: string; history: string[] }
export type PickerMachineEvent = { type: "go"; stepId: string } | { type: "back" };
export function pickerTransition(state: PickerMachineState, event: PickerMachineEvent): PickerMachineState;
```

Behavior contract:
- The component owns exactly ONE `useInput`, handling ONLY Esc: history non-empty → pop (back); at the initial step → `onCancel()`. Steps must never handle Esc themselves (prevents double-fire with the existing `GordonSelect` pattern — see `GordonSelect.tsx:24–28` `decided` guard for why this matters).
- `go` pushes the current step onto history. `set` merges immutably.
- Footer is always rendered (standard copy, dim): at initial step `Esc to cancel · Enter to select`; deeper: `Esc to go back · Enter to select`. (When item 32 lands, this footer becomes a `<KeyboardHints/>`; whichever lands second adapts.)
- Layout matches today's pickers: `<Box flexDirection="column" paddingX={1} paddingY={1}>`, bold title in `theme.uiBrand` (not `cyanBright` — item 28).

ASCII frame (what every migrated picker renders):

```
 EXCHANGE SETUP  (active: binance)
 Select testnet / sandbox exchange (paper trading):
 These use fake money — safe for demos and testing

 ▸ Binance Testnet  (testnet.binance.vision)
   OKX Demo  (simulated trading, x-simulated-trading: 1)

 Esc to go back · Enter to select
```

**Migrations (five deletions of hand-rolled FSMs):**
1. `BrokerPicker.tsx`: `TData = { action: string; broker: string; apiKey: string; apiSecret: string }`; 4 steps; `status` action short-circuits via `done()` from the action step's `onChange`. Keep `BROKERS`/`ACTIONS` tables and the `onComplete(action, broker, credentials?)` external signature unchanged.
2. `ExchangePicker.tsx`: `TData = AddState & { action: string }`; the 12 steps become `steps` entries; `loading` stays a pre-render gate (config loads in `useEffect`, render `Loading config…` until ready, then mount the picker). All business logic (`finishAdd`, `handleSwitch`, `handleRemove`, the sync-comment about `EXCHANGE_SANDBOX_SUPPORT`) is untouched — only navigation/scaffolding is replaced.
3. `ModelPicker.tsx`: 2 steps, trivial.
4. `BacktestWizard.tsx` + 5. `SDKScaffoldWizard.tsx`: adopt `MultiStepPicker` as the shell (title, progress via `showProgress: true`, Esc/back, footer) but KEEP their per-step field-level `useInput` handling (tab between fields, inline text editing) inside `render`. Their step `useInput`s must drop their own Esc branches.
- DELETE `src/tui/components/wizards/Wizard.tsx` (zero importers, superseded; no shim).

**Files:**
- CREATE `src/tui/design-system/MultiStepPicker.tsx`
- CREATE `src/tui/design-system/MultiStepPicker.test.ts` (pure FSM tests — no render harness needed)
- EDIT `src/tui/design-system/index.ts` (export `MultiStepPicker`, types, `pickerTransition`)
- EDIT `src/tui/components/browsers/BrokerPicker.tsx`, `ExchangePicker.tsx`, `ModelPicker.tsx` (replace hand-rolled FSM scaffolding)
- EDIT `src/tui/components/wizards/BacktestWizard.tsx`, `SDKScaffoldWizard.tsx` (shell adoption)
- DELETE `src/tui/components/wizards/Wizard.tsx`

**Acceptance criteria:**
1. `bun test src/tui/design-system` passes; `pickerTransition` covered for go/back/back-at-root.
2. `grep -rn "useState<Step>" src/tui/components` returns nothing; `grep -rn 'wizards/Wizard' src/tui` returns nothing.
3. Manual: `/exchange` → Add testnet → pick Binance Testnet → Esc steps back through cred-apikey → add-sandbox-pick → action → Esc cancels. Identical end-to-end behavior to today including the config write (`finishAdd`).
4. Manual: `/model` picks provider then model; Esc on step 2 returns to step 1.
5. External props interfaces of all five components unchanged (verify: `App.tsx` compiles with no call-site edits).
6. `bun tsc --noEmit -p tsconfig.json` clean.

**Test plan:** `MultiStepPicker.test.ts`: `pickerTransition` — go pushes history; back pops; back at empty history returns state unchanged (component layer maps that to `onCancel`); a scripted Exchange-shaped walk (action→add-sandbox-pick→cred-apikey→cred-apisecret) then 4 backs returns to initial.

**Gotchas:**
- `BrokerPicker`/`ExchangePicker` use `Select`/`TextInput` from `@inkjs/ui`; `ModelPicker` uses `GordonSelect`. Do NOT unify the select widget in this item — that's creep. Only the step scaffolding changes.
- The `@inkjs/ui` `Select` fires `onChange` on Enter; navigation (`ctx.go`) happens inside those callbacks. Multiple mounted `useInput`s double-fire on a single keypress — this is why MultiStepPicker handles ONLY Esc and steps own everything else.
- `ExchangePicker.finishAdd` writes config and calls `refreshRuntimeCredentials()` — money-adjacent code. Do not restructure it; ground rule 1 (bug fixes don't get refactors) applies in reverse: abstractions don't get logic edits.
- Item 9 (dialog eviction) will change how pickers MOUNT, not their internals — no ordering constraint, but don't add new `useState` to `App.tsx` here.
- `SetupWizard.tsx` and `GordonOnboarding.tsx` are item 24's territory — leave them alone.

---

### Item 30 — Themed primitives actually themed (S, P5 — after item 28)

**Current state:**
- `src/tui/design-system/ThemedText.tsx:16–23`: `toneMap` hardcodes `brand→"cyanBright"`, `success→"green"`, `error→"red"`, `warning→"yellow"`, `info→"cyan"`, `muted→dimColor`. Never consults the theme.
- `src/tui/design-system/ThemedBox.tsx:11–23`: `colorToken` union `"surface"|"elevated"|"overlay"|"sunken"` maps to near-empty styles; `overlay` sets `borderStyle: "round"` with no themed border color.
- `src/tui/design-system/Dialog.tsx:24` defaults `color = "yellow"` for border+title; `Pane.tsx:21` defaults `color = "cyan"`. Both ignore the theme.

**Problem:** The components literally named "Themed" are the ones that bypass themes — every dialog border and tone-colored string is identical across all 6 themes, defeating the daltonized/high-contrast themes at the chrome layer.

**Spec:**

1. ADD one token to `GordonTheme` (`src/tui/themes/themes.ts`): `uiInfo: string` in the `// UI Chrome` group. Values: `DARK_THEME: "rgb(0,180,220)"`, `LIGHT_THEME: "rgb(0,130,170)"` (the existing chartVolume cyans — info-blue, distinct from brand teal). The other 4 themes inherit via spread; no overrides needed.

2. `ThemedText` — same prop surface, theme-resolved:

```ts
export type TextTone = "brand" | "success" | "error" | "warning" | "info" | "muted";

// resolution (pure, exported for tests):
export function toneColor(tone: TextTone, theme: GordonTheme): { color?: string; dimColor?: boolean };
// brand→uiBrand · success→riskSafe · error→variantError · warning→riskWarning
// info→uiInfo · muted→{dimColor:true} (terminal-native dim beats a gray token)
```

`ThemedText` calls `useTheme()` and spreads the result. Explicit `color`/`dimColor` props passed by callers still win (current `{...toneProps} {...rest}` ordering already does this — keep it).

3. `ThemedBox` — replace the vestigial `colorToken` styles with themed borders:

```ts
type ColorToken = "surface" | "elevated" | "overlay" | "sunken";   // unchanged union
type BorderTone = "default" | "focus" | "danger" | "brand";

interface Props extends BoxProps {
  colorToken?: ColorToken;
  /** Themed border color; implies borderStyle "round" unless caller sets one. */
  borderTone?: BorderTone;
}
// default→uiBorder · focus→uiFocus · danger→riskDanger · brand→uiBrand
```

`overlay` keeps `borderStyle: "round"` and now also gets `borderColor: theme.uiBorder` when no `borderTone` given.

4. `Dialog.tsx`: `color` prop becomes `tone?: "warning" | "danger" | "brand" | "info"` (default `"warning"` → `riskWarning`, preserving today's yellow default look in dark theme). Border + title both use the resolved color. Update all `Dialog` call sites passing `color=` (grep `<Dialog` — e.g. `BacktestWizard.tsx`) to the nearest tone.
5. `Pane.tsx`: `color` prop default changes from `"cyan"` to resolved `theme.uiBrand`; prop stays a string override for callers that pass explicit theme values.

**Files:**
- EDIT `src/tui/themes/themes.ts` (add `uiInfo` to interface + DARK_THEME + LIGHT_THEME)
- EDIT `src/tui/design-system/ThemedText.tsx` (toneMap → `toneColor(tone, theme)`)
- EDIT `src/tui/design-system/ThemedBox.tsx` (borderTone + themed overlay border)
- EDIT `src/tui/design-system/Dialog.tsx` (color → tone)
- EDIT `src/tui/design-system/Pane.tsx` (themed default)
- EDIT any `<Dialog color=` / `<Pane color=` call sites (grep first; map literal colors to tones)
- CREATE `src/tui/design-system/ThemedText.test.ts` (toneColor mapping per theme)

**Acceptance criteria:**
1. `bun test src/tui/design-system` passes; `toneColor("success", DARK_DALTONIZED_THEME).color === DARK_DALTONIZED_THEME.riskSafe` (blue, not green).
2. `grep -n "cyanBright" src/tui/design-system/ThemedText.tsx` returns nothing; no named-color literals remain in `ThemedText.tsx`/`ThemedBox.tsx`/`Dialog.tsx`/`Pane.tsx` (item 28's lint covers design-system — remove these four from its allowlist as part of this item).
3. Manual: switch theme to `light` — dialog borders and ThemedText tones visibly change.
4. `bun tsc --noEmit -p tsconfig.json` clean.

**Test plan:** `ThemedText.test.ts`: `toneColor` exhaustive over the 6-tone union × {dark, light, dark-daltonized}; muted returns `dimColor` with no color.

**Gotchas:**
- Depends on item 28 only for lint-allowlist bookkeeping; `toneColor` itself needs no colorMap import (different axis: UI tones vs domain semantics — don't merge them).
- `Dialog` has a `useInput` (Esc/Enter, `Dialog.tsx:28–34`) — don't touch it; this item is colors only.
- `ThemedText`'s prop-ordering subtlety: `{...toneProps} {...rest}` means caller props override tone. Preserve exactly; tests in consuming components rely on overriding.
- `Text`/`Box` types come from `../ink-custom` (`TextProps`/`BoxProps`) — not the `ink` package.

---

### Item 31 — Button variant family + DiffDialog collision (S, P5 — after item 28)

**Current state:**
- `src/tui/design-system/Button.tsx:12–20`: `Props { label, onPress, focused?, disabled?, color? }`, `color` defaults to literal `"cyanBright"`. Single consumer: `src/tui/components/mcp/MCPSettings.tsx:139–150` passing `color="green"` (Save) and `color="red"` (Cancel).
- Name collision (verified): TWO `DiffDialog` components —
  - `src/tui/components/dialogs/DiffDialog.tsx` (session diff browser; file list + `StructuredDiff` detail) — the LIVE one, imported by `App.tsx:120`.
  - `src/tui/components/diff/DiffDialog.tsx` (before/after `StrategyDiff` viewer) — **zero importers** (verified by grep across `src/`). Its only dependency `StrategyDiff.tsx` is also otherwise unimported.

**Problem:** Raw-color buttons defeat theming on the exact affordances (confirm/cancel) where color carries meaning, and the duplicate `DiffDialog` is a loaded foot-gun for any agent auto-importing by name.

**Spec:**

1. Button variants:

```ts
export type ButtonVariant = "primary" | "success" | "danger" | "neutral";

interface Props {
  label: string;
  onPress: () => void;
  focused?: boolean;
  disabled?: boolean;
  variant?: ButtonVariant;   // default "primary"
}

// pure, exported for tests:
export function buttonVariantColor(variant: ButtonVariant, theme: GordonTheme): string;
// primary→uiBrand · success→riskSafe · danger→riskDanger · neutral→uiMuted

export function Button(props: Props): JSX.Element;
// Compound aliases (preset variant, otherwise identical props):
Button.Primary; Button.Success; Button.Danger; Button.Neutral;
```

DELETE the `color` prop (no shim). Render states unchanged (focused = inverse bold, unfocused = `[ Label ]`, disabled = dim) — only the color source changes to `buttonVariantColor(variant, useTheme())`.

2. Migrate `MCPSettings.tsx`: `color="green"` → `variant="success"`, `color="red"` → `variant="danger"`.

3. Collision resolution: DELETE `src/tui/components/diff/DiffDialog.tsx`. Also DELETE `src/tui/components/diff/StrategyDiff.tsx` IF a fresh grep confirms its only importer was the deleted file (true at spec time). Leave `DiffDetailView.tsx`/`DiffFileList.tsx`/`colorDiff.ts` alone (separate dead-code question, out of scope). The surviving `components/dialogs/DiffDialog.tsx` keeps its name.

**Files:**
- EDIT `src/tui/design-system/Button.tsx` (variant family, theme resolution, compound exports)
- CREATE `src/tui/design-system/Button.test.ts` (`buttonVariantColor` mapping)
- EDIT `src/tui/components/mcp/MCPSettings.tsx` (variant props)
- DELETE `src/tui/components/diff/DiffDialog.tsx` (+ `StrategyDiff.tsx` after import re-check)
- EDIT `src/tui/design-system/index.ts` (export `ButtonVariant`, `buttonVariantColor` — `Button` already exported)

**Acceptance criteria:**
1. `bun test src/tui/design-system` passes; `buttonVariantColor("danger", DARK_DALTONIZED_THEME) === "rgb(255,204,0)"` (daltonized riskDanger).
2. `grep -rn "color=" src/tui/design-system/Button.tsx` returns nothing; `grep -rn 'color="(green|red)"' src/tui/components/mcp/MCPSettings.tsx` returns nothing.
3. Exactly one `DiffDialog` definition: `grep -rln "export function DiffDialog" src/` → only `src/tui/components/dialogs/DiffDialog.tsx`.
4. `bun tsc --noEmit -p tsconfig.json` clean (proves nothing imported the deleted files).
5. Manual: MCP settings dialog — Save renders in the theme's safe-green (blue in daltonized), Cancel in danger color.

**Test plan:** `Button.test.ts`: `buttonVariantColor` exhaustive over 4 variants × {dark, dark-daltonized}.

**Gotchas:**
- `Button`'s `useInput` fires for ALL mounted buttons; the `focused` guard is the only thing preventing double-activation (`Button.tsx:21–28`). Don't restructure the input handling.
- Compound-component assignment (`Button.Danger = ...`) needs the function-declaration-plus-property pattern or `Object.assign`; keep types strict (no `any`).
- Depends on item 28's `useTheme` adoption pattern only; can land before 28's wave-2 migration.
- Do NOT rename `components/dialogs/DiffDialog.tsx` — `App.tsx:120` imports it and the name is now unique.

---

### Item 32 — Keybinding hygiene: conflict detection + `<KeyboardHints/>` + context-sensitive `?` (M, P5)

**Current state:**
- TWO parallel keybinding systems exist:
  1. **Live system**: `src/tui/keybindings/keybindings.ts` — `BindableAction` union (lines 26–56), `DEFAULT_BINDINGS` (lines 80–118, with `when: "always" | "normalMode" | "insertMode"`), `getResolvedBindings()` (lines 173–186) merging `~/.gordon/keybindings.json` over defaults **by action** (so a user binding `{key:"ctrl+p", action:"quickApprove"}` silently leaves the default `ctrl+p→togglePalette` in place — two actions on one key, winner decided by array order). Consumed by `App.tsx:885–940` (global `useInput` → `getActionsForKey` → switch) and `ShortcutsBrowser.tsx`/`ConfigurableShortcutHint.tsx`.
  2. **Built-but-unmounted system**: `src/tui/keybindings/{types,parser,resolver,defaultBindings,loadUserBindings,KeybindingContext}.ts` — `KeyContext` enum, chord resolver. `KeybindingProvider` is mounted NOWHERE (verified by grep). Do not wire it in this item.
- `src/tui/design-system/KeybindingWarnings.tsx` exists (renders `⚠ Key conflict: [key] bound to both "a" and "b"`) but has **no producer** — nothing computes conflicts, nothing mounts it.
- Hints today are ad-hoc dim `<Text>` per dialog with drifting copy: `"Esc to go back · Enter to continue"` (`BrokerPicker.tsx:101`), `"Enter to apply · Esc to cancel"` (`ThemePicker.tsx:39`), `"[Q/Esc] Close · [↑↓] Scroll"`, etc.
- `?` does nothing anywhere; the shortcuts reference is reachable only via `/shortcuts` | `/keys` (`App.tsx:1017–1019` → `ShortcutsBrowser`).

**Problem:** A trader who rebinds a key gets silent shadowing — in a product where `ctrl+y` is quick-APPROVE, a shadowed binding is a safety bug, not a paper cut. And key affordances are undiscoverable exactly where hesitation is costly (approval dialogs).

**Spec:**

**(a) `validateKeybindings()`** — in `src/tui/keybindings/keybindings.ts` (the live system):

```ts
export interface KeybindingConflict {
  /** Normalized key combo, e.g. "ctrl+shift+s". */
  key: string;
  /** The `when` scopes that overlap ("always" overlaps everything; a mode overlaps itself + "always"). */
  when: string;
  /** All actions bound to this key in overlapping scopes, in resolution order. */
  actions: BindableAction[];
  /** actions[0] — the one App.tsx's dispatch loop executes first. */
  winner: BindableAction;
}

export function validateKeybindings(
  bindings: KeyBinding[] = getResolvedBindings(),
): KeybindingConflict[];
```

Algorithm: normalize `key` (lowercase, sort modifiers in ctrl→shift→alt→meta order — reuse nothing fancier than a local helper); group bindings by normalized key; within a group, two bindings conflict when their `when` scopes intersect (`always` intersects all; `normalMode`/`insertMode` intersect themselves and `always`). Same-action duplicates are not conflicts. One `KeybindingConflict` per (key, intersecting set), `actions` in `getResolvedBindings()` order, `winner = actions[0]` (this matches the actual runtime: `getActionsForKey` returns matches in array order and the `App.tsx` switch returns on the first handled action).

Wire it: in `App.tsx`, inside an existing boot-time `useEffect` (anchor: near where `getResolvedBindings` is first exercised — the component body that calls `isVimModeEnabled()` at line 505 — add a mount-only effect), dispatch one notification per conflict through the EXISTING reducer action:

```ts
dispatch({ type: "INJECT_NOTIFICATION", notification: {
  id: `keybind-conflict-${conflict.key}`,
  type: "system:keybinding-conflict",
  variant: "system",
  message: `Key conflict: [${conflict.key}] runs "${conflict.winner}" — also bound to ${conflict.actions.slice(1).map(a => `"${a}"`).join(", ")}. Edit ~/.gordon/keybindings.json.`,
  timestamp: new Date().toISOString(),
}});
```

Also: EDIT `KeybindingWarnings.tsx` Props to `{ conflicts: KeybindingConflict[] }` with line format `⚠ Key conflict: [Ctrl+Shift+S] → "toggleStrictMode" wins over "sell-market"` and mount it at the top of `ShortcutsBrowser` (which already imports from `keybindings.ts`).

**(b) `<KeyboardHints/>`** — CREATE `src/tui/design-system/KeyboardHints.tsx`:

```ts
export interface KeyHint { keys: string; label: string; }   // keys: "esc", "↑↓", "enter", "ctrl+y", "?"
interface Props { hints: KeyHint[]; }
export function KeyboardHints({ hints }: Props): JSX.Element;
```

Renders one dim line: hints joined by ` · `, each as `<formatted-keys> <label>`. Reuse the platform-aware formatter: EXPORT `formatKeys` from `src/tui/design-system/KeyboardShortcutHint.tsx:18–35` (currently module-private) and pass through literal glyphs like `↑↓` untouched (formatKeys only transforms recognized names). Canonical copy, verbatim:
- Pickers/selects: `Esc cancel · ↑↓ navigate · Enter select` (deeper steps: `Esc back · ↑↓ navigate · Enter select`)
- Approval dialog: `↑↓ choose · Enter confirm · ? keys`
- Browsers with search: `type to filter · ↑↓ navigate · Esc clear/close`

Adopt on (replacing the existing ad-hoc dim hint line in each): `dialogs/ApprovalDialog.tsx` (all three variants), `dialogs/DiffDialog.tsx`, `browsers/ThemePicker.tsx`, `browsers/ShortcutsBrowser.tsx`, and the MultiStepPicker footer (item 29 — whichever lands second adapts). **Hints must list only keys the surrounding component actually handles** — verify each component's `useInput` before writing its hint line; do not advertise `y`/`n` quick-approve unless you verify the handler exists in that context.

**(c) Context-sensitive `?`:**
- `PromptInput` (`src/tui/components/layout/PromptInput.tsx`): new optional prop `onShowShortcuts?: () => void`. In its input handler, when the buffer is empty and the typed char is `?` and the prop is set: call it and swallow the keystroke (do not insert). Any non-empty buffer types `?` normally. `App.tsx` passes `onShowShortcuts={() => setShowShortcuts(true)}` ONLY while `pendingApprovals.length === 0` (anchor: the `<PromptInput`/`showShortcuts` wiring around `App.tsx:565` and `1770`).
- `ApprovalDialog`: add a component-level `useInput` handling exactly `input === "?"` → toggle local `showKeys` state, which expands the hints line into a short key reference block (the approval keys, not the full browser):

```
  ? keys —
    ↑↓        choose an option
    Enter     confirm selection
    Esc       (handled globally — cancels stream, not this approval)
```

While an approval is pending, `?` therefore routes to the approval reference (prompt handler is unwired in that state) — the review's "approval dialog shows approval keys, not the full browser" requirement.

**Files:**
- EDIT `src/tui/keybindings/keybindings.ts` (add `KeybindingConflict`, `validateKeybindings`)
- CREATE `src/tui/keybindings/validateKeybindings.test.ts`
- CREATE `src/tui/design-system/KeyboardHints.tsx`
- EDIT `src/tui/design-system/KeyboardShortcutHint.tsx` (export `formatKeys`)
- EDIT `src/tui/design-system/KeybindingWarnings.tsx` (consume `KeybindingConflict[]`, new line format)
- EDIT `src/tui/design-system/index.ts` (export `KeyboardHints`, `KeyHint`)
- EDIT `src/tui/App.tsx` (boot-time conflict notifications; gated `onShowShortcuts` pass-through)
- EDIT `src/tui/components/layout/PromptInput.tsx` (`onShowShortcuts` empty-buffer `?`)
- EDIT `src/tui/components/dialogs/ApprovalDialog.tsx` (`?` key reference; KeyboardHints line)
- EDIT `src/tui/components/dialogs/DiffDialog.tsx`, `browsers/ThemePicker.tsx`, `browsers/ShortcutsBrowser.tsx` (adopt KeyboardHints; ShortcutsBrowser also mounts KeybindingWarnings)

**Acceptance criteria:**
1. `bun test src/tui/keybindings` passes: a config with `bindings: [{key:"ctrl+p", action:"quickApprove"}]` yields one conflict `{key:"ctrl+p", winner:"togglePalette", actions:["togglePalette","quickApprove"]}` (default wins — defaults precede user bindings in `getResolvedBindings` order since the user binding overrode a DIFFERENT action); zero conflicts for the stock `DEFAULT_BINDINGS`; `escape`→`cancel`(always) vs `escape`→`vimEscape`(insertMode) IS reported (scopes intersect via "always").
2. Write `~/.gordon/keybindings.json` with a conflicting binding, launch TUI: a system notification appears naming the key and the winner.
3. `/shortcuts` shows the conflict warning block at top.
4. Empty prompt + `?` opens the shortcuts browser; typing `what?` does not.
5. With a pending approval on screen, `?` expands the approval key reference and does NOT open the shortcuts browser.
6. `bun tsc --noEmit -p tsconfig.json` clean; `bun test src/tui` green.

**Test plan:** `validateKeybindings.test.ts` (pure — pass binding arrays, no fs): no-conflict baseline over `DEFAULT_BINDINGS`; key normalization (`shift+ctrl+s` ≡ `ctrl+shift+s`); `when`-scope intersection matrix (always×normal, normal×insert disjoint, normal×normal); winner ordering; same-action duplicates ignored.

**Gotchas:**
- Work in `keybindings.ts` (BindableAction system) — NOT the unmounted `KeyContext`/resolver system in the same directory. Mounting `KeybindingProvider` is explicitly out of scope.
- `getResolvedBindings()` caches (`cachedBindings`, line 144) — `validateKeybindings()` with no args picks up the cache; tests must pass explicit arrays to stay fs-independent.
- `notificationFolder.ts` / retention logic processes notifications — use the exact `TuiNotification` shape from `src/tui/state/types.ts:23–30`.
- PromptInput's input path is the hot keystroke-echo path (latency item 6) — the `?` check must be a cheap guard at the top (`value === "" && input === "?"`), no allocation.
- Esc inside ApprovalDialog is genuinely not handled by the dialog today (GordonSelect ignores it) — hence the honest `?`-reference copy above. Don't add Esc-to-dismiss here; that's item 1/2 territory (P0 approval-state semantics).
- `ConfigurableShortcutHint` already resolves user-configured keys for single hints — `KeyboardHints` is for static per-dialog key sets; don't merge them.

---

### Item 33 — Vim-mode decision: scope it to the prompt (M, P5)

**Current state:**
- The vim engine (`src/tui/vim/` — `types.ts` FSM with `VimMode.Insert/Normal/Visual`, `motions.ts`, `operators.ts`, `textObjects.ts`, `transitions.ts`) is consumed ONLY by `PromptInput` (`src/tui/components/layout/PromptInput.tsx:11–17` imports; routing at lines 168–192; mode-aware prompt char `N`/`V` at lines 353–361; block-cursor switch at line 489).
- Enablement is global config: `isVimModeEnabled()` (`keybindings.ts:191–194`, from `vimMode` in `~/.gordon/keybindings.json`), read in `App.tsx:505` and passed to `PromptInput` (`App.tsx:2352`) and to `FooterHints`.
- The advertisement is global: `FooterHints.tsx:43–49` renders a magenta `[VIM]` badge in the status area whenever vim is enabled — implying app-wide modality. Vim-`when` bindings in `keybindings.ts` `DEFAULT_BINDINGS` (lines 110–117: `j/k/G/g` scroll in `normalMode`) route through `App.tsx`'s `getActionsForKey(keyCombo, vimMode)` (lines 897–898) where `vimMode` is just `isVimModeEnabled() ? "normalMode" : "always"` — i.e. it doesn't track the ACTUAL prompt vim mode, so these fire regardless of whether the user is in insert mode. Half-modality, precisely as the review said.

**Problem:** The badge promises modal editing everywhere; hjkl works only in the prompt (and the scroll bindings misfire on mode). For the vibe-trader audience a half-implemented global modality is a trust leak — and several single-key trading affordances (approval `y/n`, item 19's radar `a/p/d`) would collide with a real global normal-mode. **Decision: scope, don't extend.** (Extending is also sequenced behind item 10's single-`useInput` rewrite — building `useVimKeyboard` on today's 214-listener routing would be torn up immediately.)

**Spec:**

1. **Remove the global badge.** `FooterHints.tsx`: delete the `vimMode` prop (lines 16–17, 31) and the `[VIM]` render block (lines 43–49). Update the `FooterHints` call site in `App.tsx` (grep `<FooterHints`) to stop passing it.

2. **Render the indicator inside the prompt**, where the modality actually lives. In `PromptInput`, using the existing `isVimNormal`/`isVimVisual` flags (lines 353–354), render a right-aligned chip on the input row (`Spacer` from `../../ink-custom` then):
   - Normal: `[VIM NORMAL]` — color `theme.riskWarning` (yellow family; matches today's `N` prompt color)
   - Visual: `[VIM VISUAL]` — color `theme.variantAdvisor` (magenta family)
   - Insert with vim enabled: `[VIM]` dim — vim is on, you're inserting
   - Vim disabled: nothing.

   ASCII (vim enabled, normal mode):

```
 N  buy 0.1 btc on kraken█                                        [VIM NORMAL]
```

3. **Fix the misfiring scroll bindings.** In `App.tsx:897`, the `normalMode`/`always` selector must reflect the prompt's REAL mode, not mere enablement. `PromptInput` already owns `vimState`; lift the current mode out via a new optional callback prop `onVimModeChange?: (mode: "insert" | "normal" | "visual") => void`, called from the existing `setVimState` transitions (lines 168–192). `App.tsx` stores it in a `useRef` (not state — no re-render needed; this is read inside the `useInput` callback at line 885) and computes `const vimMode = isVimModeEnabled() && vimModeRef.current !== "insert" ? "normalMode" : "always"`. Result: `j/k/g/G` scroll only fires when the prompt is genuinely in normal/visual mode.

4. **Honest copy everywhere vim is described:**
   - `keybindings.ts` `formatKeybindingHelp` (lines 211–217): group labels `"Vim Normal Mode"` → `"Vim — prompt input (Normal mode)"`, `"Vim Insert Mode"` → `"Vim — prompt input (Insert mode)"`.
   - `ShortcutsBrowser.tsx:28`: same relabel (`"Vim Normal"` → `"Vim — prompt (Normal)"`, `"Vim Insert"` → `"Vim — prompt (Insert)"`).
   - `src/tui/services/suggestions/tips.ts`: grep `vim` — if any tip implies global vim, reword to `Vim mode edits the prompt input. Enable it in ~/.gordon/keybindings.json ("vimMode": true).`

5. **Explicit non-goal:** no `useVimKeyboard` hook, no vim in scrollback/pickers/dialogs. If a future operator decision extends vim, it happens AFTER item 10 (FocusContext single-`useInput`), as a new backlog item. Record this in the PR description so the half-modality isn't "re-fixed" in the extend direction by a later agent.

**Files:**
- EDIT `src/tui/components/layout/FooterHints.tsx` (delete `vimMode` prop + badge)
- EDIT `src/tui/components/layout/PromptInput.tsx` (mode chip; `onVimModeChange` callback)
- EDIT `src/tui/App.tsx` (FooterHints call site; `vimModeRef` + corrected mode selector at the `getActionsForKey` call, lines 897–898)
- EDIT `src/tui/keybindings/keybindings.ts` (`formatKeybindingHelp` labels)
- EDIT `src/tui/components/browsers/ShortcutsBrowser.tsx` (group labels)
- EDIT `src/tui/services/suggestions/tips.ts` (copy, if a global-vim tip exists)

**Acceptance criteria:**
1. `grep -n "VIM" src/tui/components/layout/FooterHints.tsx` returns nothing; `grep -n "vimMode" src/tui/components/layout/FooterHints.tsx` returns nothing.
2. Manual, with `"vimMode": true` in `~/.gordon/keybindings.json`: prompt shows dim `[VIM]`; press Esc → chip becomes `[VIM NORMAL]` and prompt char `N`; `v` → `[VIM VISUAL]`; `i` → back to dim `[VIM]`. No vim indicator anywhere outside the prompt row.
3. Manual: in INSERT mode with vim enabled, typing `j` inserts the character `j` and does not scroll; in NORMAL mode, `j` scrolls (the `App.tsx` selector fix).
4. `/shortcuts` shows the `Vim — prompt (Normal)` group label.
5. With `"vimMode"` absent/false: zero visual change vs today except the removed footer badge.
6. `bun tsc --noEmit -p tsconfig.json` clean; `bun test src/tui` green.

**Gotchas:**
- `PromptInput` is the keystroke-echo hot path and item 6's memo-isolation target: `onVimModeChange` must be called only on actual mode TRANSITIONS (guard `result.newState.mode !== vimState.mode`), and App must hold it in a `useRef` — a `useState` here would re-render the whole `AppInner` per mode switch and regress item 6.
- The `N`/`V` prompt char and block-cursor logic (lines 353–361, 489) already encode mode — the chip ADDS to them; don't replace them.
- The `KeyContext.Scroll` bindings in `keybindings/defaultBindings.ts:33–38` belong to the UNMOUNTED resolver system — ignore them; only `keybindings.ts` `DEFAULT_BINDINGS` `when:"normalMode"` entries are live.
- `theme.variantAdvisor`/`theme.riskWarning` via `useTheme()` per items 28/30 — don't introduce new `"magenta"`/`"yellow"` literals (the item-28 lint will catch you).
- Don't delete `src/tui/vim/` anything — the engine is sound and fully used by the prompt; only its advertisement changes.
