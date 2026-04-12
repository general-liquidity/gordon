---
name: learn-permissions
description: How Gordon's permission system works — modes, rules, risk classifier, and approval flow
when_to_use: When user asks about permissions, safety, how to allow or block trades, or the approval dialog
tags: [learning, permissions, safety, approval]
user-invocable: true
---

Gordon has a layered safety system. Here's how it works from top to bottom.

## Permission Modes

Six modes, switchable anytime:

### /ask (DEFAULT — recommended)
Every trade shows an ApprovalDialog:
- You see: tool name, parameters, risk tier
- You choose: "Allow this time" / "Always allow" / "Deny"
- "Always allow" creates a persistent rule

### /auto
Trades execute without asking. Use for:
- Autonomous trading mandates
- High-frequency strategies
- When you've already validated the setup

### /strict
Read-only mode. ALL trades blocked. Use for:
- Research and analysis only
- Demo mode
- When you're away

### /paper
Paper trading only — real orders blocked, simulated fills recorded. Use for:
- Learning a new strategy risk-free
- Pre-deploying a strategy before going live
- Benchmarking strategies side-by-side without capital exposure
- Demo recordings where you want end-to-end execution visible without real spend

### /observe
Pure observation — no execution of any kind, not even paper trades. Use for:
- Watching market structure without any action
- Auditing Gordon's decision making
- Safe review when you're unsure about current mode
- Letting Gordon talk through setups without any action surface

### /planmode
Planning only — can create plans but cannot execute them. Use for:
- Building a playbook of trade ideas to review later
- Preparing setups for a future session with live execution
- Drafting strategies without risk of accidental fat-finger execution

## The Safety Stack (5 Layers)

### Layer 1: Permission Mode
- `/strict`, `/observe` → blocked immediately, no further checks (observe also blocks paper)
- `/planmode` → plans created but execute_plan blocked
- `/paper` → real orders blocked but simulated fills run through the normal pipeline
- `/auto` → skips approval dialog (but still runs risk classifier)
- `/ask` → shows approval dialog

### Layer 2: Permission Rules
Content-scoped rules that auto-approve or auto-deny based on conditions:
- "Allow place_order when notionalUsd < $100" → small trades auto-approved
- "Deny place_order when symbol contains DOGE" → specific assets blocked
- Rules checked via racing: if a rule matches, dialog never shows

### Layer 3: Hooks (PreToolUse)
Custom code that runs before every tool:
- Can block ("No trading after 4 PM")
- Can modify ("Reduce size to half")
- Can allow (skip to next layer)

### Layer 4: Risk Classifier (11 dimensions)
Mandatory pre-execution check:
- Scores 0-100 across 11 risk dimensions
- Low (0-25): proceed
- Medium (25-50): warn user
- High (50-75): require explicit confirmation
- Critical (75-100): BLOCKED, cannot execute

### Layer 5: Executor Isolation
Even if all other layers pass, only the Executor agent can call trade tools.
Gordon (main agent) physically cannot place orders — architectural separation.

## Permission Racing
Hooks and rules race against the approval dialog. First to decide wins:
- If a rule auto-approves → dialog never shows (instant)
- If a hook blocks → dialog never shows (instant deny)
- If neither decides → dialog shows and user decides

## Managing Rules
- "Always allow" in ApprovalDialog → creates a persistent rule
- `/config` → view and edit rules
- Content conditions: `notionalUsd < 1000`, `symbol == "BTCUSDT"`, `side == "BUY"`

## Try It
Switch modes: `/auto`, `/ask`, `/strict`
Check current mode: it's shown in the header bar
