// render — entry point with env-flag-gated custom pipeline.
//
// The custom renderer is opt-in. Even when enabled, an environment-driven
// fallback condition can force vanilla Ink.
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

import React, { type ReactNode, useEffect, useMemo, useRef } from "react";
import { EventEmitter } from "node:events";
import process from "node:process";
import ansiEscapes from "ansi-escapes";
import {
  render as inkRender,
  useApp as inkUseApp,
  useStdin as inkUseStdin,
  useStdout as inkUseStdout,
  useStderr as inkUseStderr,
} from "ink";
import { startCustomRender } from "./customRender.ts";
import { createSuspendTerminal, type SuspendTerminal } from "./suspendTerminal.ts";
import { loadLabsFlagsIntoEnv } from "./loadLabsFlags.ts";
import OurAppContext from "./contexts/AppContext.ts";
import OurStdinContext from "./contexts/StdinContext.ts";
import OurStdoutContext from "./contexts/StdoutContext.ts";
import OurStderrContext from "./contexts/StderrContext.ts";
import {
  createInputPipeline,
  ENABLE_BRACKETED_PASTE,
  DISABLE_BRACKETED_PASTE,
} from "./stdin-tokenizer.ts";

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
  /** Enable screen reader support. Environment auto-detection is the default. */
  isScreenReaderEnabled?: boolean;
  /** Maximum frames per second. @default 30 */
  maxFps?: number;
  /** Only re-paint changed lines (the Phase 5 target). @default false */
  incrementalRendering?: boolean;
  /**
   * Render into the terminal's alternate screen buffer. Enters the alt buffer
   * on mount and restores the primary screen on exit / unmount. Only applies
   * on a TTY. @default false
   */
  alternateScreen?: boolean;
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
   * The custom pipeline repaints this range with inverse-video cells while
   * leaving the content framebuffer untouched. @internal
   */
  setSelection?: (range: SelectionRange | null) => void;
  /** Clear any active selection. @see setSelection */
  clearSelection?: () => void;
};

/**
 * Decide whether to drive a render through the custom pipeline.
 *
 * **DEFAULT OFF as of the rendering-bug rollback.** The custom pipeline
 * is opt-in via `GORDON_CUSTOM_RENDER=1`. Real-world testing surfaced cell
 * interleaving / cursor-positioning bugs (visible as scrambled text on
 * mount) that aren't reproduced by the unit tests. Until those land a
 * runtime fix, vanilla Ink remains the production renderer.
 *
 * The fallback-condition logic is preserved for the opt-in path: even
 * when a user sets the flag, dumb terminals / tmux / non-TTY / screen
 * reader still route to vanilla Ink. One stderr line per process when
 * a fallback overrides an opt-in.
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
  const flag = process.env.GORDON_CUSTOM_RENDER;
  // Default OFF: only enabled by explicit opt-in.
  if (flag !== "1" && flag !== "true") {
    return false;
  }
  // Even with explicit opt-in, hard fallback conditions still force vanilla.
  if (isScreenReaderEnabled) {
    emitFallbackNotice(resolvedStderr, "screen reader enabled");
    return false;
  }
  // Node reports redirected stdout as either `false` or `undefined` depending
  // on the stream implementation. Only an affirmative TTY is safe for cursor
  // movement and alternate-frame assumptions.
  if (resolvedStdout.isTTY !== true) {
    emitFallbackNotice(resolvedStderr, "stdout is not a TTY");
    return false;
  }
  if (process.env.TERM === "dumb") {
    emitFallbackNotice(resolvedStderr, "TERM=dumb");
    return false;
  }
  // tmux/screen strip DEC sync-output BSU/ESU pairs that the syncTerminal
  // helper depends on, breaking our atomic-frame guarantee.
  if (process.env.TMUX) {
    emitFallbackNotice(resolvedStderr, "tmux detected");
    return false;
  }
  if (process.env.STY) {
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
  const opts = (
    options && typeof (options as NodeJS.WriteStream).write === "function"
      ? { stdout: options as NodeJS.WriteStream }
      : (options ?? {})
  ) as RenderOptions;

  return {
    stdout: opts.stdout ?? process.stdout,
    stdin: opts.stdin ?? process.stdin,
    stderr: opts.stderr ?? process.stderr,
    debug: opts.debug ?? false,
    exitOnCtrlC: opts.exitOnCtrlC ?? true,
    patchConsole: opts.patchConsole ?? true,
    onRender: opts.onRender ?? (() => {}),
    isScreenReaderEnabled: opts.isScreenReaderEnabled ?? isScreenReaderEnvironment(),
    maxFps: opts.maxFps ?? 30,
    incrementalRendering: opts.incrementalRendering ?? false,
    alternateScreen: opts.alternateScreen ?? false,
  };
}

function isScreenReaderEnvironment(): boolean {
  const env = process.env;
  return (
    env.INK_SCREEN_READER === "true" ||
    env.ACCESSIBILITY_ENABLED === "true" ||
    env.SCREEN_READER === "true" ||
    env.GORDON_SCREEN_READER === "true" ||
    env.VOICE_OVER_ENABLED === "1" ||
    env.NARRATOR_RUNNING === "1"
  );
}

/**
 * Enter the alternate screen buffer for the life of an instance and restore
 * the primary screen when the app exits, unmounts, or the process dies.
 *
 * Path-agnostic: wraps the returned Instance's teardown methods regardless of
 * whether the custom or vanilla renderer produced it. A no-op when disabled or
 * when stdout is not a TTY (alt screen is meaningless on a pipe/redirect).
 *
 * Exported for tests: pass a fake instance + stdout to assert the enter/exit
 * sequences are emitted without spinning up a real renderer.
 */
