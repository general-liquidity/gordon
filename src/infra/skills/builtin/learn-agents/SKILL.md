---
name: learn-agents
description: How Gordon's 4-agent architecture works — Gordon, Executor, Researcher, and Critic. When user asks "how does Gordon work?", "what are the agents?", "why did Executor handle this?", or about routing between agents
tags: [learning, agents, architecture]
user-invocable: true
status: active
last-reviewed: 2026-05-23
---

Gordon uses 4 agents. Here's how they work and why.

## The 4 Agents

### 1. Gordon (Main Agent)
- **Has**: ALL read-only tools (~200+) — scanning, analysis, indicators, portfolio reads, backtesting, planning, memory
- **Does**: 95% of everything. When you ask "what's BTC doing?" or "analyze my portfolio," Gordon handles it directly
- **Cannot**: Place orders, cancel orders, transfer funds, or modify positions

### 2. Executor (Trade Execution)
- **Has**: ALL state-changing tools (~130) — place_order, cancel_order, withdraw, transfer, staking
- **Does**: Executes trades when you confirm. Isolated from Gordon for safety.
- **Must**: Call classify_trade_risk (11-dimension risk check) BEFORE every trade
- **Cannot**: Skip the risk check. It's architecturally enforced.

### 3. Researcher (On-Demand Parallel Work)
- **Has**: Read-only analysis tools (subset of Gordon's)
- **Does**: Spawned for heavy parallel tasks — scan 5 symbols at once, backtest 3 strategies simultaneously
- **Lifecycle**: Created on demand, runs in background, returns results, then dies
- **Cannot**: Trade. Read-only only.

### 4. Critic (Built Into Executor)
- **Has**: Risk assessment tools only
- **Does**: Mandatory pre-execution risk check. Runs INSIDE Executor's pipeline.
- **Not a separate agent**: It's a required tool call (classify_trade_risk) that the Executor must make before any order

## Why This Architecture?

### Why not 1 agent with everything?
- Safety. If one agent has both `get_price` and `place_order`, the LLM could chain them in a single turn without you approving.
- Executor isolation means Gordon physically cannot place trades — only Executor can, and only after risk check + your approval.

### Why not 10 agents like before?
- Latency. 10 agents meant every request went through a routing step (2+ LLM calls).
- Context fragmentation. Sub-agents only saw 10 recent messages, not your full conversation.
- Now: "What's BTC doing?" → 1 LLM call (Gordon has the tools). Before: 3 calls (Gordon → Scanner → Analyst).

## How Routing Works
- You type something → Gordon processes it
- If it requires a trade → Gordon routes to Executor
- If it's heavy parallel work → Gordon spawns a Researcher
- If it's anything else → Gordon handles it directly (no routing delay)

## What You See
- Most of the time, you're talking to Gordon
- When Executor activates, you see the ApprovalDialog
- When Researcher runs, you see a background task indicator
- Agent handoffs are transparent — you don't need to know which agent is active
