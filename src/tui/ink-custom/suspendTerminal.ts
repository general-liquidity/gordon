// suspendTerminal — port of Ink 7.1.0's `useApp().suspendTerminal`.
//
// Temporarily hands the terminal to an external program ($EDITOR, a pager, a
// shell): stop painting + erase Ink's live frame + show the cursor, release
// raw-mode input so the child owns stdin, run the program, then reclaim input
// and force a full redraw.
//
// Ported from ink7 `src/components/AppContext.ts` (the type surface) and the
// `beginSuspend` / `endSuspend` pair in `src/ink.tsx`. Kept transport-agnostic
// via four injected callbacks so the same core wires onto both Gordon render
// paths — the owned custom loop and the bridged vanilla ink@6 instance — and is
// unit-testable with fakes.

/**
 * A handle returned by `suspendTerminal()` when called without a callback.
 *
 * Call `resume()` to give terminal ownership back to the renderer, or use
 * `await using` so the suspension resumes automatically when it leaves scope.
 */
export type TerminalSuspension = {
  readonly resume: () => Promise<void>;
  readonly [Symbol.asyncDispose]: () => Promise<void>;
};

/**
 * Temporarily hand the terminal over to a child process, then restore the
 * renderer's terminal state and force a full redraw.
 */
export type SuspendTerminal = {
  (callback: () => void | Promise<void>): Promise<void>;
  (): Promise<TerminalSuspension>;
};

export type SuspendTerminalDeps = {
  /** Stop painting, erase the live frame, and show the cursor. */
  readonly pauseRender: () => void;
  /** Reclaim the screen: hide the cursor and force a full redraw. */
  readonly resumeRender: () => void | Promise<void>;
  /** Release terminal input (raw mode off) so the child process owns stdin. */
  readonly pauseInput: () => void;
  /** Reclaim terminal input (raw mode back on). */
  readonly resumeInput: () => void;
};

/**
 * Build a `suspendTerminal` bound to a specific transport. The returned
 * function supports both the callback form (renderer restored even if the
 * callback throws) and the handle form (caller resumes manually).
 */
export function createSuspendTerminal(deps: SuspendTerminalDeps): SuspendTerminal {
  let suspended = false;

  const begin = (): void => {
    if (suspended) {
      throw new Error(
        "The terminal is already suspended. Resume the current suspension before suspending again.",
      );
    }
    suspended = true;
    try {
      deps.pauseRender();
      deps.pauseInput();
    } catch (error) {
      // Never strand the app suspended with no way back — reclaim input,
      // clear the flag, and rethrow so the caller sees the failure.
      suspended = false;
      try {
        deps.resumeInput();
      } catch {
        // best-effort
      }
      throw error;
    }
  };

  const end = async (): Promise<void> => {
    if (!suspended) return;
    suspended = false;
    deps.resumeInput();
    await deps.resumeRender();
  };

  const suspend = (async (
    callback?: () => void | Promise<void>,
  ): Promise<void | TerminalSuspension> => {
    begin();

    if (callback) {
      try {
        await callback();
      } finally {
        await end();
      }
      return undefined;
    }

    const resume = async (): Promise<void> => {
      await end();
    };
    return { resume, [Symbol.asyncDispose]: resume };
  }) as SuspendTerminal;

  return suspend;
}

const noopSuspension: TerminalSuspension = {
  async resume() {},
  async [Symbol.asyncDispose]() {},
};

/**
 * Default `suspendTerminal` for contexts with no live transport (the
 * AppContext default value, screen-reader / non-TTY fallbacks). Runs the
 * callback but never touches the terminal.
 */
export const noopSuspendTerminal: SuspendTerminal = (async (
  callback?: () => void | Promise<void>,
): Promise<void | TerminalSuspension> => {
  if (callback) {
    await callback();
    return undefined;
  }
  return noopSuspension;
}) as SuspendTerminal;
