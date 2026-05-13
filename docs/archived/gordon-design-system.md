# Gordon Design System

The definitive visual language for the Gordon trading terminal. Every component — existing and future — follows these rules. This document governs the 99 current TUI files, the 89 planned additions, and everything built after.

Gordon is a CLI trading desk. Not a chat app with trading bolted on. Every design decision serves one goal: **the trader makes better decisions faster**.

---

## 1. Design Philosophy

### 1.1 Terminal-Native, Not Terminal-Compromised

The terminal is not a limitation — it's the medium. Gordon embraces terminal constraints the way Bloomberg embraces its keyboard. Every design choice optimizes for:

- **Scanability** — the trader glances and knows the state in <1 second
- **Density** — more information per row than any GUI can achieve
- **Keyboard sovereignty** — every action is one shortcut away, mouse is optional
- **Monospace precision** — columns align perfectly, numbers snap to grids
- **Session persistence** — the terminal never forgets, scrollback is infinite memory

### 1.2 The Three Speeds

Gordon operates at three distinct temporal speeds. The design adapts to each:

| Speed | Context | Design Response |
|---|---|---|
| **Glance** (0.2s) | Trader scans P&L, position status, alerts | High-contrast badges, color-coded numbers, status icons |
| **Read** (2-5s) | Trader reads analysis, reviews plan, checks risk | Structured layout, clear hierarchy, grouped information |
| **Work** (30s+) | Trader configures strategy, reviews backtest, writes playbook | Full-screen panels, tabs, forms, scrollable content |

### 1.3 Information Hierarchy

Every screen follows this layered priority:

```
Layer 1: MONEY           What's my P&L? Am I losing money right now?
Layer 2: RISK            Am I about to lose money? What's my exposure?
Layer 3: ACTION          What needs my attention? What's pending?
Layer 4: CONTEXT         What's the market doing? What did the agent find?
Layer 5: CHROME          Navigation, shortcuts, session info, decoration
```

Layer 1 is always visible. Layer 5 is always dimmed. A trader at a glance sees money first.

---

## 2. Color System

### 2.1 Palette

Gordon uses a constrained palette. Every color has a meaning. No color is decorative.

**Semantic Colors (Primary):**

| Token | Hex/ANSI | Usage | Rule |
|---|---|---|---|
| `money.profit` | `green` | Positive P&L, successful fills, winning trades | Never used for non-money contexts |
| `money.loss` | `red` | Negative P&L, stop triggers, losing trades | Never used for non-money contexts |
| `money.neutral` | `white` | Zero P&L, flat positions, unchanged | Default for monetary amounts with no direction |
| `risk.safe` | `green` | Risk check passed, within limits | Paired with check icon |
| `risk.warning` | `yellow` | Approaching limit, needs attention | Paired with triangle icon |
| `risk.danger` | `red` | Limit breached, action required | Paired with cross icon |
| `risk.critical` | `redBright` + `bold` | Emergency, position liquidation | Double-bordered, blinking |
| `agent.primary` | `cyanBright` | Gordon (main agent), primary UI elements | Brand color |
| `agent.scanner` | `cyan` | Scanner agent | Agent badge color |
| `agent.analyst` | `blue` | Analyst agent | Agent badge color |
| `agent.planner` | `magenta` | Planner agent | Agent badge color |
| `agent.executor` | `yellow` | Executor agent | Agent badge color |
| `agent.monitor` | `green` | Monitor agent | Agent badge color |
| `agent.critic` | `red` | Critic agent | Agent badge color |
| `signal.buy` | `greenBright` + `bold` | Buy signal, long entry | Direction indicator |
| `signal.sell` | `redBright` + `bold` | Sell signal, short entry | Direction indicator |
| `signal.neutral` | `gray` | No signal, wait | Direction indicator |
| `ui.brand` | `cyanBright` | Prompts, headers, active elements | Primary interactive color |
| `ui.muted` | `dim` | Secondary info, timestamps, chrome | De-emphasized content |
| `ui.border` | `gray` | Panel borders, dividers | Structural elements |
| `ui.surface` | (default bg) | Content background | No explicit color |
| `ui.elevated` | (slight contrast) | Dialogs, overlays | Subtle distinction |

