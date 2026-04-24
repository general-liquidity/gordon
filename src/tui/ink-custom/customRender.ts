// customRender — entry point for the custom Ink pipeline.
//
// Status: Phase 1+ (behind GORDON_CUSTOM_RENDER=1 flag). Only imported by
// `render.ts` when the env flag is set; otherwise this file is dead-code.
//
// Responsibilities:
//   * Create an "ink-root" DOMElement with a Yoga layout node.
//   * Boot the React reconciler container pointing at the root.
//   * On each reconciler flush, compute layout, paint into an OutputTarget,
//     drive through FrameBuffer.swap() -> PatchEmitter.diff() ->
//     AnsiPatcher.write() -> SyncTerminal.wrapFrame(), and finally write to
//     stdout via Ink's `log-update` pattern.
//
// Known limitations for this first activation:
//   * No accessibility / screen-reader fallback.
//   * Selection overlay is allocated but not applied to the full-frame
//     rewrite transport yet — `instance.setSelection` mutates the overlay
//     state but the paint pipeline currently reprints toAnsiString(). The
//     overlay will start applying when the patch-based transport lands
//     (see TODO(incremental-patches) below).
//
// Phase status:
//   * Phase 3 — `<Static>` scrolls into history above the live frame.
//   * Phase 4 — hyperlink pool, selection overlay, cursor declaration are
//     all allocated; cursor declaration emits; the other two are staged
//     for the patch transport.
//   * Phase 6 — pool-migration scheduler runs by default whenever the
//     custom renderer is active. Override via `GORDON_POOL_MIGRATION_ENABLED=false`
//     to disable (benchmarking cold pools), interval configurable via
//     `GORDON_POOL_MIGRATION_INTERVAL_MS` (default 5 min).
//
// What now works (Phase 1+):
//   * `useInput`, `useApp`, `useStdout`, `useStderr`, `useFocus` all work
//     because the mount path wraps the user tree in Ink's App component,
//     which sets up the 5 context providers those hooks read from.
//
// If any of these are a blocker in a real session, flip
// GORDON_CUSTOM_RENDER=0 or leave it unset — the vanilla Ink path is
// identical to today.

import type { ReactNode } from "react";
import React from "react";
import Yoga from "yoga-layout";
import ansiEscapes from "ansi-escapes";
import patchConsole from "patch-console";
import process from "node:process";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import * as nodePath from "node:path";
import reconciler from "./reconciler.ts";

// Ink's App component sets up the 5 context providers (AppContext,
// StdinContext, StdoutContext, StderrContext, FocusContext) that the
// shim hooks in ink-custom/hooks/ read from. Wrapping the user tree with
// Ink's App lets useInput/useApp/useStdout/useStderr/useFocus work under
// our custom pipeline without us having to re-implement raw-mode handling,
// keypress parsing, or focus management. The reconciler / paint pipeline
// is still entirely ours — only the input + context machinery is borrowed.
//
// Ink's package.json `exports` field blocks deep imports by specifier, so
// we reach the App class via a file-URL dynamic import (which bypasses the
// exports gate). `createRequire.resolve("ink")` gives us the absolute path
// to Ink's main entry, from which we derive the App.js location. Top-level
// await is acceptable here — loading the module once at import time costs
// ~2ms and zero per-render. Phase 1+ replaces this with an owned App
// implementation that doesn't need the indirection.
const _require = createRequire(import.meta.url);
const _inkMainPath = _require.resolve("ink");
const _inkBuildDir = nodePath.dirname(_inkMainPath);
const _inkAppUrl = pathToFileURL(nodePath.join(_inkBuildDir, "components/App.js")).href;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const InkApp: any = (await import(_inkAppUrl)).default;
import { createNode } from "./domRuntime.ts";
import { createCellBuffer } from "./cellBuffer.ts";
import { createOutputTarget } from "./outputTarget.ts";
import { createStylePool } from "./stylePool.ts";
import { createCharPool } from "./charPool.ts";
import { createFrameBuffer } from "./framebuffer.ts";
import { createSyncTerminal } from "./syncTerminal.ts";
import { createAnsiPatcher, createRelativeAnsiPatcher } from "./renderPipeline.ts";
import { diffCells } from "./cellDiff.ts";
import { renderNodeToOutput, renderStaticNodeToAnsi } from "./renderNodeToOutput.ts";
import { createHyperlinkPool } from "./hyperlinkPool.ts";
import { createSelectionOverlay } from "./selectionOverlay.ts";
import { createCursorDeclarationManager } from "./cursorDeclaration.ts";
import { createPoolMigrator } from "./poolMigration.ts";
import { createMigrationScheduler } from "./migrationScheduler.ts";
import type { DOMElement } from "./dom.ts";
import type { RenderOptions, Instance, SelectionRange } from "./render.ts";
import type {
  MigrationSchedulerHandle,
  HyperlinkPool,
  StylePool,
  CharPool,
} from "./internal/contracts.ts";

