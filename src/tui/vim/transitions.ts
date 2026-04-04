// ============================================================================
// Vim Transitions — State machine for mode switching and command composition
// ============================================================================

import { VimMode, type VimState, type VimAction, INITIAL_VIM_STATE } from "./types.js";

const MOTIONS = new Set(["h", "l", "j", "k", "w", "b", "e", "W", "B", "E", "0", "$", "^"]);
const OPERATORS = new Set(["d", "c", "y"]);

interface TransitionResult {
  newState: VimState;
  action?: VimAction;
}

export function transition(
  state: VimState,
  key: string,
  ctrl: boolean,
  shift: boolean,
): TransitionResult {
  // INSERT mode: only Escape exits
  if (state.mode === VimMode.Insert) {
    if (key === "escape") {
      return { newState: { ...state, mode: VimMode.Normal, count: null, pendingOperator: null } };
    }
    return { newState: state };
  }

  // NORMAL mode
  if (state.mode === VimMode.Normal) {
    // Count prefix (digits)
    if (/^[1-9]$/.test(key) || (key === "0" && state.count !== null)) {
      const count = (state.count ?? 0) * 10 + parseInt(key);
      return { newState: { ...state, count } };
    }

    // Mode switch commands
    if (key === "i") return { newState: { ...state, mode: VimMode.Insert, count: null } };
    if (key === "a") return { newState: { ...state, mode: VimMode.Insert, count: null }, action: { type: "insert", motion: "l" } };
    if (key === "I") return { newState: { ...state, mode: VimMode.Insert, count: null }, action: { type: "insert", motion: "^" } };
    if (key === "A") return { newState: { ...state, mode: VimMode.Insert, count: null }, action: { type: "insert", motion: "$" } };

    // Operator pending
    if (OPERATORS.has(key) && !state.pendingOperator) {
      return { newState: { ...state, pendingOperator: key } };
    }

    // Operator + motion (e.g., dw, cw)
    if (state.pendingOperator && (MOTIONS.has(key) || key === state.pendingOperator)) {
      const op = state.pendingOperator;
      const action: VimAction = {
        type: op === "d" ? "delete" : op === "c" ? "change" : "yank",
        motion: key,
        count: state.count ?? 1,
      };
      const newMode = op === "c" ? VimMode.Insert : VimMode.Normal;
      return {
        newState: { ...state, mode: newMode, pendingOperator: null, count: null, dotRepeatAction: action },
        action,
      };
    }

    // Plain motions
    if (MOTIONS.has(key)) {
      return {
        newState: { ...state, count: null },
        action: { type: "insert", motion: key, count: state.count ?? 1 },
      };
    }

    // Find commands (f/F/t/T)
    if (key === "f" || key === "F" || key === "t" || key === "T") {
      // Need next keystroke for the target char — store as pending
      return { newState: { ...state, pendingOperator: `find_${key}` } };
    }

    // Dot repeat
    if (key === "." && state.dotRepeatAction) {
      return { newState: { ...state, count: null }, action: state.dotRepeatAction };
    }

    // Undo
    if (key === "u") {
      return { newState: { ...state, count: null }, action: { type: "insert", motion: "undo" } };
    }

    // Replace
    if (key === "r") {
      return { newState: { ...state, pendingOperator: "replace" } };
    }

    // x = delete char at cursor
    if (key === "x") {
      return {
        newState: { ...state, count: null },
        action: { type: "delete", motion: "l", count: state.count ?? 1 },
      };
    }

    // Escape clears pending state
    if (key === "escape") {
      return { newState: { ...state, pendingOperator: null, count: null } };
    }
  }

  return { newState: state };
}