**The Money Rule:** Green and red are RESERVED for money and risk. Never use green for "success" in a non-financial context (use cyan). Never use red for "error" in a non-financial context (use `redBright` + italic). This prevents the trader's eye from confusing a UI error with a trading loss.

### 2.2 Daltonized Palette (Colorblind-Safe)

For deuteranopia/protanopia users, green/red is replaced:

| Standard | Daltonized | Reasoning |
|---|---|---|
| `green` (profit) | `blueBright` (profit) | Blue is safe for all color vision types |
| `red` (loss) | `yellow` (loss) | Yellow/blue is the highest-contrast safe pair |
| `yellow` (warning) | `magenta` (warning) | Avoids yellow/loss collision |

Activated via `/theme dark-daltonized` or auto-detected from OS accessibility settings.

### 2.3 Color Application Rules

1. **Numbers with direction get color.** +$142 is green. -$28 is red. $0 is white.
2. **Percentages follow their number.** +2.3% is green. -1.1% is red.
3. **Icons reinforce color.** Never rely on color alone. Always pair with shape: `+` profit, `-` loss, `!` warning, `x` error, `~` pending.
4. **Dimming is the primary de-emphasis.** Don't use gray text — use `dimColor`. It respects all themes.
5. **Bold is reserved for:** current price, active position symbol, focused element, mode indicator, and headings. Nothing else.
6. **Inverse (reverse video) is reserved for:** mode badges, critical alerts, search highlights, selected items.

---

## 3. Typography

### 3.1 Text Hierarchy

The terminal has one font, one size. Hierarchy comes from weight, color, and spacing.

```
LEVEL 1 — Section Header
  Bold + color + uppercase + horizontal rule below
  Example: ── OPEN POSITIONS ──────────────────────────

LEVEL 2 — Subsection / Label
  Bold + default color
  Example: Risk Assessment

LEVEL 3 — Key-Value Label
  Dimmed label, bright value
  Example: Entry  $48,250.00

LEVEL 4 — Body Text
  Default color, default weight
  Example: BTC showing bullish divergence on 4H...

LEVEL 5 — Metadata / Chrome
  Dimmed
  Example: 3m ago · Scanner · 1.2k tokens
```

### 3.2 Number Formatting

Trading terminals live and die by number readability.

| Type | Format | Example | Rule |
|---|---|---|---|
| Price (crypto) | Comma-separated, 2-8 decimals based on magnitude | `$48,250.00` / `$0.00004521` | Match exchange precision |
| Price (stock) | Comma-separated, 2 decimals | `$187.42` | Always 2 decimals |
| Quantity | Up to 8 decimals, strip trailing zeros | `0.15` / `1,250` | No unnecessary precision |
| P&L (absolute) | Sign prefix, comma-separated, 2 decimals | `+$1,423.50` / `-$287.00` | Always show sign |
| P&L (percent) | Sign prefix, 1-2 decimals, % suffix | `+12.3%` / `-2.1%` | Always show sign |
| Percentage | No sign, 1 decimal, % suffix | `67.4%` | Unsigned for ratios |
| Token count | K/M suffix for large numbers | `12.4k` / `1.2M` | Human-readable |
| Cost (USD) | Dollar sign, 2 decimals | `$0.42` | API cost tracking |
| Duration | Adaptive: `3.2s` / `2m 14s` / `1h 30m` / `2d 5h` | Match scale to value | No seconds after 10m |
| Timestamp | Relative: `3m ago` / `2h ago` / `yesterday` | Relative within 48h | Absolute after 48h: `Mar 15` |

### 3.3 Alignment Rules

```
RIGHT-ALIGN: All numbers, prices, quantities, percentages, P&L
LEFT-ALIGN:  All text, symbols, names, descriptions, status labels
CENTER:      Nothing. Center alignment looks broken in terminals.
```

Column widths in tables are fixed, not dynamic. This prevents layout shift when data changes. A price column is always 12 characters wide, whether the price is `$0.01` or `$99,999.99`.

---

## 4. Layout System

### 4.1 Terminal Zones

The terminal is divided into four zones from top to bottom:

