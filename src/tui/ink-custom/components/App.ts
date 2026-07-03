// App — owned port of ink/build/components/App.js (Lane 1, Phase B1).
//
// Root component for all custom-renderer apps. Sets up the 5 context
// providers (App / Stdin / Stdout / Stderr / Focus) so descendants reading
// from those contexts (useApp, useInput, useStdout, useStderr, useFocus)
// see the live values, and runs the raw-mode + keypress event-emitter
// machinery for input handling.
//
// Side effects faithfully preserved from the upstream Ink implementation:
//   * cliCursor.hide(stdout) on mount, cliCursor.show(stdout) on unmount.
//   * Raw mode is ref-counted across consumers (`rawModeEnabledCount`)
//     so the last consumer leaving cleanly drops back out.
//   * Ctrl+C triggers `props.onExit()` when `props.exitOnCtrlC` is true.
//   * On `componentDidCatch`, the app exits with the error so the host
//     `render()` rejects waitUntilExit cleanly.
//   * `internal_eventEmitter` emits "input" with each chunk so hooks like
//     useInput can listen without re-attaching the readable handler.
//
// NOTE: this is a class component — same as upstream — because the raw-mode
// ref-count, error-boundary getDerivedStateFromError, and the lifecycle
// pairing (didMount/willUnmount around cli-cursor) are all easier to model
// imperatively than via hooks. Re-render is governed by PureComponent's
// shallow compare; no state-during-render shenanigans, all setState calls
// live inside event handlers (handleReadable, handleInput) or arrow
// callbacks invoked from descendants (focusNext, addFocusable, etc.).

import { EventEmitter } from "node:events";
import process from "node:process";
import React, { PureComponent, type ReactNode } from "react";
import cliCursor from "cli-cursor";
import AppContext from "../contexts/AppContext.ts";
import StdinContext from "../contexts/StdinContext.ts";
import StdoutContext from "../contexts/StdoutContext.ts";
import StderrContext from "../contexts/StderrContext.ts";
import FocusContext from "../contexts/FocusContext.ts";
import ErrorOverview from "./ErrorOverview.ts";
import {
  parseMouseSequence,
  MOUSE_ENABLE,
  MOUSE_DISABLE,
} from "../parse-mouse.ts";
import { noopSuspendTerminal, type SuspendTerminal } from "../suspendTerminal.ts";

const tab = "\t";
// eslint-disable-next-line no-control-regex
const shiftTab = "[Z";
// eslint-disable-next-line no-control-regex
const escape = "";

type Props = {
  readonly children?: ReactNode;
  readonly stdin: NodeJS.ReadStream;
  readonly stdout: NodeJS.WriteStream;
  readonly stderr: NodeJS.WriteStream;
  readonly writeToStdout: (data: string) => void;
  readonly writeToStderr: (data: string) => void;
  readonly exitOnCtrlC: boolean;
  readonly onExit: (error?: Error) => void;
  /**
   * Renderer-owned `suspendTerminal` implementation, exposed to descendants
   * via `useApp()`. Defaults to a no-op when the host doesn't wire one.
   */
  readonly suspendTerminal?: SuspendTerminal;
  /**
   * Hand the renderer force-off/force-on input controls so its
   * `suspendTerminal` can release and reclaim raw mode around a child process,
   * without disturbing the raw-mode ref count the components still own.
   */
  readonly registerInputControl?: (
    pauseInput: () => void,
    resumeInput: () => void,
  ) => void;
};

type Focusable = {
  readonly id: string;
  readonly isActive: boolean;
};

type State = {
  readonly isFocusEnabled: boolean;
  readonly activeFocusId?: string;
  readonly focusables: Focusable[];
  readonly error?: Error;
};

export default class App extends PureComponent<Props, State> {
  static displayName = "InternalApp";

  static getDerivedStateFromError(error: Error): { error: Error } {
    return { error };
  }

  override state: State = {
    isFocusEnabled: true,
    activeFocusId: undefined,
    focusables: [],
    error: undefined,
  };

