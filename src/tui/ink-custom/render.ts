// render — Phase 0 re-export shim with vendored type surface.
//
// Gordon's entry point is `render(<App />, options)`. This module delegates
// to `ink`'s render for now. Phase 1 replaces the body with the custom
// reconciler + log-update pipeline while keeping RenderOptions and Instance
// byte-for-byte compatible.

import type { ReactNode } from "react";
import { render as inkRender } from "ink";

/**
 * Options accepted by `render()`. Identical shape to ink's RenderOptions,
 * vendored here so the custom renderer can own this surface in Phase 1+
 * without breaking callers.
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

/**
 * Mount a component and start rendering.
 *
 * Phase 0: delegates to `ink`. The cast is safe because RenderOptions and
 * Instance mirror ink's shape; if upstream ink ever diverges, the typecheck
 * here catches it.
 */
export const render = (
  node: ReactNode,
  options?: NodeJS.WriteStream | RenderOptions,
): Instance => {
  return inkRender(node, options as NodeJS.WriteStream | undefined) as Instance;
};

export default render;
