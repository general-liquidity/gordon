# Gordon custom Ink renderer

This directory owns Gordon's TUI compatibility layer. Gordon's TUI imports
components and hooks from `src/tui/ink-custom`; the public `render()` entry
selects between vanilla Ink and Gordon's cell renderer.

## Production status

Vanilla Ink remains the default. Set `GORDON_CUSTOM_RENDER=1` to opt into the
custom renderer. Even with that opt-in, Gordon deliberately falls back to Ink
for screen-reader sessions, non-TTY output, `TERM=dumb`, tmux, and GNU screen.
Those environments cannot currently preserve the custom renderer's atomic-frame
or accessibility guarantees.

The fallback is part of the design, not a dead scaffold. It keeps one public
component/hook surface while allowing the custom implementation to mature
without making the experimental renderer the production default.

## What the custom path owns

- React reconciler host configuration and Gordon's DOM/Yoga nodes.
- Packed cell buffers, framebuffer swapping, cell diffs, ANSI patch emission,
  synchronized terminal frames, and alternate-screen cleanup.
- Character, style, and hyperlink pools, including periodic pool migration.
  Migration defaults on while the custom renderer is active and can be disabled
  with `GORDON_POOL_MIGRATION_ENABLED=false`.
- Gordon-owned App, stdin/stdout/stderr/focus contexts, input and mouse parsing,
  raw-mode reference counting, cursor declarations, static output, and scroll
  boxes.
- A non-destructive selection overlay. `Instance.setSelection()` and
  `clearSelection()` repaint inverse-video cells without mutating the content
  framebuffer, so clearing a selection restores the underlying styles.
- Local box-drawing tables in `internal/cli-boxes.ts`.

`internal/log-update.ts` is retained as an unwired reference implementation.
The active custom path writes through the cell-diff/ANSI patch pipeline instead.

## Accessibility and compatibility boundary

The custom cell path does not claim a screen-reader emission protocol. Passing
`isScreenReaderEnabled` or setting `INK_SCREEN_READER=true` selects vanilla Ink.
The same fallback applies where output is redirected or terminal multiplexers
strip synchronized-update sequences. A once-per-process stderr notice explains
when an explicit custom-renderer opt-in was overridden.

## Public surface

`index.ts` exports the Gordon subset of Ink used by the application:

- `Box`, `Text`, `Static`, and `Spacer`
- `render` and `measureElement`
- `useInput`, `useMouse`, `useStdout`, and `useApp`
- the related public types

Components and hooks use Gordon-owned implementations and contexts. On the
default render path, `render.ts` adapts those contexts to vanilla Ink; on the
custom path, `customRender.ts` mounts Gordon's reconciler and paint pipeline.

## Verification

The tests in this directory cover buffer and pool invariants, wide graphemes,
styles and hyperlinks, selection paint/clear behavior, input and mouse parsing,
scrolling, migration, alternate-screen cleanup, compatibility fallbacks, and
end-to-end mounting on both render paths.

Do not make the custom renderer default-on until a real-terminal visual pass has
closed the mount-time cell-interleaving and cursor-positioning defects recorded
in `render.ts`. Unit success alone is not that evidence.
