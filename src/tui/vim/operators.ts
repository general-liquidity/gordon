// ============================================================================
// Vim Operators — Delete, change, yank with motion support
// ============================================================================

import { applyMotion } from "./motions.js";

export interface OperatorResult {
  newText: string;
  newCursor: number;
  deleted?: string;
  enterInsert?: boolean;
}

export function applyOperator(
  text: string,
  cursor: number,
  operator: string,
  motion: string,
  count = 1,
): OperatorResult {
  // Line-wise operators
  if (motion === operator) {
    // dd, cc, yy — operate on entire text
    switch (operator) {
      case "d": return { newText: "", newCursor: 0, deleted: text };
      case "c": return { newText: "", newCursor: 0, deleted: text, enterInsert: true };
      case "y": return { newText: text, newCursor: cursor, deleted: text };
    }
  }

  const target = applyMotion(text, cursor, motion, count);
  const start = Math.min(cursor, target);
  const end = Math.max(cursor, target) + (motion === "$" ? 1 : 0);

  const before = text.slice(0, start);
  const deleted = text.slice(start, end);
  const after = text.slice(end);

  switch (operator) {
    case "d":
      return { newText: before + after, newCursor: start, deleted };
    case "c":
      return { newText: before + after, newCursor: start, deleted, enterInsert: true };
    case "y":
      return { newText: text, newCursor: cursor, deleted };
    default:
      return { newText: text, newCursor: cursor };
  }
}