  // Count how many components enabled raw mode to avoid disabling raw mode
  // until all components don't need it anymore.
  rawModeEnabledCount = 0;

  // eslint-disable-next-line @typescript-eslint/naming-convention
  internal_eventEmitter = new EventEmitter();

  // True iff we wrote MOUSE_ENABLE on mount and still owe a MOUSE_DISABLE
  // on unmount. We only enable when stdout is a TTY and the user has not
  // opted into screen-reader mode (screen readers can choke on bracketed
  // mouse-mode bytes leaking into the line buffer, plus the events would
  // be ignored anyway).
  mouseModeActive = false;

  // Determines if TTY is supported on the provided stdin.
  isRawModeSupported(): boolean {
    return Boolean(this.props.stdin.isTTY);
  }

  override render(): React.JSX.Element {
    return React.createElement(
      AppContext.Provider,
      {
        value: {
          exit: this.handleExit,
          suspendTerminal: this.props.suspendTerminal ?? noopSuspendTerminal,
        },
      },
      React.createElement(
        StdinContext.Provider,
        {
          value: {
            stdin: this.props.stdin,
            setRawMode: this.handleSetRawMode,
            isRawModeSupported: this.isRawModeSupported(),
            // eslint-disable-next-line @typescript-eslint/naming-convention
            internal_exitOnCtrlC: this.props.exitOnCtrlC,
            // eslint-disable-next-line @typescript-eslint/naming-convention
            internal_eventEmitter: this.internal_eventEmitter,
          },
        },
        React.createElement(
          StdoutContext.Provider,
          {
            value: {
              stdout: this.props.stdout,
              write: this.props.writeToStdout,
            },
          },
          React.createElement(
            StderrContext.Provider,
            {
              value: {
                stderr: this.props.stderr,
                write: this.props.writeToStderr,
              },
            },
            React.createElement(
              FocusContext.Provider,
              {
                value: {
                  activeId: this.state.activeFocusId,
                  add: this.addFocusable,
                  remove: this.removeFocusable,
                  activate: this.activateFocusable,
                  deactivate: this.deactivateFocusable,
                  enableFocus: this.enableFocus,
                  disableFocus: this.disableFocus,
                  focusNext: this.focusNext,
                  focusPrevious: this.focusPrevious,
                  focus: this.focus,
                },
              },
              this.state.error
                ? React.createElement(ErrorOverview, { error: this.state.error })
                : this.props.children,
            ),
          ),
        ),
      ),
    );
  }

  // Raw mode active at the moment suspendTerminal() paused input, so resume
  // reinstates exactly what was on without touching rawModeEnabledCount (the
  // components still "own" raw mode across the suspension).
  suspendedRawMode = false;

  override componentDidMount(): void {
    cliCursor.hide(this.props.stdout);
    this.enableMouseMode();
    this.props.registerInputControl?.(this.pauseInput, this.resumeInput);
  }

  override componentWillUnmount(): void {
    cliCursor.show(this.props.stdout);
    this.disableMouseMode();
    // ignore calling setRawMode on a stdin handle that doesn't support it
    if (this.isRawModeSupported()) {
      this.handleSetRawMode(false);
    }
  }

  /** Returns true if any common screen-reader env var is set. Mirrors
   *  the logic in `useScreenReader` so we don't pull a React hook into
   *  this class component. */
  isScreenReaderActive(): boolean {
    const env = process.env;
    return (
      env["ACCESSIBILITY_ENABLED"] === "true" ||
      env["SCREEN_READER"] === "true" ||
      env["GORDON_SCREEN_READER"] === "true" ||
      env["VOICE_OVER_ENABLED"] === "1" ||
      env["NARRATOR_RUNNING"] === "1"
    );
  }

  enableMouseMode(): void {
    if (this.mouseModeActive) return;
    if (!this.props.stdin?.isTTY) return;
    if (!this.props.stdout?.isTTY) return;
    if (this.isScreenReaderActive()) return;
    try {
      this.props.stdout.write(MOUSE_ENABLE);
      this.mouseModeActive = true;
    } catch {
      // Some stdout impls (e.g. pipe-backed) reject writes mid-shutdown.
      // Mouse is non-essential — silently degrade.
    }
  }