export function installAlternateScreen(
  instance: Instance,
  stdout: NodeJS.WriteStream,
  enabled: boolean,
): Instance {
  if (!enabled || !stdout.isTTY) return instance;

  try {
    stdout.write(ansiEscapes.enterAlternativeScreen);
  } catch {
    // startup must never throw on a stdout write
  }

  let restored = false;
  const restore = (): void => {
    if (restored) return;
    restored = true;
    try {
      stdout.write(ansiEscapes.exitAlternativeScreen);
    } catch {
      // teardown must never throw
    }
    process.removeListener("exit", restore);
  };
  process.once("exit", restore);

  const originalUnmount = instance.unmount;
  const originalCleanup = instance.cleanup;
  const originalWaitUntilExit = instance.waitUntilExit;

  return {
    ...instance,
    unmount: () => {
      originalUnmount();
      restore();
    },
    cleanup: () => {
      originalCleanup();
      restore();
    },
    waitUntilExit: () => originalWaitUntilExit().finally(restore),
  };
}

/**
 * Vanilla-Ink context bridge.
 *
 * Sits inside Ink's App provider tree, reads Ink's contexts via Ink's hooks,
 * and re-provides the same values to OUR owned contexts. Required because
 * after the A3 import swap, every consumer's `useApp` / `useInput` /
 * `useStdout` / `useStderr` resolves to our shims, which read from owned
 * contexts (`./contexts/*`). Ink's own App populates Ink's contexts, not
 * ours — without this bridge, raw mode never enables, the input
 * EventEmitter is the empty default, and `exit()` is a no-op.
 *
 * The four context shapes were ported 1-to-1 from Ink, so plumbing the
 * values straight through is type-safe.
 */
function VanillaInkContextBridge({
  suspendTerminal,
  children,
}: {
  suspendTerminal: SuspendTerminal;
  children?: ReactNode;
}): React.ReactElement {
  const app = inkUseApp();
  // Ink 7 narrowed `useStdin()`'s return type to `PublicProps`, but the runtime
  // context value is still the full internal `Props` (the internal fields are not
  // re-exported from "ink", so recover them by widening the returned object).
  const stdin = inkUseStdin() as ReturnType<typeof inkUseStdin> & {
    internal_eventEmitter: EventEmitter;
    internal_exitOnCtrlC: boolean;
  };
  const stdout = inkUseStdout();
  const stderr = inkUseStderr();

  // Ink's own App emits RAW stdin chunks on `internal_eventEmitter`. Re-provide
  // a wrapper emitter that carries COMPLETE tokens instead: run every raw chunk
  // through the streaming pipeline (cross-read escape/mouse buffering + ESC
  // disambiguation + bracketed-paste coalescing) so our `useInput` shim never
  // sees a split arrow key, an embedded control sequence, or a multi-line paste
  // that fires Enter. This is the vanilla-render counterpart to the custom App's
  // dispatchChunk wiring; the parser is live on both paths.
  const bridgedEmitter = useRef<EventEmitter | null>(null);
  if (bridgedEmitter.current === null) bridgedEmitter.current = new EventEmitter();
  const emitter = bridgedEmitter.current;

  const inkEmitter = stdin.internal_eventEmitter;
  const inkStream = stdin.stdin;
  const stdoutStream = stdout.stdout;

  useEffect(() => {
    const pipeline = createInputPipeline(
      {
        onKey: (seq) => emitter.emit("input", seq),
        onMouse: (event) => emitter.emit("mouse", event),
        onPaste: (text) => emitter.emit("paste", text),
      },
      {
        // Vanilla ink does not enable mouse tracking, so no `ESC [ <` bytes
        // arrive; keep them on the keypress path for byte-exact parity.
        mouseEnabled: () => false,
        getReadableLength: () =>
          (inkStream as unknown as { readableLength?: number }).readableLength ?? 0,
      },
    );
    const onRawChunk = (chunk: string | Buffer): void => {
      pipeline.feed(typeof chunk === "string" ? chunk : String(chunk));
    };
    inkEmitter?.on("input", onRawChunk);

    let pasteEnabled = false;
    if (stdoutStream?.isTTY) {
      try {
        stdoutStream.write(ENABLE_BRACKETED_PASTE);
        pasteEnabled = true;
      } catch {
        // Non-essential — degrade silently.
      }
    }

    return () => {
      inkEmitter?.removeListener("input", onRawChunk);
      pipeline.dispose();
      if (pasteEnabled) {
        try {
          stdoutStream.write(DISABLE_BRACKETED_PASTE);
        } catch {
          // Best-effort on teardown.
        }
      }
    };
  }, [emitter, inkEmitter, inkStream, stdoutStream]);

  const bridgedStdin = useMemo(
    () => ({ ...stdin, internal_eventEmitter: emitter }),
    [stdin, emitter],
  );

  return React.createElement(
    OurAppContext.Provider,
    { value: { ...app, suspendTerminal } },
    React.createElement(
      OurStdinContext.Provider,
      { value: bridgedStdin },
      React.createElement(
        OurStdoutContext.Provider,
        { value: stdout },
        React.createElement(OurStderrContext.Provider, { value: stderr }, children),
      ),
    ),
  );
}

