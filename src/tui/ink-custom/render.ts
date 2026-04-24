// render — entry point with env-flag-gated custom pipeline.
//
// Default (Lane 1 / Phase A2): the custom renderer runs unless an explicit
// opt-out or an environment-driven fallback condition forces vanilla Ink.
// Fallbacks force vanilla when:
//   * `GORDON_CUSTOM_RENDER=0|false` (explicit opt-out)
//   * `TERM=dumb` (no ANSI processing — escape sequences would render as
//     literal text)
//   * `$TMUX` or `$STY` set (inside tmux/screen — DEC sync-output BSU/ESU
//     gets stripped by the multiplexer, so our wrapFrame() guarantee
//     no longer holds; vanilla Ink's line-based emit is safer)
//   * `INK_SCREEN_READER=true` or `isScreenReaderEnabled` option set
//     (custom pipeline has no a11y emission path yet)
//   * `process.stdout.isTTY === false` (pipe/redirect; no need for the
//     ANSI-paint pipeline, plain text is correct)
//
// `customRender` is statically imported so the hot path at call time is a
// single branch. The transitive cost of loading the pipeline is already
// paid by vanilla ink (react-reconciler, yoga-layout) so there is no
// measurable startup penalty for the fallback code path.

import type { ReactNode } from "react";
import process from "node:process";
import { render as inkRender } from "ink";
import { startCustomRender } from "./customRender.ts";
import { loadLabsFlagsIntoEnv } from "./loadLabsFlags.ts";

// Merge persisted experimental flags into process.env at module load.
// Env var wins over persisted; persisted wins over unset. Idempotent.
loadLabsFlagsIntoEnv();

/**
 * Cell range for selection overlays (reconciler Phase 4).
 * Rows/cols are 0-indexed; both endpoints are inclusive.
 */
export type SelectionRange = {
  startRow: number;
  startCol: number;
  endRow: number;
  endCol: number;
};

/**
 * Options accepted by `render()`. Identical shape to ink's RenderOptions,
 * vendored here so the custom renderer can own this surface.
 */
export type RenderOptions = {
  /** Output stream where the app will be rendered. @default process.stdout */
  stdout?: NodeJS.WriteStream;
  /** Input stream where app will listen for input. @default process.stdin */
  stdin?: NodeJS.ReadStream;
  /** Error stream. @default process.stderr */
  stderr?: NodeJS.WriteStream;
  /** If true, each update renders as a separate output block. @default false */
  debug?: boolean;
  /** Listen for Ctrl+C and exit the app. @default true */
  exitOnCtrlC?: boolean;
  /** Patch console methods so console output doesn't tear the live paint. @default true */
  patchConsole?: boolean;
  /** Called after each render with timing metrics. */
  onRender?: (metrics: { renderTime: number }) => void;
  /** Enable screen reader support. @default process.env.INK_SCREEN_READER === 'true' */
  isScreenReaderEnabled?: boolean;
  /** Maximum frames per second. @default 30 */
  maxFps?: number;
  /** Only re-paint changed lines (the Phase 5 target). @default false */
  incrementalRendering?: boolean;
};

/**
 * Handle returned from `render()`. Mirrors ink's Instance shape, plus
 * custom-render-only affordances (selection overlay control).
 */
export type Instance = {
  rerender: (node: ReactNode) => void;
  unmount: () => void;
  waitUntilExit: () => Promise<void>;
  cleanup: () => void;
  clear: () => void;
  /**
   * Set a selection range (custom renderer only; no-op under vanilla ink).
   * Currently scaffolding — the overlay is allocated but not yet applied to
   * the full-frame rewrite path. Wiring lands when patch-based emission is
   * activated. @internal
   */
  setSelection?: (range: SelectionRange | null) => void;
  /** Clear any active selection. @see setSelection */
  clearSelection?: () => void;
};

/**
 * Decide whether to drive a render through the custom pipeline.
 *
 * Default ON. Returns false when ANY of the documented fallback conditions
 * apply. When a fallback fires, this also writes one terse line to stderr
 * describing the reason — kept short so it doesn't dominate startup output
 * but visible enough for users to tell which renderer they got.
 *
 * `notice` is captured into the closure of the returned helper so we only
 * emit ONE line per process. A second render() call doesn't re-warn.
 */
