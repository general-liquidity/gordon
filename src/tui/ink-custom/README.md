Gordon ink-custom — Phase 0 scaffolding
========================================

This directory is the groundwork for Gordon's custom TUI reconciler, a planned
replacement of vanilla Ink with an architecture inspired by Claude Code's
terminal renderer (packed Int32Array cells, pool-based string interning, and
cell-level diffing).

Status: NOT ACTIVATED
---------------------

Gordon currently imports from `ink` (see `node_modules/ink`). Nothing in the
existing codebase imports from `src/tui/ink-custom`. This tree is a skeleton
that Phase 1 will begin filling in. Do not swap any import paths outside of a
dedicated feature branch.

Sprint plan
-----------

Phase 0 (this commit):
  - Establish `src/tui/ink-custom/` tree mirroring Ink's module layout.
  - Vendor the type surface (DOMElement, Styles, Key, props types).
  - Re-export runtime behavior from `ink` so the public API works identically
    when flipped on.
  - Inline trivial utilities (box-drawing chars, ANSI log-update helpers) as
    Phase 1-ready stubs that are NOT wired yet.

Phase 1: Replace the Ink renderer pipeline.
  - Fork `renderer.ts`, `render-node-to-output.ts`, `output.ts` with a
    cell-grid representation backed by `Int32Array`.
  - Keep Yoga layout for now (Phase 2 target).
  - Swap `log-update` for the inlined stub in `internal/log-update.ts`.

Phase 2: Replace Yoga with a minimal flex layout engine tuned for monospaced
terminal cells. Expected delta: ~40k-60k lines of native yoga-layout wasm
removed, replaced by ~800 LOC of pure TS.

Phase 3: Pool-based string interning for attributes/styles. Cells become
`{styleId, charCode, dirty}` triples.

Phase 4: Custom react-reconciler host config (drop `react-reconciler`'s default
fiber scheduler where it is overkill for terminal output).

Phase 5: Incremental diffing — only push the cells that changed to stdout.
Claude Code measures 5-10x fewer stdout bytes on typical message streams.

Phase 6: Activation. Flip Gordon's imports (`from "ink"` -> `from
"@gordon/ink-custom"` or a relative path), delete the `ink` dependency from
package.json, and delete the `react-reconciler` + `yoga-layout` transitive
dependencies.

How to activate later (a.k.a. "flip the switch")
------------------------------------------------

In a feature branch:

1. Run a codemod across `src/tui/**/*.{ts,tsx}`:

     # pseudo
     find src/tui -name '*.ts' -o -name '*.tsx' \
       | xargs sed -i "s|from 'ink'|from '@/tui/ink-custom'|g"

2. Verify `bun tsc --noEmit` still passes. The ink-custom public API in
   `src/tui/ink-custom/index.ts` is intentionally kept byte-for-byte identical
   to `ink`'s `build/index.d.ts` exports (Box, Text, Static, Spacer, render,
   useInput, useStdout, useApp, measureElement, plus the DOMElement /
   BoxProps / TextProps / Key types).

3. Run `bun test` / launch `gordon` and visually compare renders.

4. Only then: remove `"ink"`, `"react-reconciler"`, `"yoga-layout"`, and
   friends from `package.json`.

What Gordon actually imports from ink today
-------------------------------------------

Grepped across all 250 callsites in `src/tui/`:

  Components: Box, Text, Static, Spacer
  Hooks:      useInput, useStdout, useApp
  Utilities:  render, measureElement
  Types:      BoxProps, TextProps  (and indirectly DOMElement via ref)

Gordon does NOT use: Transform, Newline, useFocus, useFocusManager, useStdin,
useStderr, useIsScreenReaderEnabled. These are intentionally absent from this
fork to reduce surface area. If any future component needs them, add them
explicitly — don't pull the whole kitchen sink.

File layout
-----------

  index.ts                         Public API (mirrors ink/build/index.d.ts).
  components/
    Box.ts                         Box component + Props type.
    Text.ts                        Text component + Props type.
    Static.ts                      Static component.
    Spacer.ts                      Spacer.
  hooks/
    use-input.ts                   useInput + Key type.
    use-stdout.ts                  useStdout.
    use-app.ts                     useApp.
  dom.ts                           DOMElement / TextNode / NodeNames types,
                                   createNode/appendChildNode/etc shims.
  styles.ts                        Styles type (flex, border, color, ...).
  render.ts                        render() entry + RenderOptions + Instance.
  measure-element.ts               measureElement().
  internal/
    cli-boxes.ts                   Inlined Unicode box-drawing chars for the
                                   10 border styles Gordon uses. Not wired.
    log-update.ts                  Inlined ANSI cursor/erase helper. Not wired.
    README.md                      Notes on the inlined deps.

Notes for the next phase
------------------------

- Every file in this tree has a comment banner that says whether it is a
  re-export shim or owns its implementation. Phase 1 replaces the shims one
  file at a time.
- The `dom.ts` types are vendored in full because Phase 1-3 need to own the
  node shape. The runtime factory functions in `dom.ts` still delegate to
  ink for now.
- `internal/cli-boxes.ts` includes only the border styles Gordon actually
  renders (single, double, round, bold, singleDouble, doubleSingle, classic,
  arrow, plus Gordon's custom `gordon` style from existing code). If a
  consumer asks for a border that isn't in the table, Phase 1+ should throw
  at runtime rather than silently mis-render.
