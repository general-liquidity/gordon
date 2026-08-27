// ============================================================================
// Vim Types — State machine for modal editing in the prompt
//
// The NORMAL-mode command parser is a discriminated union (CommandState).
// Each state knows exactly which keystroke it is waiting for, so routing a
// pending operator / find target / text-object scope is a total function over
// the union rather than a bag of nullable fields. Ported from the Claude Code
// vim state machine, adapted to Gordon's grapheme-index cursor model.
// ============================================================================

export enum VimMode {
  Insert = "INSERT",
  Normal = "NORMAL",
  Visual = "VISUAL",
}

export type Operator = "delete" | "change" | "yank";
export type FindType = "f" | "F" | "t" | "T";
export type TextObjScope = "inner" | "around";

// ----------------------------------------------------------------------------
// NORMAL-mode command parser states.
// ----------------------------------------------------------------------------
export type CommandState =
  | { type: "idle" }
  | { type: "count"; digits: string }
  | { type: "operator"; op: Operator; count: number }
  | { type: "operatorCount"; op: Operator; count: number; digits: string }
  | { type: "operatorFind"; op: Operator; count: number; find: FindType }
  | { type: "operatorTextObj"; op: Operator; count: number; scope: TextObjScope }
  | { type: "find"; find: FindType; count: number }
  | { type: "g"; count: number }
  | { type: "operatorG"; op: Operator; count: number }
  | { type: "replace"; count: number }
  | { type: "indent"; dir: ">" | "<"; count: number };

// ----------------------------------------------------------------------------
// Recorded change for dot-repeat. Captures everything needed to replay a
// buffer-mutating command.
// ----------------------------------------------------------------------------
export type RecordedChange =
  | { type: "insert"; text: string }
  | { type: "operatorMotion"; op: Operator; motion: string; count: number }
  | { type: "lineOp"; op: Operator; count: number }
  | { type: "delToEol"; op: Operator; count: number }
  | { type: "operatorTextObj"; op: Operator; scope: TextObjScope; objType: string; count: number }
  | { type: "operatorFind"; op: Operator; find: FindType; char: string; count: number }
  | { type: "operatorG"; op: Operator; toFirst: boolean; count: number }
  | { type: "x"; count: number }
  | { type: "replace"; char: string; count: number }
  | { type: "toggleCase"; count: number }
  | { type: "join"; count: number }
  | { type: "indent"; dir: ">" | "<"; count: number }
  | { type: "openLine"; direction: "above" | "below" }
  | { type: "paste"; after: boolean; count: number };

// ----------------------------------------------------------------------------
// Persistent state that survives across commands and mode switches: the yank
// register, the last find (for ; / ,) and the last change (for .).
// ----------------------------------------------------------------------------
export interface PersistentState {
  register: { content: string; linewise: boolean };
  lastFind: { type: FindType; char: string } | null;
  lastChange: RecordedChange | null;
}

export interface VimState {
  mode: VimMode;
  command: CommandState;
}

export const INITIAL_VIM_STATE: VimState = {
  mode: VimMode.Insert,
  command: { type: "idle" },
};

export function createInitialPersistentState(): PersistentState {
  return {
    register: { content: "", linewise: false },
    lastFind: null,
    lastChange: null,
  };
}

// ============================================================================
// Key groups — named sets, no magic strings.
// ============================================================================

export const OPERATORS = {
  d: "delete",
  c: "change",
  y: "yank",
} as const satisfies Record<string, Operator>;

export function isOperatorKey(key: string): key is keyof typeof OPERATORS {
  return key in OPERATORS;
}

// Simple motions resolvable via applyMotion. j/k are intentionally absent —
// the prompt has no vertical cursor movement, so dj/dk are not offered.
export const SIMPLE_MOTIONS = new Set(["h", "l", "w", "b", "e", "W", "B", "E", "0", "^", "$"]);

export const FIND_KEYS = new Set<FindType>(["f", "F", "t", "T"]);

export const TEXT_OBJ_SCOPES = {
  i: "inner",
  a: "around",
} as const satisfies Record<string, TextObjScope>;

export function isTextObjScopeKey(key: string): key is keyof typeof TEXT_OBJ_SCOPES {
  return key in TEXT_OBJ_SCOPES;
}

export const TEXT_OBJ_TYPES = new Set([
  "w",
  "W",
  '"',
  "'",
  "`",
  "(",
  ")",
  "[",
  "]",
  "{",
  "}",
  "<",
  ">",
]);

export const MAX_VIM_COUNT = 10000;
