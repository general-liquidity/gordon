---
name: learn-execution
description: How orders flow through Gordon — from plan to risk check to approval to atomic execution. When user asks "how does execution work?", "what happens when I approve?", "explain the trade pipeline", or about order flow
tags: [learning, execution, orders, pipeline]
user-invocable: true
status: active
last-reviewed: 2026-05-23
---

Here's exactly what happens when you say "buy $500 of ETH."

## The Execution Pipeline (9 steps)

### Step 1: Intent Recognition
Gordon (main agent) recognizes this is a trade request → routes to Executor.

### Step 2: Pre-Check
Executor verifies:
- permissionMode is NOT "strict" (if strict → blocked immediately)
- Exchange/broker is connected and authenticated
- Symbol exists and is tradeable on the active venue

### Step 3: Risk Classification (MANDATORY)
Executor calls `classify_trade_risk` with the proposed trade:
- 11 dimensions scored (position size, concentration, drawdown, etc.)
- If data available: vol-percentile sizing, correlation check, tail risk
- Returns a tier: low / medium / high / critical

**Critical tier → REFUSED. Executor will NOT proceed. Tells you why and suggests alternatives.**

### Step 4: Permission Racing
Three checks race in parallel — first to decide wins:
1. **Permission rules**: Does any rule auto-approve or auto-deny?
2. **Hooks**: Does any PreToolUse hook block or allow?
3. **Approval dialog**: Shows to user (if neither rule nor hook decided)

### Step 5: Approval (if permissionMode = "ask")
ApprovalDialog shows:
- What: "place_market_order BUY 0.15 ETH"
- Risk tier and top risk factors
- Three choices: "Allow this time" / "Always allow" / "Deny"

### Step 6: Order Submission
Once approved, the order goes to the exchange:
- Market order → immediate execution
- Limit order → placed on the book, waits for fill
- Bracket order → market entry + stop loss + take profit (atomic)

### Step 7: Fill Confirmation
Exchange returns the fill:
- Fill price, quantity, fees
- Position created or updated
- P&L calculation begins

### Step 8: Post-Execution
- Feedback loop records: pattern, symbol, entry price
- Session memory updates if durable facts detected
- Trade journal entry created
- Event emitted: `trade:opened` → notification shown

### Step 9: Monitoring
Position enters monitoring:
- Stop loss / take profit tracked
- Drawdown overlay checks if position should be scaled down
- When closed → `trade:closed` event → feedback loop records outcome

## Multi-Leg Atomic Execution

For bracket orders or spread trades, Gordon uses atomic execution:
- All legs submitted together
- If any leg fails → ALL previous legs cancelled (rollback)
- If cancel fails → marked as "orphaned" for manual review
- You never get stuck with half a position

## Order Types

| Type | How it works |
|------|-------------|
| Market | Execute immediately at best available price |
| Limit | Place on book at specified price, wait for fill |
| Stop | Triggered when price reaches stop level |
| Bracket | Market entry + stop loss + take profit (3 orders) |
| OCO | One-cancels-other (stop loss OR take profit, whichever fills first) |

## Fees
- Fees are venue-specific (Binance ~0.1%, Alpaca free for stocks)
- Gordon shows estimated fees in the risk assessment
- Actual fees deducted from fill

## Try It
"Preview a $100 buy of BTC" — this runs the full pipeline up to Step 5 without actually placing an order. You can see exactly what would happen.
