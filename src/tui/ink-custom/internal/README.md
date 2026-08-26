ink-custom/internal
===================

Inlined replacements for trivial runtime dependencies Gordon needs but
doesn't want to keep shipping as separate npm packages once the custom
renderer is active.

`cli-boxes.ts` is active in the owned border renderer. `log-update.ts` is an
unwired reference implementation; the active custom path writes through its
cell-diff and ANSI-patch pipeline instead.

- `cli-boxes.ts` — inlines the Unicode box-drawing tables for the 8 border
  styles Gordon actually uses. Replacement for the `cli-boxes` npm package
  (which ships 13 styles and a dependency on `type-fest`).

- `log-update.ts` — inlines Ink's log-update.js as plain TypeScript. Keeps
  the synchronized-output (BSU/ESU) envelope and the `incremental` mode.
  Replacement for `ink/build/log-update.js`.

The custom renderer already uses cell-level diffing, so `log-update.ts` should
remain unwired unless a future compatibility path has a concrete need for it.