```
┌─────────────────────────────────────────────────────┐
│ HEADER ZONE (2-3 rows)                              │
│ Gordon CLI v0.8 · ask · BTC/USDT · 3 positions     │
├─────────────────────────────────────────────────────┤
│                                                     │
│ CONTENT ZONE (fills remaining space)                │
│                                                     │
│ Messages, analysis, trade plans, charts,            │
│ renderers, dialogs — all render here.               │
│ Scrollable via j/k/PgUp/PgDn/G/gg.                 │
│                                                     │
│ ↓ 3 new messages                                    │
├─────────────────────────────────────────────────────┤
│ STATUS ZONE (1 row)                                 │
│ $0.42 tok · +$142 P&L · 3 trades · daemon: ● · 12m │
├─────────────────────────────────────────────────────┤
│ INPUT ZONE (1-6 rows)                               │
│ ▸ /scan btc█                          ask · Ctrl+P  │
│   ▸ /scan — Scan markets for opportunities          │
│     /scanner — Configure scanner settings           │
└─────────────────────────────────────────────────────┘
```

**Rules:**
- Header is always visible, never scrolls
- Content zone is the only scrollable area
- Status zone is always visible, always 1 row
- Input zone expands for typeahead (1-6 rows), never scrolls
- Overlays (dialogs, pickers) float above content zone
- No horizontal scrolling ever — content wraps or truncates

### 4.2 Responsive Breakpoints

The layout adapts to terminal width:

| Width | Layout | Changes |
|---|---|---|
| < 60 cols | **Compact** | Header collapses to 1 row, status hides non-essential items, tables truncate columns |
| 60-100 cols | **Standard** | Full header, all status items, standard table widths |
| 100-140 cols | **Wide** | Preview panes appear beside pickers, diff shows side-by-side |
| > 140 cols | **Ultra-wide** | Split view possible, full-width tables with all columns |

### 4.3 Panel Patterns

**Inline Panel** — renders in the message flow, scrolls with content:
```
── RISK ASSESSMENT ──────────────────────────
  Position Size  ████████░░  78%  ✓ within limit
  Daily Loss     ██░░░░░░░░  18%  ✓ within limit
  Drawdown       ██████░░░░  62%  ⚠ approaching limit
  Leverage       █░░░░░░░░░   8%  ✓ within limit
─────────────────────────────────────────────
```

**Floating Dialog** — overlays content, has border, captures input:
```
╭─ EMERGENCY HALT ─────────────────────────╮
│                                          │
│  ⚠ This will immediately:               │
│    • Close 3 open positions              │
│    • Cancel 2 pending orders             │
│    • Disarm all strategies               │
│                                          │
│  This action is IRREVERSIBLE.            │
│                                          │
│  Confirm in 3s...                        │
│                                          │
│  ▸ CONFIRM EMERGENCY HALT               │
│    Cancel                                │
╰──────────────────────────────────────────╯
```

**Pane** — bordered section within the message flow:
```
┌ Analysis ────────────────────────────────┐
│ BTC/USDT · Trending · Confidence: 82%   │
│                                          │
│ Support   $47,800  $46,200  $44,500      │
│ Resist    $49,100  $51,000  $53,200      │
│                                          │
│ RSI: 62 (neutral)  MACD: bullish cross   │
│ Trend: ↑ UP · Bias: LONG                │
│ ▁▂▃▄▅▆▇█▇▆▅▆▇█▇▆▅▄▃▄▅▆▇              │
└──────────────────────────────────────────┘
```

### 4.4 Spacing Rules

- **Between messages:** 1 blank line
- **Between sections within a renderer:** 0 blank lines (tightly packed)
- **Between grouped items (positions, strategies):** 0 blank lines
- **Above/below panel borders:** 0 blank lines
- **Indent for tree structures:** 2 spaces per level
- **Padding inside bordered panels:** 1 space left/right (built into border)

Density is a feature. Whitespace is the enemy of a trading terminal. Every empty row is a row that could show a price.

---

## 5. Component Patterns

### 5.1 Message Variants

Every message in the conversation has a variant that determines its visual treatment:

