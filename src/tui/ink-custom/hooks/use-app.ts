// useApp — Phase 0 re-export shim.
//
// Returns { exit } so consumers can unmount the app. Phase 1 wires this to
// the custom renderer's teardown path (clear paint region, release stdin
// raw mode, restore cursor, etc).

import { useApp } from "ink";
export default useApp;
