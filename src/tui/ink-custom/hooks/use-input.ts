// useInput — owned port of ink/build/hooks/use-input.ts.
//
// Subscribes to the `input` event on the owned StdinContext's EventEmitter
// (populated by App's handleReadable), parses the chunk via our owned
// parse-keypress, synthesizes the Key object, and invokes the consumer's
// handler inside a reconciler.batchedUpdates() boundary so multiple state
// updates during one key event commit in a single render.
//
// The Key shape is vendored here (identical to ink's Key) so consumers
// can continue to use `import { type Key } from '.../ink-custom'`.

import { useEffect } from "react";
import parseKeypress, { nonAlphanumericKeys } from "../parse-keypress.ts";
import reconciler from "../reconciler.ts";
import useStdin from "./use-stdin.ts";

/**
 * Information about a key that was pressed.
 */
export type Key = {
  upArrow: boolean;
  downArrow: boolean;
  leftArrow: boolean;
  rightArrow: boolean;
  pageDown: boolean;
  pageUp: boolean;
  home: boolean;
  end: boolean;
  return: boolean;
  escape: boolean;
  ctrl: boolean;
  shift: boolean;
  tab: boolean;
  backspace: boolean;
  delete: boolean;
  meta: boolean;
};

type InputHandler = (input: string, key: Key) => void;

interface UseInputOptions {
  readonly isActive?: boolean;
}

const useInput = (inputHandler: InputHandler, options: UseInputOptions = {}): void => {
  // eslint-disable-next-line @typescript-eslint/naming-convention
  const { stdin, setRawMode, isRawModeSupported, internal_exitOnCtrlC, internal_eventEmitter } = useStdin();

  useEffect(() => {
    // Guard on raw-mode support: with a non-TTY stdin (piped/redirected
    // boot), App.handleSetRawMode throws, the error boundary mounts
    // ErrorOverview, and ink's ErrorOverview keys stack rows by line text
    // — recursive reconciler frames repeat, producing a duplicate-key
    // warning loop. Headless boots simply skip raw mode instead.
    if (options.isActive === false || !isRawModeSupported) return;
    setRawMode(true);
    return () => {
      setRawMode(false);
    };
  }, [options.isActive, setRawMode, isRawModeSupported]);

  useEffect(() => {
    if (options.isActive === false) return;

    const handleData = (data: Buffer | string): void => {
      const keypress = parseKeypress(data);
      const key: Key = {
        upArrow: keypress.name === "up",
        downArrow: keypress.name === "down",
        leftArrow: keypress.name === "left",
        rightArrow: keypress.name === "right",
        pageDown: keypress.name === "pagedown",
        pageUp: keypress.name === "pageup",
        home: keypress.name === "home",
        end: keypress.name === "end",
        return: keypress.name === "return",
        escape: keypress.name === "escape",
        ctrl: keypress.ctrl,
        shift: keypress.shift,
        tab: keypress.name === "tab",
        backspace: keypress.name === "backspace",
        delete: keypress.name === "delete",
        // parseKeypress parses [A (meta+up) as meta=false + option=true;
        // treat any of {meta, escape, option} as meta so consumers match ink's behavior.
        meta: keypress.meta || keypress.name === "escape" || keypress.option,
      };

      let input = keypress.ctrl ? keypress.name : keypress.sequence;
      if (nonAlphanumericKeys.includes(keypress.name)) {
        input = "";
      }
      // Strip leading ESC if still present (ink legacy quirk).
      if (input.startsWith("")) {
        input = input.slice(1);
      }
      if (input.length === 1 && typeof input[0] === "string" && /[A-Z]/.test(input[0])) {
        key.shift = true;
      }

      // If the app is handling Ctrl+C itself, let the input handler see it.
      if (!(input === "c" && key.ctrl) || !internal_exitOnCtrlC) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (reconciler as any).batchedUpdates(() => {
          inputHandler(input, key);
        });
      }
    };

    internal_eventEmitter?.on("input", handleData);
    return () => {
      internal_eventEmitter?.removeListener("input", handleData);
    };
  }, [options.isActive, stdin, internal_exitOnCtrlC, inputHandler, internal_eventEmitter]);
};

export default useInput;