```
USER MESSAGE:
  ❯ scan btc for breakout setups
  
GORDON RESPONSE:
  ● GORDON · Scanner · 3.2s
  [rendered content — analysis, tables, charts]

FILL NOTIFICATION:
  ✓ FILL · 3m ago
  Bought 0.15 BTC @ $48,250 · Total: $7,237.50

STOP TRIGGERED:
  ✗ STOP · 1m ago  
  Stopped out: 0.15 BTC @ $47,100 · Loss: -$172.50

ALERT:
  ! ALERT · just now
  BTC approaching resistance at $49,100 (current: $48,950)

STRATEGY SIGNAL:
  ◈ SIGNAL · Scanner · 2m ago
  Squeeze breakout detected on ETH/USDT (4H)

SYSTEM:
  ─ Session resumed · 24 messages · thread_abc123

APPROVAL:
  ⚠ APPROVAL [a3f2]
  place_market_order: BUY 0.15 BTC @ market (~$48,250)
  Risk: ✓ Size OK · ✓ Daily OK · ⚠ Drawdown 4.2%
  ▸ Allow this time
    Always allow place_market_order
    Deny

ERROR:
  ✗ ERROR
  Binance API rate limit exceeded. Retrying in 3s...

ADVISOR:
  ◉ ADVISOR
  Risk/reward ratio of 1.8 is below the 2.0 threshold...

HANDOFF:
  → Handing off to Analyst
```

**Variant Rules:**
- Badge is always first: icon + name + agent (if applicable) + timestamp
- Badge line is colored per variant, body is default color
- Timestamp is relative, dimmed, right of badge name
- Body content uses appropriate renderer (RichContent auto-detects)

### 5.2 Status Indicators

Consistent status vocabulary across all components:

```
●  Running / Active / Connected     (colored by context)
○  Pending / Queued / Waiting       (gray)
✓  Success / Passed / Filled        (green or cyan)
✗  Failed / Blocked / Rejected      (red)
⚠  Warning / Approaching / Caution  (yellow)
◈  Signal / Opportunity / Strategy  (cyan)
◉  Special / Advisor / Highlighted  (magenta)
↑  Up / Bull / Long / Increase      (green)
↓  Down / Bear / Short / Decrease   (red)
→  Handoff / Transfer / Navigate    (cyan)
↻  Retry / Refresh / Reload         (yellow)
⏸  Paused / Suspended               (yellow)
```

### 5.3 Progress Bars

Sub-character precision using Unicode blocks:

```
Full bar:     ████████████████████  100%
Three-quarter:████████████████░░░░   78%
Half:         ██████████░░░░░░░░░░   50%
Quarter:      █████░░░░░░░░░░░░░░░   25%
Near-zero:    ▏░░░░░░░░░░░░░░░░░░░    2%
Empty:        ░░░░░░░░░░░░░░░░░░░░    0%

Sub-character glyphs (8 levels):
  ░ (empty) ▏ ▎ ▍ ▌ ▋ ▊ ▉ █ (full)
```

**Color rules for progress bars:**
- Risk gauges: green → yellow (at 60%) → red (at 80%)
- P&L bars: green for profit direction, red for loss direction
- Fill progress: cyan (brand color)
- Context budget: cyan → yellow (at 60%) → red (at 80%)

### 5.4 Tables (DataTable Pattern)

Tables are borderless, dense, and aligned. No box-drawing characters.

```
SYM         LAST        CHG%      VOL        SIGNAL
BTC/USDT    $48,250    +2.3%    $1.2B    ◈ BREAKOUT
ETH/USDT     $3,180    +1.8%    $890M    ● NEUTRAL
SOL/USDT      $142     -0.4%    $320M    ↓ BEARISH
────────────────────────────────────────────────────
3 symbols scanned · 1 opportunity · 2.1s
```

**Table rules:**
- Header row is bold, NO border below (just spacing)
- Summary row gets a thin dash separator above
- Right-align all numbers
- Color applies to the cell value only, not the whole row
- Fixed column widths prevent layout shift
- Max 8 columns at standard width (60-100 cols)
- Truncate with `…` for text columns, never for numbers

### 5.5 Sparklines & Charts

