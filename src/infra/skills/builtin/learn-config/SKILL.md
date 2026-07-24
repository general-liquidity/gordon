---
name: learn-config
description: How to configure Gordon — GORDON.md, settings layers, keybindings, and model aliases. When user asks "how do I configure Gordon?", "where's GORDON.md?", "how do I change settings?", or about customization and keybindings
tags: [learning, config, settings, customization]
user-invocable: true
status: active
last-reviewed: 2026-05-23
---

Gordon has multiple configuration layers. Here's how they work.

## GORDON.md (Personality File)

Write your trading personality in markdown. Gordon reads this at session start.

### Where to put it
1. `~/.gordon/GORDON.md` — global (your universal rules)
2. `.gordon/GORDON.md` — project-specific (per-strategy rules)
3. `GORDON.md` — project root (shared with team)

Later files override earlier ones (project > user).

### What to put in it
```markdown
# My Trading Rules

## Risk
- Max 2% per trade
- Max 10% daily loss
- No leverage on crypto
- Always set stop losses

## Preferences
- Swing trader, daily timeframe
- Prefer Alpaca for stocks, Binance for crypto
- Paper trading only (until I'm confident)

## Exclusions
- No meme coins
- No penny stocks under $5
- Don't trade during FOMC meetings

## Style
- Be concise in analysis
- Always show risk/reward ratio
- Mention fees and slippage
```

## 7-Level Settings Chain

Settings merge from 7 layers (highest priority first):
1. **CLI flags** (`--permissionMode auto`)
2. **Session overrides** (`/effort high` — not persisted)
3. **Policy settings** (`~/.gordon/policy.json` — org rules)
4. **Local settings** (`~/.gordon/settings.local.json`)
5. **Project settings** (`.gordon/settings.json`)
6. **Profile settings** (`~/.gordon/profiles/default.json`)
7. **Defaults** (built-in)

Use `/config` to edit interactively.

## Keybindings

Customize in `~/.gordon/keybindings.json`:

### Default shortcuts
- Ctrl+P — command palette
- Ctrl+Y — quick approve trade
- Ctrl+N — quick deny trade
- Ctrl+Shift+A — toggle auto mode
- Ctrl+Shift+S — toggle strict mode
- Ctrl+Shift+X — emergency halt

### Vim mode
Enable in keybindings.json: `{ "vimMode": true }`
- j/k — scroll up/down
- G — scroll to bottom
- i — insert mode
- Esc — normal mode

### Custom bindings
```json
{
  "bindings": [
    { "key": "ctrl+b", "action": "togglePalette" }
  ]
}
```

Use `/shortcuts` to see all active bindings.

## Model Aliases

Quick model switching (each alias resolves to its family's current tier — see `modelAliases.ts`):
- `/model opus` → Claude Opus (flagship)
- `/model sonnet` → Claude Sonnet (balanced)
- `/model gpt5` → GPT-5 (OpenAI flagship)
- `/model gemini` → Gemini Pro (Google)
- `/model grok` → Grok (xAI)
- `/model fast` → fast tier of the active family
- `/model best` → flagship tier of the active family

Configure any provider key (ANTHROPIC_API_KEY, OPENAI_API_KEY, GOOGLE_GENERATIVE_AI_API_KEY, XAI_API_KEY, or a gateway key) and `/model <provider> <model>` to run any model.

Or just `/model` to open the interactive picker.

## Terminal Tab
Gordon updates your terminal tab title with:
- Current activity (streaming, approving, executing)
- Permission mode badge (AUTO/ASK/STRICT)
- Tab color: blue (streaming), amber (approving), red (executing), green (auto)

Works in iTerm2, Ghostty, and other modern terminals.
