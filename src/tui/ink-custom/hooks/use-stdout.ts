// useStdout — Phase 0 re-export shim.
//
// Exposes the stdout WriteStream Gordon is rendering into. Phase 1 keeps the
// same shape ({ stdout, write }) but the `write` helper will go through the
// custom renderer's "reserved area" logic so external writes don't tear the
// live paint region.

import { useStdout } from "ink";
export default useStdout;
