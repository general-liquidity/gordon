# AGENTS.md — Gordon CLI

This file is an alias for [`CLAUDE.md`](./CLAUDE.md). Tools that look for `AGENTS.md` (OpenAI Codex / Cursor / various MCP clients) and tools that look for `CLAUDE.md` (Claude Code) both find the same agent onboarding doc.

The full content lives in `CLAUDE.md`. The essentials below let an agent get oriented without opening a second file.

## What Gordon is

A TypeScript trading agent on Bun + Mastra. Connects to crypto exchanges (Binance, Coinbase, Kraken, OKX) and equity brokers (IB, Alpaca, Trading 212). Proposes trades, runs backtests, scans markets, hosts a proactive radar.

**Not a coding agent.** Most patterns from coding-agent references map onto trading only loosely. Translate before assuming.

## Hard rules

1. **Grep before claiming a feature is missing.** This has surfaced false-positive gaps repeatedly — the codebase is more mature than first impressions suggest. See `~/.claude/projects/C--Users-adria-Downloads-gordon-cli-alpha/memory/MEMORY.md` for what's already shipped.
2. **No `Co-Authored-By: Claude` in commit messages.**
3. **Use `.ts` extensions on relative imports** (Bun convention).
4. **Conventional-commit prefix** on every commit.
5. **Confirm before risky actions** (force pushes, destructive git ops).
6. **`bun test <path>`** for tests, **`bun tsc --noEmit -p tsconfig.json`** for typecheck. Both must be clean before commit.

## Where things live (essentials)

| Area | Path |
|---|---|
| Agents | `src/infra/agents/definitions/` |
| Tools | `src/infra/agents/tools/` |
| Orchestrator | `src/infra/agents/orchestrator.ts` |
| Hooks | `src/infra/hooks/` (asyncRewake + statusMessage supported) |
| Permissions | `src/runtime/permissions/PermissionEngine.ts` + `trustTrajectory.ts` |
| Risk classifier | `src/infra/trading/risk/riskClassifier.ts` (15-dimension pre-trade gate) |
| Compaction | `src/infra/domain/memory/summarizer.ts` (5 stages at 70/80/90/94/99%) + `contextCollapse.ts` |
| Strategy recipes | `src/core/strategies/recipes/` |
| Audit log | `src/infra/platform/audit/audit-log.ts` (HMAC-signed) |
| Slash commands | `src/app/slash/slashCommands.ts` |
| Proactive radar | `src/infra/proactive/engine/observer.ts` + `producers/` |
| Memory | `~/.claude/projects/C--Users-adria-Downloads-gordon-cli-alpha/memory/` |

For the full doc with conventions, key invariants, and reference grid, see `CLAUDE.md`.
