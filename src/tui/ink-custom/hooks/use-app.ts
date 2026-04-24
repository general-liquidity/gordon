// useApp — owned port of ink/build/hooks/use-app.ts.
//
// Previously a re-export shim delegating to `ink`. Now reads from the
// owned AppContext in `../contexts/AppContext.ts`, which is populated by
// the owned App component at `../components/App.ts`. Without this port,
// consumer hooks under GORDON_CUSTOM_RENDER=1 would read from ink's own
// context (empty default) because ink's hooks import ink's context by
// absolute module path.

import { useContext } from "react";
import AppContext from "../contexts/AppContext.ts";

/**
 * React hook exposing a method to manually exit (unmount) the app.
 *
 * ```tsx
 * const { exit } = useApp();
 * ```
 */
const useApp = () => useContext(AppContext);
export default useApp;
