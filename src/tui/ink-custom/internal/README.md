ink-custom/internal
===================

Inlined replacements for trivial runtime dependencies Gordon needs but
doesn't want to keep shipping as separate npm packages once the custom
renderer is active.

Status: NOT WIRED. These modules are ready for Phase 1 activation. The
Phase 0 facade at `src/tui/ink-custom/index.ts` does NOT import them.

- `cli-boxes.ts` — inlines the Unicode box-drawing tables for the 8 border
  styles Gordon actually uses. Replacement for the `cli-boxes` npm package
  (which ships 13 styles and a dependency on `type-fest`).

- `log-update.ts` — inlines ink's log-update.js as plain TypeScript. Keeps
  the synchronized-output (BSU/ESU) envelope and the `incremental` mode.
  Replacement for `ink/build/log-update.js`.

When Phase 1 swaps the renderer, `internal/log-update.ts` becomes the new
paint transport. Later phases (Phase 5) replace its whole-output diffing
with cell-level diffing, so expect this file to shrink/change substantially
once the cell-grid lands.