  disableMouseMode(): void {
    if (!this.mouseModeActive) return;
    this.mouseModeActive = false;
    try {
      this.props.stdout.write(MOUSE_DISABLE);
    } catch {
      // See enableMouseMode — best-effort.
    }
  }

  override componentDidCatch(error: Error): void {
    this.handleExit(error);
  }

  handleSetRawMode = (isEnabled: boolean): void => {
    const { stdin } = this.props;
    if (!this.isRawModeSupported()) {
      if (stdin === process.stdin) {
        throw new Error(
          "Raw mode is not supported on the current process.stdin, which Ink uses as input stream by default.\nRead about how to prevent this error on https://github.com/vadimdemedes/ink/#israwmodesupported",
        );
      } else {
        throw new Error(
          "Raw mode is not supported on the stdin provided to Ink.\nRead about how to prevent this error on https://github.com/vadimdemedes/ink/#israwmodesupported",
        );
      }
    }
    stdin.setEncoding("utf8");
    if (isEnabled) {
      // Ensure raw mode is enabled only once
      if (this.rawModeEnabledCount === 0) {
        stdin.ref();
        stdin.setRawMode(true);
        stdin.addListener("readable", this.handleReadable);
      }
      this.rawModeEnabledCount++;
      return;
    }
    // Disable raw mode only when no components left that are using it
    if (--this.rawModeEnabledCount === 0) {
      stdin.setRawMode(false);
      stdin.removeListener("readable", this.handleReadable);
      stdin.unref();
    }
  };

  // Hand raw-mode input back to the terminal for a suspendTerminal() window.
  // Forces raw mode off regardless of the ref count so the child process
  // actually owns stdin; remembers whether it was on so resume is symmetric.
  pauseInput = (): void => {
    const wasRawMode = this.isRawModeSupported() && this.rawModeEnabledCount > 0;
    this.suspendedRawMode = wasRawMode;
    if (wasRawMode) {
      const { stdin } = this.props;
      stdin.setRawMode(false);
      stdin.removeListener("readable", this.handleReadable);
      stdin.unref();
    }
  };

  resumeInput = (): void => {
    if (!this.suspendedRawMode) return;
    this.suspendedRawMode = false;
    const { stdin } = this.props;
    stdin.setEncoding("utf8");
    stdin.ref();
    stdin.setRawMode(true);
    stdin.addListener("readable", this.handleReadable);
  };

  handleReadable = (): void => {
    let chunk: string | null;
    // Drain everything currently buffered, dispatching each chunk.
    while ((chunk = this.props.stdin.read() as string | null) !== null) {
      this.dispatchChunk(chunk);
    }
  };

  /**
   * Split a raw stdin chunk into mouse events and keypress bytes.
   *
   * Mouse mode (when active) emits CSI sequences starting with `\x1b[<`.
   * We peel those off the front of the buffer and emit them as `mouse`
   * events on the internal emitter. Anything that isn't a complete mouse
   * sequence falls through to the existing keypress path so we never
   * lose bytes — a partial mouse sequence at end-of-chunk would emit as
   * keypress, which is benign for downstream consumers.
   */
  dispatchChunk = (chunk: string): void => {
    if (!this.mouseModeActive) {
      this.handleInput(chunk);
      this.internal_eventEmitter.emit("input", chunk);
      return;
    }
    let remaining = chunk;
    while (remaining.length > 0 && remaining.startsWith("\x1b[<")) {
      const { event, consumed } = parseMouseSequence(remaining);
      if (consumed === 0) break;
      if (event) {
        this.internal_eventEmitter.emit("mouse", event);
      }
      remaining = remaining.slice(consumed);
    }
    if (remaining.length === 0) return;
    this.handleInput(remaining);
    this.internal_eventEmitter.emit("input", remaining);
  };

