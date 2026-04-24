// AppContext — owned port of ink/build/components/AppContext.js.
//
// Originally vendored at Phase 1 (Lane 1 of reconciler-full-activation).
// Provides the React context that exposes the app `exit()` method to
// consumer hooks (useApp).

import { createContext } from "react";

export type Props = {
  /** Exit (unmount) the whole Ink app. */
  readonly exit: (error?: Error) => void;
};

const AppContext = createContext<Props>({
  exit() {},
});
AppContext.displayName = "InternalAppContext";
export default AppContext;