let fallbackNoticeEmitted = false;
function emitFallbackNotice(stderr: NodeJS.WriteStream, reason: string): void {
  if (fallbackNoticeEmitted) return;
  fallbackNoticeEmitted = true;
  try {
    stderr.write(`[gordon] using vanilla Ink renderer (${reason})\n`);
  } catch {
    // swallow — startup must never throw on a stderr write
  }
}

export function shouldUseCustomRenderer(
  resolvedStdout: NodeJS.WriteStream,
  resolvedStderr: NodeJS.WriteStream,
  isScreenReaderEnabled: boolean,
): boolean {
  const flag = process.env["GORDON_CUSTOM_RENDER"];
  // Explicit opt-out wins over every other consideration.
  if (flag === "0" || flag === "false") {
    emitFallbackNotice(resolvedStderr, "GORDON_CUSTOM_RENDER opt-out");
    return false;
  }
  // Screen reader: vanilla Ink's text-dump emit is the only a11y path today.
  if (isScreenReaderEnabled) {
    emitFallbackNotice(resolvedStderr, "screen reader enabled");
    return false;
  }
  // Non-TTY stdout (pipe, redirect, CI without a tty): plain text only.
  if (resolvedStdout.isTTY === false) {
    emitFallbackNotice(resolvedStderr, "stdout is not a TTY");
    return false;
  }
  // TERM=dumb: emulator doesn't process ANSI; the custom pipeline would
  // dump escape sequences as visible garbage.
  if (process.env["TERM"] === "dumb") {
    emitFallbackNotice(resolvedStderr, "TERM=dumb");
    return false;
  }
  // tmux/screen: the multiplexer strips DEC sync-output BSU/ESU pairs the
  // syncTerminal helper depends on, breaking our atomic-frame guarantee.
  // Vanilla Ink's per-line emit is safer until we negotiate a sync-aware
  // path through the multiplexer.
  if (process.env["TMUX"]) {
    emitFallbackNotice(resolvedStderr, "tmux detected");
    return false;
  }
  if (process.env["STY"]) {
    emitFallbackNotice(resolvedStderr, "screen detected");
    return false;
  }
  return true;
}

/** @internal — for tests that need to reset the once-only fallback notice. */
export function _resetFallbackNoticeForTests(): void {
  fallbackNoticeEmitted = false;
}

/** Normalize options: coerce stream-only arg to an object. */
function resolveOptions(options?: NodeJS.WriteStream | RenderOptions): Required<RenderOptions> {
  const opts = (options && typeof (options as NodeJS.WriteStream).write === "function"
    ? { stdout: options as NodeJS.WriteStream }
    : (options ?? {})) as RenderOptions;

  return {
    stdout: opts.stdout ?? process.stdout,
    stdin: opts.stdin ?? process.stdin,
    stderr: opts.stderr ?? process.stderr,
    debug: opts.debug ?? false,
    exitOnCtrlC: opts.exitOnCtrlC ?? true,
    patchConsole: opts.patchConsole ?? true,
    onRender: opts.onRender ?? (() => {}),
    isScreenReaderEnabled:
      opts.isScreenReaderEnabled ?? process.env["INK_SCREEN_READER"] === "true",
    maxFps: opts.maxFps ?? 30,
    incrementalRendering: opts.incrementalRendering ?? false,
  };
}

/**
 * Mount a component and start rendering.
 *
 * Phase A2 (Lane 1): the custom renderer is the default. See
 * `shouldUseCustomRenderer()` above for the conditions that fall back to
 * vanilla Ink.
 */
export const render = (
  node: ReactNode,
  options?: NodeJS.WriteStream | RenderOptions,
): Instance => {
  const resolved = resolveOptions(options);
  if (
    shouldUseCustomRenderer(
      resolved.stdout,
      resolved.stderr,
      resolved.isScreenReaderEnabled,
    )
  ) {
    return startCustomRender(node, resolved);
  }
  return inkRender(node, options as NodeJS.WriteStream | undefined) as Instance;
};

export default render;
