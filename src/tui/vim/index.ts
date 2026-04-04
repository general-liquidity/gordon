// ============================================================================
// Vim Module — Barrel Export
// ============================================================================

export { VimMode, type VimState, type VimAction, INITIAL_VIM_STATE } from "./types.js";
export { applyMotion } from "./motions.js";
export { applyOperator, type OperatorResult } from "./operators.js";
export { selectTextObject } from "./textObjects.js";
export { transition } from "./transitions.js";
