// AppContext — owned port of ink/build/components/AppContext.js.
//
// Originally vendored at Phase 1 (Lane 1 of reconciler-full-activation).
// Provides the React context that exposes the app `exit()` method to
// consumer hooks (useApp).

import { createContext } from "react";
import { noopSuspendTerminal, type SuspendTerminal } from "../suspendTerminal.ts";

export type Props = {
  /** Exit (unmount) the whole Ink app. */
  readonly exit: (error?: Error) => void;
  /**
   * Temporarily release the terminal so a child process (`$EDITOR`, a pager,
   * a shell) can own it, then restore raw mode + repaint. @see SuspendTerminal
   */
  readonly suspendTerminal: SuspendTerminal;
};

const AppContext = createContext<Props>({
  exit() {},
  suspendTerminal: noopSuspendTerminal,
});
AppContext.displayName = "InternalAppContext";
export default AppContext;
