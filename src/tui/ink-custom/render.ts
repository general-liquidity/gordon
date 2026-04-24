// render — entry point with env-flag-gated custom pipeline.
//
// Default (GORDON_CUSTOM_RENDER unset or != "1"): delegate to vanilla Ink.
// Activated (GORDON_CUSTOM_RENDER=1): route through `customRender.ts`,
// which drives the Phase 1-6 cell-buffer pipeline.
//
// `customRender` is statically imported so the hot path at call time is a
// single branch. The transitive cost of loading the pipeline is already
// paid by vanilla ink (react-reconciler, yoga-layout) so there is no
// measurable startup penalty for the flag-off code path.

import type { ReactNode } from "react";
import process from "node:process";
import { render as inkRender } from "ink";
import { startCustomRender } from "./customRender.ts";

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
 * Handle returned from `render()`. Mirrors ink's Instance shape.
 */
export type Instance = {
  rerender: (node: ReactNode) => void;
  unmount: () => void;
  waitUntilExit: () => Promise<void>;
  cleanup: () => void;
  clear: () => void;
};

/** Check whether the custom renderer should be used. */
function isCustomRenderEnabled(): boolean {
  return process.env["GORDON_CUSTOM_RENDER"] === "1";
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
 */
export const render = (
  node: ReactNode,
  options?: NodeJS.WriteStream | RenderOptions,
): Instance => {
  if (isCustomRenderEnabled()) {
    return startCustomRender(node, resolveOptions(options));
  }
  return inkRender(node, options as NodeJS.WriteStream | undefined) as Instance;
};

export default render;