  handleInput = (input: string): void => {
    // Exit on Ctrl+C
    if (input === "\x03" && this.props.exitOnCtrlC) {
      this.handleExit();
    }
    // Reset focus when there's an active focused component on Esc
    if (input === escape && this.state.activeFocusId) {
      this.setState({
        activeFocusId: undefined,
      });
    }
    if (this.state.isFocusEnabled && this.state.focusables.length > 0) {
      if (input === tab) {
        this.focusNext();
      }
      if (input === shiftTab) {
        this.focusPrevious();
      }
    }
  };

  handleExit = (error?: Error): void => {
    if (this.isRawModeSupported()) {
      this.handleSetRawMode(false);
    }
    this.props.onExit(error);
  };

  enableFocus = (): void => {
    this.setState({
      isFocusEnabled: true,
    });
  };

  disableFocus = (): void => {
    this.setState({
      isFocusEnabled: false,
    });
  };

  focus = (id: string): void => {
    this.setState((previousState) => {
      const hasFocusableId = previousState.focusables.some(
        (focusable) => focusable?.id === id,
      );
      if (!hasFocusableId) {
        return previousState;
      }
      return { ...previousState, activeFocusId: id };
    });
  };

  focusNext = (): void => {
    this.setState((previousState) => {
      const firstFocusableId = previousState.focusables.find(
        (focusable) => focusable.isActive,
      )?.id;
      const nextFocusableId = this.findNextFocusable(previousState);
      return {
        ...previousState,
        activeFocusId: nextFocusableId ?? firstFocusableId,
      };
    });
  };

  focusPrevious = (): void => {
    this.setState((previousState) => {
      const lastFocusableId = previousState.focusables.findLast(
        (focusable) => focusable.isActive,
      )?.id;
      const previousFocusableId = this.findPreviousFocusable(previousState);
      return {
        ...previousState,
        activeFocusId: previousFocusableId ?? lastFocusableId,
      };
    });
  };

  addFocusable = (id: string, { autoFocus }: { autoFocus: boolean }): void => {
    this.setState((previousState) => {
      let nextFocusId = previousState.activeFocusId;
      if (!nextFocusId && autoFocus) {
        nextFocusId = id;
      }
      return {
        ...previousState,
        activeFocusId: nextFocusId,
        focusables: [
          ...previousState.focusables,
          {
            id,
            isActive: true,
          },
        ],
      };
    });
  };

  removeFocusable = (id: string): void => {
    this.setState((previousState) => ({
      ...previousState,
      activeFocusId:
        previousState.activeFocusId === id
          ? undefined
          : previousState.activeFocusId,
      focusables: previousState.focusables.filter((focusable) => {
        return focusable.id !== id;
      }),
    }));
  };

  activateFocusable = (id: string): void => {
    this.setState((previousState) => ({
      ...previousState,
      focusables: previousState.focusables.map((focusable) => {
        if (focusable.id !== id) {
          return focusable;
        }
        return {
          id,
          isActive: true,
        };
      }),
    }));
  };

  deactivateFocusable = (id: string): void => {
    this.setState((previousState) => ({
      ...previousState,
      activeFocusId:
        previousState.activeFocusId === id
          ? undefined
          : previousState.activeFocusId,
      focusables: previousState.focusables.map((focusable) => {
        if (focusable.id !== id) {
          return focusable;
        }
        return {
          id,
          isActive: false,
        };
      }),
    }));
  };

  findNextFocusable = (state: State): string | undefined => {
    const activeIndex = state.focusables.findIndex((focusable) => {
      return focusable.id === state.activeFocusId;
    });
    for (let index = activeIndex + 1; index < state.focusables.length; index++) {
      const focusable = state.focusables[index];
      if (focusable?.isActive) {
        return focusable.id;
      }
    }
    return undefined;
  };

  findPreviousFocusable = (state: State): string | undefined => {
    const activeIndex = state.focusables.findIndex((focusable) => {
      return focusable.id === state.activeFocusId;
    });
    for (let index = activeIndex - 1; index >= 0; index--) {
      const focusable = state.focusables[index];
      if (focusable?.isActive) {
        return focusable.id;
      }
    }
    return undefined;
  };
}
