// useStdout — owned port of ink/build/hooks/use-stdout.ts.
//
// Reads from the owned StdoutContext (`../contexts/StdoutContext.ts`),
// populated by App.tsx. See hooks/use-app.ts for why the ink re-export
// shim had to go.

import { useContext } from "react";
import StdoutContext from "../contexts/StdoutContext.ts";

/**
 * React hook exposing the stdout WriteStream Ink is rendering into,
 * plus a `write()` helper that goes through the renderer's reserved-area
 * logic so external writes don't tear the live paint.
 *
 * ```tsx
 * const { stdout, write } = useStdout();
 * ```
 */
const useStdout = () => useContext(StdoutContext);
export default useStdout;
