// ============================================================================
// useDeclaredCursor — Grapheme-aware cursor resolver for PromptInput
//
// Given text and a grapheme-index cursor position, returns the visual column
// offset (terminal columns consumed by the prefix) and the grapheme cluster
// currently under the cursor. Rendering code uses these to align the inverse
// block cursor / beam at the correct on-screen position when double-width
// characters (CJK / emoji) appear in the buffer.
// ============================================================================

import { useMemo } from "react";
import { graphemeToCodeUnit, visualWidth } from "../utils/graphemes.js";

export interface DeclaredCursor {
  /** Terminal columns consumed by the prefix before the cursor. */
  visualColumn: number;
  /** The grapheme cluster under the cursor, or " " if at end-of-text. */
  charAtCursor: string;
  /** Code-unit split points used for rendering left/right segments. */
  leftCodeUnit: number;
  rightCodeUnit: number;
}

export function useDeclaredCursor(text: string, graphemeIdx: number): DeclaredCursor {
  return useMemo(() => {
    const leftCodeUnit = graphemeToCodeUnit(text, graphemeIdx);
    // Rightward edge: find the code-unit index just after the cursor grapheme.
    const nextCodeUnit = graphemeToCodeUnit(text, graphemeIdx + 1);
    const hasChar = leftCodeUnit < text.length;
    const charAtCursor = hasChar ? text.slice(leftCodeUnit, nextCodeUnit) : " ";
    const rightCodeUnit = hasChar ? nextCodeUnit : leftCodeUnit;
    const prefix = text.slice(0, leftCodeUnit);
    return {
      visualColumn: visualWidth(prefix),
      charAtCursor,
      leftCodeUnit,
      rightCodeUnit,
    };
  }, [text, graphemeIdx]);
}
