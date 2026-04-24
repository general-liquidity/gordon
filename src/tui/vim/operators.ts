// ============================================================================
// Vim Operators — Delete, change, yank with motion support
//
// Cursor positions are grapheme indices. We resolve motion targets in the
// grapheme space via applyMotion, then convert to UTF-16 code-unit indices
// when slicing the underlying string. This keeps CJK / emoji text edits
// consistent with what the user sees on screen.
// ============================================================================

import { applyMotion } from "./motions.js";
import { graphemeToCodeUnit, codeUnitToGrapheme } from "../utils/graphemes.js";

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
  // Line-wise operators — operate on entire buffer regardless of encoding.
  if (motion === operator) {
    // dd, cc, yy
    switch (operator) {
      case "d": return { newText: "", newCursor: 0, deleted: text };
      case "c": return { newText: "", newCursor: 0, deleted: text, enterInsert: true };
      case "y": return { newText: text, newCursor: cursor, deleted: text };
    }
  }

  const targetGrapheme = applyMotion(text, cursor, motion, count);
  const startGrapheme = Math.min(cursor, targetGrapheme);
  // vim's $ motion is inclusive of the final char; every other motion gives
  // the cursor destination as the range boundary.
  const endGraphemeExclusive =
    Math.max(cursor, targetGrapheme) + (motion === "$" ? 1 : 0);

  const startCode = graphemeToCodeUnit(text, startGrapheme);
  const endCode = graphemeToCodeUnit(text, endGraphemeExclusive);

  const before = text.slice(0, startCode);
  const deleted = text.slice(startCode, endCode);
  const after = text.slice(endCode);

  // After a delete/change, the cursor's grapheme index equals startGrapheme
  // (the spot where the deleted region began). codeUnitToGrapheme is a
  // defense-in-depth clamp — startGrapheme is already a grapheme index.
  const newCursorGrapheme = codeUnitToGrapheme(before + after, startCode);

  switch (operator) {
    case "d":
      return { newText: before + after, newCursor: newCursorGrapheme, deleted };
    case "c":
      return {
        newText: before + after,
        newCursor: newCursorGrapheme,
        deleted,
        enterInsert: true,
      };
    case "y":
      return { newText: text, newCursor: cursor, deleted };
    default:
      return { newText: text, newCursor: cursor };
  }
}
