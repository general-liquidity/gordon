---
name: learn-memory
description: How Gordon remembers — session memory, trade journal, GORDON.md, and durable facts. When user asks "what do you remember?", "how do you persist context?", "what's GORDON.md?", or about Gordon's memory layers
tags: [learning, memory, persistence, config]
user-invocable: true
---

Gordon has 4 layers of memory. Let me explain each one.

## Layer 1: Conversation Context
- Everything you say and Gordon responds in the current session
- Managed automatically — microcompact trims old tool results to save space
- Auto-compaction kicks in at 70% of context window
- When compacted, durable facts are extracted and saved (Layer 2)

## Layer 2: Session Memory (~/.gordon/session-memory/)
- Durable facts extracted from conversations that survive across sessions
- Stored as JSON with categories: risk_preference, strategy_preference, venue_preference, exclusion, trade_rationale, lesson_learned, user_fact
- Example: "User prefers 2% max risk per trade" → saved as risk_preference
- Injected into every new session's prompt as [GORDON_SESSION_MEMORY]

## Layer 3: Trade Journal (SQLite)
- Every trade outcome recorded: symbol, pattern, P&L, hold duration
- Hybrid search: BM25 keyword + embedding cosine similarity + temporal decay + MMR diversity
- The feedback loop reads this: patterns that lose money get downweighted
- Searchable via `/journal` or `search_memory` tool

## Layer 4: GORDON.md (Hierarchical Config)
- Markdown prose for your trading personality and rules
- 3 tiers (later overrides earlier):
  1. `~/.gordon/GORDON.md` — user global (your risk rules, preferences)
  2. `.gordon/GORDON.md` — project-specific (if you have multiple strategies)
  3. `GORDON.md` — project root (shared with team)
- Injected into agent prompt at session start

## How They Work Together
1. You say "I never trade meme coins"
2. Session memory saves: `{ category: "exclusion", content: "No meme coins" }`
3. Next session, Gordon sees this in [GORDON_SESSION_MEMORY] and avoids recommending meme coins
4. If you write it in GORDON.md, it becomes a permanent rule

## What Compaction Preserves
When context gets compacted, Gordon saves:
- Risk tolerance and position sizing rules
- Strategy preferences
- Explicit exclusions/blacklists
- Primary broker/exchange preference
- Trade rationale for open positions
- Lessons learned

## Tombstones (Audit Trail)
Every message that gets compacted leaves a tombstone:
- SHA-256 hash of original content
- Preview of what was removed
- Why it was removed (microcompact, full_compact, budget_trim)
- Stored in ~/.gordon/tombstones/ as NDJSON
- For audit compliance — nothing is truly lost

## Try It
- "Remember that I prefer swing trading on daily timeframes"
- Check `/memory` to see stored session memories
- Create a GORDON.md: `/init` (or `/learn-skills` to learn the format)
