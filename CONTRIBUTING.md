# Contributing to Gordon

Thanks for your interest in Gordon. This is a money-touching trading agent, so contributions are held to a high bar for correctness and safety.

## Before you start

- Read [DISCLAIMER.md](./DISCLAIMER.md) and [TERMS.md](./TERMS.md).
- For anything that could move money, leak keys, or bypass a permission gate, follow [SECURITY.md](./SECURITY.md) instead of opening a public issue or PR.
- Develop and test in `paper` or `strict` mode. Never commit real API keys, secrets, or account IDs.

## Development setup

Gordon runs on [Bun](https://bun.sh) (>= 1.0).

```bash
bun install          # deps (postinstall patches Mastra + Ink)
bun run dev          # hot-reload TUI
bun test             # Bun's built-in runner, co-located *.test.ts
bun run typecheck    # tsc --noEmit
bun run check        # Biome lint + format
```

## Conventions

- **Commits:** Conventional-commit prefixes (`feat:`, `fix:`, `test:`, `docs:`, `refactor:`, ...).
- **Imports:** use `.ts` extensions on relative imports (Bun convention).
- **Tests:** co-located `*.test.ts`, run with `bun test`. No Jest or Vitest.
- **Types:** `bun run typecheck` must be clean before you push.
- **Lint/format:** `bun run check` (Biome) must pass.
- **Safety-critical tools:** execution and cancel tools carry a required `rationale` field and route through the risk gate and audit log. Preserve that shape when touching those paths.

## Pull requests

1. Keep changes focused. A bug fix should not carry an unrelated refactor.
2. Run `bun run typecheck`, `bun test`, and `bun run check` locally first.
3. Describe what changed and why, and note any impact on the permission, risk, or execution paths.
4. New tools added to an agent must declare a tool tier (see the audit in `scripts/dev/checks/check_tool_tiers.ts`).

## Reporting bugs

Open a GitHub issue with steps to reproduce, your platform, and `gordon --version`. For security-sensitive reports, use the private channel in [SECURITY.md](./SECURITY.md).