```
Uptrend:    ▁▂▃▃▄▅▆▇█▇██  (green)
Downtrend:  █▇▆▅▄▃▂▁▁▂▁▁  (red)
Volatile:   ▃▇▂█▄▆▁▇▃▅▂▇  (yellow)
Flat:       ▄▄▄▅▄▄▅▄▄▄▅▄  (gray)

8 levels: ▁ ▂ ▃ ▄ ▅ ▆ ▇ █
```

Chart color is determined by start-to-end direction, not intermediate movement. If the first value is lower than the last, it's green (uptrend). This matches trader intuition.

### 5.6 Approval Tiers

Three visual tiers match risk escalation:

**Tier 1 — Standard (low/medium risk):**
```
⚠ APPROVAL [a3f2]
  Tool: get_candles
  ▸ Allow this time
    Always allow get_candles
    Deny
```
Inline, no border. Minimal visual weight. Quick approve-and-move-on.

**Tier 2 — High Risk:**
```
┌─ ⚠ HIGH RISK ────────────────────────────┐
│ Tool: place_market_order                  │
│ BUY 0.15 BTC @ market (~$48,250)         │
│                                           │
│ Risk: ✓ Size ✓ Daily ⚠ Drawdown 4.2%     │
│                                           │
│ ▸ Allow this time                         │
│   Always allow place_market_order         │
│   Deny                                    │
└───────────────────────────────────────────┘
```
Single border, yellow header. Forces the trader to read before acting.

**Tier 3 — Critical (irreversible):**
```
╔═ ⛔ CRITICAL ═══════════════════════════════╗
║                                             ║
║  place_market_order                         ║
║  SELL 100% BTC position @ market            ║
║  Estimated proceeds: $48,250                ║
║                                             ║
║  Risk: ✗ Full liquidation · ⚠ Slippage      ║
║                                             ║
║  Confirm in 3s...                           ║
║                                             ║
║  ▸ CONFIRM (unlocks in 3s)                  ║
║    Cancel                                   ║
╚═════════════════════════════════════════════╝
```
Double border, red header, 3-second countdown lock. Cannot rush through. The trader MUST wait and read.

---

## 6. Animation System

### 6.1 Animation Types

Gordon uses four animation types. Each has a distinct purpose and never overlaps with another's meaning.

**Shimmer** — streaming/loading/thinking:
```
Frame 1: G o r d o n   i s   a n a l y z i n g . . .
Frame 2: G o r d o n   i s   a n a l y z i n g . . .
                              ^^^^^^
                              bright sweep moves left-to-right
```
- Speed: 50ms per character during active streaming, 200ms during processing
- Color: brand cyan shimmer on default text
- Stops when: response completes or stalls

**Blink** — critical alert, needs attention:
```
Frame 1: ⚠ MARGIN CALL — Deposit required
Frame 2: (hidden)
```
- Period: 800ms on, 800ms off
- Color: red for critical, yellow for warning
- Stops when: acknowledged or resolved
- All blink instances synchronize from a shared clock

**Stall** — something is stuck, red ramp:
```
0-3s:   ● GORDON · Analyst (normal cyan)
3-5s:   ● GORDON · Analyst (yellow — getting slow)
5-10s:  ● GORDON · Analyst (red — stalled, intensity increases)
10s+:   ● GORDON · Analyst (bright red — definitely stuck)
```
- Ramp: linear intensity increase from 3s to 10s
- Color: cyan → yellow → red
- Resets on: any new data received

**Pulse** — heartbeat, still alive:
```
Frame 1: ●  (visible)
Frame 2: ·  (dimmed)
```
- Period: 400ms
- Used for: loading states, pending items, connection health
- Subtle — should not draw attention, just confirm liveness

### 6.2 Animation Rules

1. **Maximum 2 animations visible at once.** If more, the oldest pauses.
2. **All animations pause when terminal is blurred.** No wasted CPU when trader isn't looking.
3. **Offscreen animations freeze.** Components scrolled out of view stop animating.
4. **Animations share a global 50ms clock** via `useAnimationFrame`. No independent setIntervals.
5. **No animation on user content.** User messages, P&L numbers, prices — never animate. Only agent/system UI animates.