const noop = (): void => {};

/**
 * Start the custom renderer. Returns an Instance handle matching the
 * vanilla `ink.render()` shape.
 */
export function startCustomRender(node: ReactNode, options: Required<RenderOptions>): Instance {
  const stdout = options.stdout;
  // Pool bindings are mutable so Phase 6 migration can swap them atomically.
  // Everything that reads a pool does so through these bindings (not through
  // local const captures), so a successful rebase takes effect on the next
  // frame without a re-mount.
  let stylePool: StylePool = createStylePool();
  let charPool: CharPool = createCharPool();
  let hyperlinkPool: HyperlinkPool = createHyperlinkPool();
  const selectionOverlay = createSelectionOverlay();
  const cursorDeclaration = createCursorDeclarationManager();
  const syncTerm = createSyncTerminal();
  const ansiPatcher = createAnsiPatcher();
  // Main-screen-safe incremental transport. Emits relative cursor movements
  // (CUU/CUD/CUF) anchored to the previous frame's footprint. Only used when
  // the patch list is small AND no geometry/static changes require a full
  // rewrite. The existing absolute-CUP `ansiPatcher` is retained for parity
  // but is currently unused by the render loop — kept so alt-screen activation
  // in a future phase can reuse it without re-plumbing.
  const relativePatcher = createRelativeAnsiPatcher();
  // Patch-count threshold above which we fall back to full-frame rewrite.
  // A small incremental emission is cheaper than an erase-then-reprint; a
  // large one is not, and the risk of drift from terminal-specific cursor
  // quirks grows with patch count. 40 patches covers most in-place edits
  // (typed characters, spinner ticks, small status updates) while keeping
  // large repaints on the proven full-rewrite path.
  const INCREMENTAL_PATCH_THRESHOLD = 40;
  void ansiPatcher;

  let isUnmounted = false;
  let lastPaintedAnsi = "";
  let lastPrintedHeight = 0;
  // Track the width the last full repaint was sized to. A width change
  // invalidates the incremental patch path — existing cells on screen sit
  // at different column offsets than the diff assumes — so any resize
  // forces a full rewrite next paint. Height changes are detected via
  // `lastPrintedHeight` drift against the current fullAnsi row count.
  let lastPrintedWidth = 0;
  let migrationHandle: MigrationSchedulerHandle | null = null;
  // Cumulative bytes already scrolled into history via <Static>. Ink's
  // Static component passes only the new items each render, so every
  // non-empty renderStaticNodeToAnsi(...) result IS the delta for that
  // tick. We keep this accumulator primarily as a debug/history hook —
  // a future Gordon debug overlay can dump `emittedStaticAnsi` to reason
  // about what scrolled by, and a content-hash guard can compare to it
  // if a misuse (mutating already-emitted items) needs detection.
  let emittedStaticAnsi = "";

  // Root DOM element + Yoga tree.
  const rootNode = createNode("ink-root") as DOMElement;

  const getTerminalWidth = (): number => stdout.columns || 80;
  const getTerminalHeight = (): number => stdout.rows || 24;

  const frameBuffer = createFrameBuffer(getTerminalWidth(), getTerminalHeight(), (w, h) =>
    createCellBuffer(w, h),
  );

  const calculateLayout = (): void => {
    const width = getTerminalWidth();
    rootNode.yogaNode?.setWidth(width);
    rootNode.yogaNode?.calculateLayout(undefined, undefined, Yoga.DIRECTION_LTR);
  };

  const writeToStdout = (data: string): void => {
    try {
      stdout.write(data);
    } catch {
      // swallow — stdout can be closed unexpectedly
    }
  };

  // Console output intercepted by patchConsole — buffered until we can
  // safely flush above the live frame. `isRendering` protects against
  // flushing mid-paint which would corrupt cursor state.
  const pendingConsoleOutput: string[] = [];
  let isRendering = false;
  let restoreConsole: (() => void) | null = null;

  const flushConsoleAboveFrame = (): void => {
    if (pendingConsoleOutput.length === 0) return;
    const writes = pendingConsoleOutput.join("");
    pendingConsoleOutput.length = 0;
    // First paint hasn't happened yet: just emit the console output. It'll
    // naturally sit above the frame when the first render lands.
    if (lastPaintedAnsi.length === 0) {
      writeToStdout(writes);
      return;
    }
    // Erase the live frame, emit console output (becomes permanent
    // scrollback — nothing erases it next frame), then reprint the frame.
    const erase = ansiEscapes.eraseLines(lastPrintedHeight);
    writeToStdout(syncTerm.wrapFrame(erase + writes + lastPaintedAnsi + "\n"));
  };

  if (options.patchConsole) {
    restoreConsole = patchConsole((_stream, data) => {
      pendingConsoleOutput.push(data);
      // Flush immediately if we're outside a render pass; otherwise onRender
      // will drain the buffer after it finishes the current paint.
      if (!isRendering && !isUnmounted) flushConsoleAboveFrame();
    });
  }

  const onRender = (): void => {
    if (isUnmounted) return;
    const startTime = performance.now();
    isRendering = true;

    try {
      calculateLayout();
      if (!rootNode.yogaNode) return;

      const width = rootNode.yogaNode.getComputedWidth();
      const height = Math.max(1, rootNode.yogaNode.getComputedHeight());

      // Resize frame buffer if terminal size changed. Remember whether a
      // resize happened this tick so the subsequent-paint branch can force
      // a full rewrite instead of attempting incremental patches — after a
      // resize the front/back buffers share no meaningful cell-level overlap
      // with what's already on screen.
      const sizeChanged =
        frameBuffer.width !== width || frameBuffer.height !== height;
      if (sizeChanged) {
        frameBuffer.resize(width, height);
      }

      // Paint into OutputTarget -> back buffer.
      const output = createOutputTarget(width, height);
      renderNodeToOutput(rootNode, output, { skipStaticElements: true });
      output.paintInto(frameBuffer.back, charPool, stylePool, hyperlinkPool);

      // Phase 3 — compute `<Static>` delta. Because Ink's Static component
      // only passes items that haven't been rendered yet (it slices items
      // from a React state index), the returned string IS the delta. We
      // still track `emittedStaticAnsi` so unmount-time debuggers can
      // reason about what went to scrollback, and so a future content-hash
      // check can catch misuse where callers mutate already-emitted items.
      const staticAnsi = renderStaticNodeToAnsi(rootNode);

      // Compute the patch list from front (on-screen) vs back (just painted).
      // The subsequent-paint branch below uses it to decide between the
      // incremental relative-cursor transport and the full-frame rewrite.
      const patches = diffCells(frameBuffer.front, frameBuffer.back, stylePool, charPool);
      frameBuffer.swap();

      const fullAnsi = output.toAnsiString();

      // Append the declared cursor position (Phase 4) so inputs like
      // TextInput can park the physical cursor on the correct cell AFTER
      // all cell writes. Empty string when no declaration is active, so
      // this is zero-cost for non-input frames.
      const cursorAnsi = cursorDeclaration.emit();

      // Static-aware prefix. On first paint the static content lands in
      // scrollback ABOVE the live frame; on subsequent paints the
      // eraseLines only clears the live region, so newly-emitted static
      // content scrolls up into history behind the reprinted live frame.
      const hasStatic = staticAnsi.length > 0;
      const staticEmit = hasStatic ? staticAnsi + "\n" : "";

      // First paint: cursor-hide + (optional static) + full frame, no erase.
      if (lastPaintedAnsi.length === 0) {
        lastPaintedAnsi = fullAnsi;
        lastPrintedHeight = Math.max(1, fullAnsi.split("\n").length);
        lastPrintedWidth = width;
        if (hasStatic) emittedStaticAnsi += staticAnsi + "\n";
        writeToStdout(
          syncTerm.wrapFrame(
            ansiEscapes.cursorHide + staticEmit + fullAnsi + "\n" + cursorAnsi,
          ),
        );
        options.onRender?.({ renderTime: performance.now() - startTime });
        return;
      }

      // Subsequent frames: if nothing changed AND no new static tail,
      // skip. If only static changed, we still need to erase + emit.
      if (!hasStatic && fullAnsi === lastPaintedAnsi && patches.length === 0) {
        options.onRender?.({ renderTime: performance.now() - startTime });
        return;
      }

      // Incremental transport. Emit relative-cursor patches in place of a
      // full rewrite when:
      //   * no <Static> delta this tick (static changes emit ABOVE the frame,
      //     which requires the erase-then-reprint pattern so newly-scrolled
      //     content lands in history behind the reprinted live region),
      //   * no size change (width/height drift makes cell-level diffs
      //     meaningless — on-screen cells no longer align with buffer cells),
      //   * a non-empty but small patch list (below the tuned threshold —
      //     beyond it a full rewrite ties or beats patch emission and has
      //     a proven-correct transport), AND
      //   * the fullAnsi row count matches lastPrintedHeight (guards against
      //     a layout change that didn't trigger a resize but reshaped the
      //     frame's vertical footprint, e.g. content wrapping flip).
      const nextHeight = Math.max(1, fullAnsi.split("\n").length);
      const canIncremental =
        !hasStatic &&
        !sizeChanged &&
        patches.length > 0 &&
        patches.length < INCREMENTAL_PATCH_THRESHOLD &&
        nextHeight === lastPrintedHeight &&
        width === lastPrintedWidth;

      if (canIncremental) {
        const body = relativePatcher.write(
          patches,
          stylePool,
          charPool,
          lastPrintedHeight,
        );
        writeToStdout(syncTerm.wrapFrame(body + cursorAnsi));
        // Geometry unchanged — lastPrintedHeight and lastPrintedWidth stay
        // the same. Update lastPaintedAnsi so the next-tick skip check can
        // match when the caller reruns an identical frame.
        lastPaintedAnsi = fullAnsi;
        options.onRender?.({ renderTime: performance.now() - startTime });
        return;
      }

      const erase = lastPrintedHeight > 0 ? ansiEscapes.eraseLines(lastPrintedHeight) : "";
      if (hasStatic) emittedStaticAnsi += staticAnsi + "\n";
      writeToStdout(
        syncTerm.wrapFrame(erase + staticEmit + fullAnsi + "\n" + cursorAnsi),
      );
      lastPaintedAnsi = fullAnsi;
      lastPrintedHeight = nextHeight;
      lastPrintedWidth = width;
      options.onRender?.({ renderTime: performance.now() - startTime });
    } finally {
      isRendering = false;
      // Drain any console writes that arrived during this render pass.
      if (pendingConsoleOutput.length > 0) flushConsoleAboveFrame();
    }
  };

  rootNode.onComputeLayout = calculateLayout;
  rootNode.onRender = onRender;
  rootNode.onImmediateRender = onRender;

  // Create container. The 11-arg call matches Ink's usage for the current
  // react-reconciler version. Types are `any`-eaten because react-reconciler
  // has no .d.ts for this signature.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const container = (reconciler as any).createContainer(
    rootNode,
    0, // LegacyRoot
    null,
    false,
    null,
    "id",
    noop,
    noop,
    noop,
    noop,
    null,
  );

  let exitPromise: Promise<void> | undefined;
  let resolveExit: () => void = noop;
  let rejectExit: (error: Error) => void = noop;

  const unmount = (error?: Error): void => {
    if (isUnmounted) return;
    isUnmounted = true;
    // Stop the Phase 6 migration scheduler (if running) before we tear the
    // frame down so it can't fire a tick against disposed pools.
    if (migrationHandle) {
      try {
        migrationHandle.stop();
      } catch {
        // swallow — unmount must not throw
      }
      migrationHandle = null;
    }
    // Reference emittedStaticAnsi so the field is considered read; a future
    // debug overlay will surface it on unmount. Zero runtime cost.
    void emittedStaticAnsi.length;
    // Flush any buffered console writes before we tear the frame down,
    // then restore the original console methods.
    if (pendingConsoleOutput.length > 0) flushConsoleAboveFrame();
    if (restoreConsole) {
      restoreConsole();
      restoreConsole = null;
    }
    // Show cursor + newline so shell prompt lands cleanly after us.
    writeToStdout(ansiEscapes.cursorShow + "\n");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (reconciler as any).updateContainerSync(null, container, null, noop);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (reconciler as any).flushSyncWork();
    if (error instanceof Error) rejectExit(error);
    else resolveExit();
  };

  const handleSigint = (): void => {
    if (options.exitOnCtrlC) unmount();
  };
  if (options.exitOnCtrlC) {
    process.once("SIGINT", handleSigint);
  }

  // Mount: wrap with Ink's App (context providers + raw-mode + input
  // keypress listener) so useInput / useApp / useStdout / useStderr / useFocus
  // work for any component mounted under the custom renderer.
  const render = (currentNode: ReactNode): void => {
    const wrapped = React.createElement(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      InkApp as any,
      {
        stdin: options.stdin,
        stdout: options.stdout,
        stderr: options.stderr,
        writeToStdout: (data: string) => writeToStdout(data),
        writeToStderr: (data: string) => options.stderr.write(data),
        exitOnCtrlC: options.exitOnCtrlC,
        onExit: (error?: Error) => unmount(error),
      },
      currentNode,
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (reconciler as any).updateContainerSync(wrapped, container, null, noop);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (reconciler as any).flushSyncWork();
  };

  render(node);

  // Phase 6 — start the pool-migration scheduler. Default ON whenever the
  // custom renderer is active (Claude Code runs this unconditionally so
  // long sessions don't leak pool entries). `GORDON_POOL_MIGRATION_ENABLED`
  // still exists as an explicit override — set to "false" to disable
  // (useful for benchmarking a single cold pool vs. migrated pools), or
  // to "true" to force on. The callback is wrapped so a migration throw
  // only logs — the render loop keeps going on stale-but-valid pools.
  const migrationFlag = process.env["GORDON_POOL_MIGRATION_ENABLED"];
  const migrationEnabled = migrationFlag === "false" ? false : true;
  if (migrationEnabled) {
    try {
      const intervalRaw = process.env["GORDON_POOL_MIGRATION_INTERVAL_MS"];
      const parsed = intervalRaw ? Number(intervalRaw) : NaN;
      const intervalMs = Number.isFinite(parsed) && parsed > 0 ? parsed : 5 * 60 * 1000;

      const migrator = createPoolMigrator({
        createCharPool,
        createStylePool,
        createHyperlinkPool,
      });

      const runMigration = (): void => {
        if (isUnmounted) return;
        const snapshot = migrator.captureSnapshot(frameBuffer.front, hyperlinkPool);
        const { newCharPool, newStylePool, newHyperlinkPool, remapping } = migrator.rebase(
          snapshot,
          charPool,
          stylePool,
          hyperlinkPool,
        );
        migrator.applyRemapping(frameBuffer.front, remapping);
        // Swap pools atomically. Every reader (onRender, outputTarget,
        // ansiPatcher) dereferences these bindings per-frame, so the next
        // frame sees the compacted pools transparently.
        charPool = newCharPool;
        stylePool = newStylePool;
        hyperlinkPool = newHyperlinkPool;
      };

      const scheduler = createMigrationScheduler(runMigration);
      migrationHandle = scheduler.start(intervalMs);
    } catch {
      // Starting the scheduler must never break mount — fall back to the
      // no-migration path silently.
      migrationHandle = null;
    }
  }

  const instance: Instance = {
    rerender: render,
    unmount,
    waitUntilExit: () => {
      if (!exitPromise) {
        exitPromise = new Promise((resolve, reject) => {
          resolveExit = resolve;
          rejectExit = reject;
        });
      }
      return exitPromise;
    },
    cleanup: () => {
      // No global instance registry yet — nothing to do here.
    },
    clear: () => {
      writeToStdout(ansiEscapes.eraseLines(lastPrintedHeight));
      lastPaintedAnsi = "";
      lastPrintedHeight = 0;
    },
    // Phase 4 affordances. The overlay is allocated and these writers
    // mutate its internal state, but the full-frame rewrite path doesn't
    // consume overlay patches yet (it reprints toAnsiString()). When the
    // incremental-patch transport lands, overlay.applyTo(patches) will be
    // inserted into the patch pipeline — at that point these writers
    // already do the right thing.
    setSelection: (range: SelectionRange | null) => {
      selectionOverlay.set(range);
    },
    clearSelection: () => {
      selectionOverlay.clear();
    },
  };

  return instance;
}

export default startCustomRender;
