// useStdin — owned port of ink/build/hooks/use-stdin.ts.
//
// Exposes the StdinContext value (stdin stream, raw-mode toggle, and the
// internal EventEmitter that App's readable-handler emits `input` events
// onto). Consumers are rare — useInput is the main caller; most
// components shouldn't touch stdin directly.

import { useContext } from "react";
import StdinContext from "../contexts/StdinContext.ts";

const useStdin = () => useContext(StdinContext);
export default useStdin;