---

## 7. Interaction Patterns

### 7.1 Input Modes

The prompt indicates its current mode:

```
Normal chat:     ❯ what's the outlook for ETH?█
Slash command:   / scan█                          (suggestions appear above)
Vim normal:      [N] █                            (mode badge at left)
Vim insert:      [I] analyzing the breakout on█   (mode badge at left)
Search:          / btc█                           (search mode in transcript)
```

### 7.2 Keyboard Hierarchy

Three tiers of keyboard access, matching frequency of use:

**Tier 1 — Single Key (most frequent):**
```
Enter     Submit / Confirm
Escape    Cancel / Close / Clear
↑↓        Navigate lists / Scroll
Tab       Complete / Next field
y/n       Quick approve/deny (in approval context)
j/k       Vim-style scroll (in scroll context)
/         Search (in scroll context)
?         Toggle help
```

**Tier 2 — Ctrl+Key (frequent):**
```
Ctrl+P    Command palette
Ctrl+R    History search
Ctrl+B    Background current task
Ctrl+C    Cancel (double-press to exit)
Ctrl+D    Exit (double-press)
Ctrl+E    Expand/collapse
Ctrl+Z    Undo input
```

**Tier 3 — Ctrl+Shift+Key (less frequent):**
```
Ctrl+Shift+F    Global search
Ctrl+Shift+P    Privacy toggle
Ctrl+Shift+X    Emergency halt
Ctrl+Shift+B    Buy market (order context)
Ctrl+Shift+S    Sell market (order context)
```

### 7.3 Confirmation Patterns

Matches action severity:

| Severity | Pattern | Example |
|---|---|---|
| **Reversible** | Single Enter | Switch tab, open dialog, change setting |
| **Meaningful** | Select from options | Approve tool call, choose strategy |
| **Consequential** | Double-press Enter | Place order, deploy strategy |
| **Irreversible** | 3-second countdown + confirm | Emergency halt, close all positions |

### 7.4 Navigation Within Panels

Consistent across all scrollable/selectable panels:

```
↑/↓ or j/k     Move selection
Enter           Activate / Open detail
Escape          Close panel / Go back
Space           Toggle / Expand detail
Tab             Next section / Next tab
Shift+Tab       Previous section / Previous tab
/ (slash)       Filter / Search within panel
g               Jump to top
G               Jump to bottom
```

### 7.5 Notification Flow

Notifications follow a priority → position → duration model:

```
Priority    Position         Duration        Example
─────────────────────────────────────────────────────────
Critical    Overlay banner   Until dismissed  Margin call
High        Below header     30 seconds       Stop triggered  
Medium      In message flow  15 seconds       Fill completed
Low         In message flow  8 seconds        Scan finished
Info        Status bar       5 seconds        Settings saved
```

Notifications fold when multiple of the same type arrive within 5s:
```
Instead of:  ✓ Filled BTC 0.05 @ $48,250
             ✓ Filled BTC 0.05 @ $48,251
             ✓ Filled BTC 0.05 @ $48,249

Show:        ✓ 3 fills: BTC (+0.15 total) @ avg $48,250
```

---

## 8. Trading-Specific UX Patterns

### 8.1 The Glance Dashboard

When the trader returns to the terminal or glances during active trading, the status zone + header give a complete snapshot:

```
Header:   Gordon CLI v0.8 · ask · 3 positions · +$142 · ◈ 1 strategy
Status:   $0.42 tok · +$142 P&L · 3 trades · daemon: ● · feeds: 3 live · 12m
```

This is the Bloomberg "green bar" equivalent. It answers: Am I making money? Is everything running? How long have I been here?

### 8.2 Position-First Rendering

When positions exist, they're always accessible:
- `/positions` shows the full table
- LivePositions can auto-show after fills
- P&L is in the status bar at all times
- Position count is in the header

### 8.3 Risk Visualization

Risk is always comparative, never absolute:

```
BAD:   Drawdown: 4.2%
GOOD:  Drawdown  ████░░░░░░  4.2% / 5.0%  ⚠ approaching
```

The bar shows magnitude. The fraction shows limit proximity. The icon shows urgency. All three reinforce the same message through different channels.

