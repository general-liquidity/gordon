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
//   * `<Static>` elements are painted but not scrolled into history (the
//     static-output emission path is stubbed).
//   * No accessibility / screen-reader fallback.
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
import { createAnsiPatcher } from "./renderPipeline.ts";
import { diffCells } from "./cellDiff.ts";
import { renderNodeToOutput } from "./renderNodeToOutput.ts";
import type { DOMElement } from "./dom.ts";
import type { RenderOptions, Instance } from "./render.ts";

const noop = (): void => {};

/**
 * Start the custom renderer. Returns an Instance handle matching the
 * vanilla `ink.render()` shape.
 */
export function startCustomRender(node: ReactNode, options: Required<RenderOptions>): Instance {
  const stdout = options.stdout;
  const stylePool = createStylePool();
  const charPool = createCharPool();
  const syncTerm = createSyncTerminal();
  const ansiPatcher = createAnsiPatcher();

  let isUnmounted = false;
  let lastPaintedAnsi = "";
  let lastPrintedHeight = 0;

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

      // Resize frame buffer if terminal size changed.
      if (frameBuffer.width !== width || frameBuffer.height !== height) {
        frameBuffer.resize(width, height);
      }

      // Paint into OutputTarget -> back buffer.
      const output = createOutputTarget(width, height);
      renderNodeToOutput(rootNode, output, { skipStaticElements: true });
      output.paintInto(frameBuffer.back, charPool, stylePool);

      // Compute patch list so pool churn is exercised every frame (validates
      // the diff hot path even when transport uses full rewrites).
      // TODO(incremental-patches): the current transport is a full-frame
      // rewrite (eraseLines + reprint) because absolute-CUP patches only work
      // in alt-screen mode, and Gordon runs main-screen. Safe incremental
      // emission needs either (a) an alt-screen-only activation gate, or (b)
      // a relative-cursor AnsiPatcher variant (CUU + \r + CUD + CUF). Until
      // one of those lands, the patches produced here are intentionally
      // discarded in favor of the tear-free full-frame approach below.
      const patches = diffCells(frameBuffer.front, frameBuffer.back, stylePool, charPool);
      void ansiPatcher.write(patches, stylePool, charPool);
      frameBuffer.swap();

      const fullAnsi = output.toAnsiString();

      // First paint: cursor-hide + full frame, no erase needed.
      if (lastPaintedAnsi.length === 0) {
        lastPaintedAnsi = fullAnsi;
        lastPrintedHeight = Math.max(1, fullAnsi.split("\n").length);
        writeToStdout(syncTerm.wrapFrame(ansiEscapes.cursorHide + fullAnsi + "\n"));
        options.onRender?.({ renderTime: performance.now() - startTime });
        return;
      }

      // Subsequent frames: skip if identical, otherwise erase + reprint.
      if (fullAnsi === lastPaintedAnsi) {
        options.onRender?.({ renderTime: performance.now() - startTime });
        return;
      }
      const erase = lastPrintedHeight > 0 ? ansiEscapes.eraseLines(lastPrintedHeight) : "";
      writeToStdout(syncTerm.wrapFrame(erase + fullAnsi + "\n"));
      lastPaintedAnsi = fullAnsi;
      lastPrintedHeight = Math.max(1, fullAnsi.split("\n").length);
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
  };

  return instance;
}

export default startCustomRender;
