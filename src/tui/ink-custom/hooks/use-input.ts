// useInput — Phase 0 re-export shim.
//
// Delegates to `ink`'s useInput. The Key type is vendored inline (see below)
// so Gordon's TypeScript surface doesn't depend on ink's generated d.ts.
// Phase 1 replaces this with a direct readline listener that emits the same
// Key shape.

import { useInput } from "ink";

/**
 * Information about a key that was pressed.
 *
 * This type is vendored (identical shape to `ink`'s Key) so that Phase 1+
 * can own it without a breaking change to consumers.
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

export default useInput;