### 8.4 Trade Plan Ticket

Every trade plan renders as a structured ticket (not prose):

```
── TRADE PLAN ─────────────────────────────
  BTC/USDT          LONG
  Entry     $48,250
  Stop      $47,100     (-2.4%)
  Target 1  $49,500     (+2.6%)   R:R 1.1
  Target 2  $51,000     (+5.7%)   R:R 2.4
  Size      0.15 BTC    ($7,237)
  Risk      $172.50     (0.86% of portfolio)
  Venue     Binance     Limit order
  Review    ● PENDING APPROVAL
────────────────────────────────────────────
```

This matches how professional traders think: levels, size, risk, venue. Not paragraphs.

### 8.5 Fill Confirmation

Fills are the most important trading event. They're designed to be unmistakable:

```
✓ FILLED · BTC/USDT · Binance · just now
  BOUGHT 0.15 BTC @ $48,250.00
  Total: $7,237.50 · Fee: $7.24 (0.10%)
  Position: 0.15 BTC · Entry avg: $48,250.00
```

- Green check icon (unmistakable positive)
- Exchange name (which venue)
- Timestamp (when)
- Full details on separate lines
- Running position summary below

### 8.6 Agent Reasoning Display

When the agent thinks through a trade, show the reasoning transparently:

```
 THINKING · Planner · 2.1s
  Evaluating BTC breakout: volume confirms (+40% above
  20-day avg), RSI 62 (not overbought), MACD bullish
  cross 2 bars ago. Risk/reward to $49.5k target is
  1.1:1 — marginal. Extending to $51k target improves
  to 2.4:1...
```

- Inverse "THINKING" badge
- Dimmed reasoning text (Layer 4 — context, not action)
- Truncated to 6 lines, expandable
- Shows elapsed time (trader knows if agent is slow)

### 8.7 Emergency States

Emergency halt is the "break glass" moment. Maximum visual severity:

```
╔══════════════════════════════════════════════╗
║  ⛔ EMERGENCY HALT                            ║
║                                              ║
║  Closing 3 positions:                        ║
║    BTC/USDT  LONG   0.15  →  MARKET SELL     ║
║    ETH/USDT  LONG   2.00  →  MARKET SELL     ║
║    SOL/USDT  SHORT  50.0  →  MARKET BUY      ║
║                                              ║
║  Cancelling 2 pending orders                 ║
║  Disarming all strategies                    ║
║                                              ║
║  Estimated proceeds: ~$12,450                ║
║  Estimated slippage: ~$35-80                 ║
║                                              ║
║  ▸ CONFIRM (3s...)                           ║
║    Cancel                                    ║
╚══════════════════════════════════════════════╝
```

Double border, red everything, countdown timer, cannot be rushed. Shows exactly what will happen.

---

## 9. Theme Architecture

### 9.1 Theme Token Structure

Every theme provides values for these tokens. Components use tokens, never raw colors.

```typescript
interface GordonTheme {
  // Money (most important)
  moneyProfit: Color;
  moneyLoss: Color;
  moneyNeutral: Color;
  
  // Risk
  riskSafe: Color;
  riskWarning: Color;
  riskDanger: Color;
  riskCritical: Color;
  
  // Signals
  signalBuy: Color;
  signalSell: Color;
  signalNeutral: Color;
  
  // Agents (10 agents)
  agentGordon: Color;
  agentScanner: Color;
  agentAnalyst: Color;
  agentPlanner: Color;
  agentExecutor: Color;
  agentMonitor: Color;
  agentTeacher: Color;
  agentBacktester: Color;
  agentCritic: Color;
  agentAuditor: Color;
  
  // UI Chrome
  uiBrand: Color;
  uiMuted: Color;
  uiBorder: Color;
  uiSurface: Color;
  uiElevated: Color;
  uiFocus: Color;
  uiSelection: Color;
  
  // Diff
  diffAdded: Color;
  diffRemoved: Color;
  diffAddedWord: Color;
  diffRemovedWord: Color;
  
  // Charts
  chartUp: Color;
  chartDown: Color;
  chartVolume: Color;
  chartGrid: Color;
  
  // Progress bars
  progressFill: Color;
  progressEmpty: Color;
  progressWarning: Color;
  progressDanger: Color;
  
  // Shimmer animation
  shimmerBase: Color;
  shimmerHighlight: Color;
  
  // Rate limits
  rateLimitFill: Color;
  rateLimitEmpty: Color;
  
  // Message variants
  variantFill: Color;
  variantStop: Color;
  variantAlert: Color;
  variantStrategy: Color;
  variantError: Color;
  variantSystem: Color;
  variantAdvisor: Color;
}
```