/**
 * Mount a component and start rendering.
 *
 * After the A2 rollback the custom renderer is opt-in (`GORDON_CUSTOM_RENDER=1`).
 * The vanilla-Ink path wraps the user tree in VanillaInkContextBridge so our
 * hook shims see populated owned contexts. The custom path's owned App
 * populates them directly, no bridge needed.
 */
export const render = (node: ReactNode, options?: NodeJS.WriteStream | RenderOptions): Instance => {
  const resolved = resolveOptions(options);
  if (shouldUseCustomRenderer(resolved.stdout, resolved.stderr, resolved.isScreenReaderEnabled)) {
    const customInstance = startCustomRender(node, resolved);
    return installAlternateScreen(customInstance, resolved.stdout, resolved.alternateScreen);
  }

  // Vanilla ink@6 path. Build a `suspendTerminal` bound to the ink instance
  // (created below) + the underlying TTY, and thread it through the bridge so
  // `useApp().suspendTerminal(fn)` works exactly like on the custom path.
  const instanceHolder: { instance: Instance | null } = { instance: null };
  const rawStdin = resolved.stdin;
  const isRawModeSupported = Boolean(rawStdin.isTTY) && typeof rawStdin.setRawMode === "function";

  const buildBridged = (): React.ReactElement =>
    React.createElement(VanillaInkContextBridge, { suspendTerminal }, node);

  const suspendTerminal: SuspendTerminal = createSuspendTerminal({
    pauseRender: () => {
      // Erase ink's live frame and show the cursor so the child starts clean.
      try {
        instanceHolder.instance?.clear();
      } catch {
        // best-effort
      }
      try {
        resolved.stdout.write(ansiEscapes.cursorShow);
      } catch {
        // best-effort
      }
    },
    resumeRender: () => {
      // Hide the cursor again and force ink to recommit a full frame. ink@6
      // exposes no private lastOutput reset, so we remount a fresh bridged
      // element — the app's next render repaints from a cleared baseline.
      try {
        resolved.stdout.write(ansiEscapes.cursorHide);
      } catch {
        // best-effort
      }
      try {
        instanceHolder.instance?.rerender(buildBridged());
      } catch {
        // best-effort
      }
    },
    // Force raw mode off/on directly on the TTY so the child truly owns stdin
    // regardless of ink's internal raw-mode ref count.
    pauseInput: () => {
      if (isRawModeSupported) {
        try {
          rawStdin.setRawMode(false);
        } catch {
          // best-effort
        }
      }
    },
    resumeInput: () => {
      if (isRawModeSupported) {
        try {
          rawStdin.setRawMode(true);
        } catch {
          // best-effort
        }
      }
    },
  });

  const instance = inkRender(buildBridged(), options as NodeJS.WriteStream | undefined) as Instance;
  instanceHolder.instance = instance;
  return installAlternateScreen(instance, resolved.stdout, resolved.alternateScreen);
};

export default render;
