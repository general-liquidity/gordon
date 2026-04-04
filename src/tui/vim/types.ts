// ============================================================================
// Vim Types — State machine for modal editing in the prompt
// ============================================================================

export enum VimMode { Insert = "INSERT", Normal = "NORMAL", Visual = "VISUAL" }

export interface VimAction {
  type: "insert" | "delete" | "change" | "yank" | "replace" | "indent";
  text?: string;
  motion?: string;
  count?: number;
}

export interface VimState {
  mode: VimMode;
  register: string;
  count: number | null;
  pendingOperator: string | null;
  lastFind: { char: string; forward: boolean } | null;
  dotRepeatAction: VimAction | null;
}

export const INITIAL_VIM_STATE: VimState = {
  mode: VimMode.Insert,
  register: "",
  count: null,
  pendingOperator: null,
  lastFind: null,
  dotRepeatAction: null,
};