### 9.2 Built-in Themes

| Theme | Primary | Profit/Loss | Use Case |
|---|---|---|---|
| `dark` | cyanBright | green/red | Default, most terminals |
| `light` | cyan | green/red | Light terminal backgrounds |
| `dark-daltonized` | cyanBright | blue/orange | Colorblind users, dark bg |
| `light-daltonized` | cyan | blue/orange | Colorblind users, light bg |
| `dark-high-contrast` | whiteBright | greenBright/redBright | Poor lighting, glare |
| `light-high-contrast` | black | greenBright/redBright | Maximum readability |

---

## 10. Responsive Patterns

### 10.1 Width Adaptation

Components adapt their content, not their layout:

**Narrow (< 60 cols):**
```
❯ BTC +2.3% $48.2k ●
  3 pos · +$142
```

**Standard (60-100 cols):**
```
❯ Gordon CLI v0.8 · ask · BTC/USDT · 3 positions · +$142.50
  $0.42 tok · +$142 P&L · 3 trades · daemon: ● running · 12m
```

**Wide (100-140 cols):**
```
❯ Gordon CLI v0.8 · The Frontier Trading Agent · ask mode
  Session: thread_abc123 · 3 positions · +$142.50 P&L · daemon: ● running · 12m 34s
```

### 10.2 Table Column Priority

When terminal is too narrow for all columns, drop in this order (last dropped first):

```
Priority 1 (always show): Symbol, P&L
Priority 2 (show if room): Last Price, Change%
Priority 3 (show if wide):  Volume, Entry, Quantity
Priority 4 (only ultra-wide): Duration, Stop, Target, Fee
```

### 10.3 Height Adaptation

```
< 20 rows:   Compact mode — no header, 1-line status, minimal chrome
20-40 rows:  Standard — full header, status bar, input with typeahead
> 40 rows:   Spacious — inline help visible, more typeahead suggestions
```

---

## 11. Accessibility

### 11.1 Screen Reader Compatibility

- All status icons have text equivalents: `✓` is also "passed", `✗` is also "failed"
- Color is never the sole indicator — always paired with icon/text
- Progress bars include percentage text: `████░░ 60%`
- Animations can be disabled via `settings.reduceMotion`

### 11.2 Colorblind Safety

- Daltonized themes replace all green/red with blue/orange
- Critical indicators use shape + brightness, not just hue
- Diff rendering uses `+`/`-` prefix in addition to color
- Chart direction uses `↑`/`↓` arrows alongside color

### 11.3 Keyboard-Only Operation

Every action is achievable via keyboard. Mouse text selection and copy are bonuses, never requirements. The complete interaction model works without a mouse.

---

## 12. Component Checklist

When building or modifying any Gordon TUI component, verify:

- [ ] Uses theme tokens, not raw colors
- [ ] Numbers are right-aligned and formatted per Section 3.2
- [ ] Respects the information hierarchy (money first)
- [ ] Green/red only used for financial direction
- [ ] Has keyboard navigation (arrow keys, Enter, Escape at minimum)
- [ ] Registers with overlay context if it captures input
- [ ] Uses Ratchet wrapper if content height varies
- [ ] Animations use shared clock via `useAnimationFrame`
- [ ] Pauses animations when offscreen or terminal blurred
- [ ] Adapts at responsive breakpoints (60/100/140 cols)
- [ ] Dimmed text uses `dimColor`, not explicit gray
- [ ] Bold reserved for headings, prices, focused elements only
- [ ] Status icons follow the vocabulary in Section 5.2
- [ ] Uses ConfigurableShortcutHint for any displayed shortcuts
