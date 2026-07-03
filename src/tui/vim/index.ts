// ============================================================================
// Vim Module — Barrel Export
// ============================================================================

export {
  VimMode,
  type VimState,
  type CommandState,
  type PersistentState,
  type RecordedChange,
  type Operator,
  type FindType,
  type TextObjScope,
  INITIAL_VIM_STATE,
  createInitialPersistentState,
} from "./types.js";
export { applyMotion } from "./motions.js";
export { type VimContext, replayChange, findChar, gotoLine } from "./operators.js";
export { selectTextObject } from "./textObjects.js";
export { transition, type TransitionResult } from "./transitions.js";
