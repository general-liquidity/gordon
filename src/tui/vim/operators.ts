// ============================================================================
// Vim Operators — delete / change / yank plus the single-key edit commands
// (x, r, ~, J, p/P, >>, <<, o/O, D/C/Y, gg/G-range).
//
// Gordon's cursor is a GRAPHEME INDEX into the buffer. Every executor converts
// that to a UTF-16 code-unit offset at the seam where it slices the string, and
// converts the resulting offset back to a grapheme index before handing the
// cursor to the caller. Motion targets come from applyMotion (grapheme space);
// text-object ranges come from selectTextObject (code-unit space). This keeps
// CJK / emoji edits consistent with what the user sees.
// ============================================================================

import { applyMotion } from "./motions.js";
import { selectTextObject } from "./textObjects.js";
import type { FindType, Operator, RecordedChange, TextObjScope } from "./types.js";
import {
  graphemeToCodeUnit,
  codeUnitToGrapheme,
  graphemeCount,
  splitGraphemes,
} from "../utils/graphemes.js";

// ----------------------------------------------------------------------------
// Execution context. All cursor offsets crossing this boundary are grapheme
// indices; the register / find / change stores are owned by the caller.
// ----------------------------------------------------------------------------
export interface VimContext {
  text: string;
  cursor: number;
  setText(text: string): void;
  setCursor(cursor: number): void;
  enterInsert(cursor: number): void;
  getRegister(): { content: string; linewise: boolean };
  setRegister(content: string, linewise: boolean): void;
  getLastFind(): { type: FindType; char: string } | null;
  setLastFind(type: FindType, char: string): void;
  recordChange(change: RecordedChange): void;
  onUndo?(): void;
  onDotRepeat?(): void;
}

// Motions whose operator range includes the grapheme under the target cursor.
const INCLUSIVE_MOTIONS = new Set(["$", "e", "E"]);

// ----------------------------------------------------------------------------
// Shared range application in code-unit space.
// ----------------------------------------------------------------------------
function applyRange(
  op: Operator,
  startCode: number,
  endCode: number,
  linewise: boolean,
  ctx: VimContext,
): void {
  const text = ctx.text;
  let content = text.slice(startCode, endCode);
  if (linewise && !content.endsWith("\n")) content += "\n";
  ctx.setRegister(content, linewise);

  if (op === "yank") {
    ctx.setCursor(codeUnitToGrapheme(text, startCode));
    return;
  }

  const newText = text.slice(0, startCode) + text.slice(endCode);
  ctx.setText(newText);
  if (op === "delete") {
    ctx.setCursor(codeUnitToGrapheme(newText, startCode));
  } else {
    ctx.enterInsert(codeUnitToGrapheme(newText, startCode));
  }
}

// ----------------------------------------------------------------------------
// Line helpers (code-unit space).
// ----------------------------------------------------------------------------
function lineStartCode(text: string, off: number): number {
  return text.lastIndexOf("\n", off - 1) + 1;
}

function lineEndCode(text: string, off: number): number {
  const nl = text.indexOf("\n", off);
  return nl === -1 ? text.length : nl;
}

function lineIndexAt(text: string, off: number): number {
  let line = 0;
  for (let i = 0; i < off && i < text.length; i++) {
    if (text[i] === "\n") line++;
  }
  return line;
}

function lineStartOffset(lines: string[], lineIndex: number): number {
  return lines.slice(0, lineIndex).join("\n").length + (lineIndex > 0 ? 1 : 0);
}

// ============================================================================
// Operator + motion / text object / find / line ops
// ============================================================================

export function executeOperatorMotion(
  op: Operator,
  motion: string,
  count: number,
  ctx: VimContext,
): void {
  const targetG = applyMotion(ctx.text, ctx.cursor, motion, count);
  if (targetG === ctx.cursor && !INCLUSIVE_MOTIONS.has(motion)) return;

  const startG = Math.min(ctx.cursor, targetG);
  const endGExcl = Math.max(ctx.cursor, targetG) + (INCLUSIVE_MOTIONS.has(motion) ? 1 : 0);
  const startCode = graphemeToCodeUnit(ctx.text, startG);
  const endCode = graphemeToCodeUnit(ctx.text, endGExcl);

  applyRange(op, startCode, endCode, false, ctx);
  ctx.recordChange({ type: "operatorMotion", op, motion, count });
}

export function executeOperatorTextObj(
  op: Operator,
  scope: TextObjScope,
  objType: string,
  count: number,
  ctx: VimContext,
): void {
  const codeCursor = graphemeToCodeUnit(ctx.text, ctx.cursor);
  const range = selectTextObject(ctx.text, codeCursor, (scope === "inner" ? "i" : "a") + objType);
  if (!range) return;

  applyRange(op, range.start, range.end, false, ctx);
  ctx.recordChange({ type: "operatorTextObj", op, scope, objType, count });
}

export function executeOperatorFind(
  op: Operator,
  findType: FindType,
  char: string,
  count: number,
  ctx: VimContext,
): void {
  const targetG = findChar(ctx.text, ctx.cursor, char, findType, count);
  if (targetG === null || targetG === ctx.cursor) return;

  const startG = Math.min(ctx.cursor, targetG);
  const endGExcl = Math.max(ctx.cursor, targetG) + 1;
  const startCode = graphemeToCodeUnit(ctx.text, startG);
  const endCode = graphemeToCodeUnit(ctx.text, endGExcl);

  applyRange(op, startCode, endCode, false, ctx);
  ctx.setLastFind(findType, char);
  ctx.recordChange({ type: "operatorFind", op, find: findType, char, count });
}

export function executeLineOp(op: Operator, count: number, ctx: VimContext): void {
  const text = ctx.text;
  const off = graphemeToCodeUnit(text, ctx.cursor);
  const start = lineStartCode(text, off);
  let end = start;
  for (let i = 0; i < count; i++) {
    const nl = text.indexOf("\n", end);
    end = nl === -1 ? text.length : nl + 1;
    if (nl === -1) break;
  }

  let content = text.slice(start, end);
  if (!content.endsWith("\n")) content += "\n";
  ctx.setRegister(content, true);

  if (op === "yank") {
    ctx.setCursor(codeUnitToGrapheme(text, start));
  } else if (op === "delete") {
    let delStart = start;
    if (end === text.length && delStart > 0 && text[delStart - 1] === "\n") delStart -= 1;
    const newText = text.slice(0, delStart) + text.slice(end);
    ctx.setText(newText);
    ctx.setCursor(codeUnitToGrapheme(newText, Math.min(delStart, newText.length)));
  } else {
    // change: clear the affected lines and enter insert at the line start.
    const newText = text.slice(0, start) + text.slice(end);
    ctx.setText(newText);
    ctx.enterInsert(codeUnitToGrapheme(newText, start));
  }

  ctx.recordChange({ type: "lineOp", op, count });
}

// D / C — operate charwise from the cursor to the end of the logical line.
export function executeDeleteToEol(op: Operator, count: number, ctx: VimContext): void {
  const text = ctx.text;
  const off = graphemeToCodeUnit(text, ctx.cursor);
  const end = lineEndCode(text, off);
  if (op === "yank") {
    ctx.setRegister(text.slice(off, end), false);
  } else {
    applyRange(op, off, end, false, ctx);
  }
  ctx.recordChange({ type: "delToEol", op, count });
}

// Y — yank the whole current line linewise (cursor unchanged).
export function executeYankLine(count: number, ctx: VimContext): void {
  const text = ctx.text;
  const off = graphemeToCodeUnit(text, ctx.cursor);
  const start = lineStartCode(text, off);
  let end = start;
  for (let i = 0; i < count; i++) {
    const nl = text.indexOf("\n", end);
    end = nl === -1 ? text.length : nl + 1;
    if (nl === -1) break;
  }
  let content = text.slice(start, end);
  if (!content.endsWith("\n")) content += "\n";
  ctx.setRegister(content, true);
  ctx.recordChange({ type: "lineOp", op: "yank", count });
}

// ============================================================================
// Single-key edit commands
// ============================================================================

export function executeX(count: number, ctx: VimContext): void {
  const gLen = graphemeCount(ctx.text);
  if (ctx.cursor >= gLen) return;

  const startG = ctx.cursor;
  const endG = Math.min(gLen, startG + count);
  const startCode = graphemeToCodeUnit(ctx.text, startG);
  const endCode = graphemeToCodeUnit(ctx.text, endG);

  const deleted = ctx.text.slice(startCode, endCode);
  const newText = ctx.text.slice(0, startCode) + ctx.text.slice(endCode);
  ctx.setRegister(deleted, false);
  ctx.setText(newText);
  ctx.setCursor(codeUnitToGrapheme(newText, startCode));
  ctx.recordChange({ type: "x", count });
}

export function executeReplace(char: string, count: number, ctx: VimContext): void {
  const graphemes = splitGraphemes(ctx.text);
  if (ctx.cursor >= graphemes.length) return;
  // A count past the end of the line is a no-op in vim.
  if (ctx.cursor + count > graphemes.length) return;

  for (let i = 0; i < count; i++) graphemes[ctx.cursor + i] = char;
  const newText = graphemes.join("");
  ctx.setText(newText);
  ctx.setCursor(Math.min(ctx.cursor + count - 1, Math.max(0, graphemeCount(newText) - 1)));
  ctx.recordChange({ type: "replace", char, count });
}

export function executeToggleCase(count: number, ctx: VimContext): void {
  const graphemes = splitGraphemes(ctx.text);
  if (ctx.cursor >= graphemes.length) return;

  const end = Math.min(graphemes.length, ctx.cursor + count);
  for (let i = ctx.cursor; i < end; i++) {
    const g = graphemes[i]!;
    graphemes[i] = g === g.toUpperCase() ? g.toLowerCase() : g.toUpperCase();
  }
  const newText = graphemes.join("");
  ctx.setText(newText);
  ctx.setCursor(Math.min(end, Math.max(0, graphemeCount(newText) - 1)));
  ctx.recordChange({ type: "toggleCase", count });
}

export function executeJoin(count: number, ctx: VimContext): void {
  const text = ctx.text;
  const lines = text.split("\n");
  const off = graphemeToCodeUnit(text, ctx.cursor);
  const currentLine = lineIndexAt(text, off);
  if (currentLine >= lines.length - 1) return;

  const linesToJoin = Math.min(Math.max(1, count - 1), lines.length - currentLine - 1);
  let joined = lines[currentLine]!;
  const joinColCode = joined.length;
  for (let i = 1; i <= linesToJoin; i++) {
    const next = (lines[currentLine + i] ?? "").replace(/^\s+/, "");
    if (next.length > 0) {
      if (joined.length > 0 && !joined.endsWith(" ")) joined += " ";
      joined += next;
    }
  }

  const newLines = [
    ...lines.slice(0, currentLine),
    joined,
    ...lines.slice(currentLine + linesToJoin + 1),
  ];
  const newText = newLines.join("\n");
  ctx.setText(newText);
  const cursorCode = lineStartOffset(newLines, currentLine) + joinColCode;
  ctx.setCursor(codeUnitToGrapheme(newText, cursorCode));
  ctx.recordChange({ type: "join", count });
}

export function executePaste(after: boolean, count: number, ctx: VimContext): void {
  const { content, linewise } = ctx.getRegister();
  if (!content) return;

  const text = ctx.text;
  if (linewise) {
    const body = content.endsWith("\n") ? content.slice(0, -1) : content;
    const lines = text.split("\n");
    const off = graphemeToCodeUnit(text, ctx.cursor);
    const currentLine = lineIndexAt(text, off);
    const insertLine = after ? currentLine + 1 : currentLine;

    const contentLines = body.split("\n");
    const repeated: string[] = [];
    for (let i = 0; i < count; i++) repeated.push(...contentLines);

    const newLines = [...lines.slice(0, insertLine), ...repeated, ...lines.slice(insertLine)];
    const newText = newLines.join("\n");
    ctx.setText(newText);
    ctx.setCursor(codeUnitToGrapheme(newText, lineStartOffset(newLines, insertLine)));
  } else {
    const insertG = after ? Math.min(graphemeCount(text), ctx.cursor + 1) : ctx.cursor;
    const insertCode = graphemeToCodeUnit(text, insertG);
    const toInsert = content.repeat(count);
    const newText = text.slice(0, insertCode) + toInsert + text.slice(insertCode);
    ctx.setText(newText);
    // Cursor lands on the last grapheme of the pasted text (vim convention).
    const endG = codeUnitToGrapheme(newText, insertCode + toInsert.length);
    ctx.setCursor(Math.max(insertG, endG - 1));
  }
  ctx.recordChange({ type: "paste", after, count });
}

export function executeIndent(dir: ">" | "<", count: number, ctx: VimContext): void {
  const text = ctx.text;
  const lines = text.split("\n");
  const off = graphemeToCodeUnit(text, ctx.cursor);
  const currentLine = lineIndexAt(text, off);
  const affected = Math.min(count, lines.length - currentLine);
  const indent = "  ";

  for (let i = 0; i < affected; i++) {
    const idx = currentLine + i;
    const line = lines[idx] ?? "";
    if (dir === ">") {
      lines[idx] = indent + line;
    } else if (line.startsWith(indent)) {
      lines[idx] = line.slice(indent.length);
    } else if (line.startsWith("\t")) {
      lines[idx] = line.slice(1);
    } else {
      let removed = 0;
      let j = 0;
      while (j < line.length && removed < indent.length && /\s/.test(line[j]!)) {
        removed++;
        j++;
      }
      lines[idx] = line.slice(j);
    }
  }

  const newText = lines.join("\n");
  ctx.setText(newText);
  const curText = lines[currentLine] ?? "";
  const firstNonBlank = (curText.match(/^\s*/)?.[0] ?? "").length;
  ctx.setCursor(codeUnitToGrapheme(newText, lineStartOffset(lines, currentLine) + firstNonBlank));
  ctx.recordChange({ type: "indent", dir, count });
}

export function executeOpenLine(direction: "above" | "below", ctx: VimContext): void {
  const text = ctx.text;
  const off = graphemeToCodeUnit(text, ctx.cursor);
  let insertCode: number;
  if (direction === "below") {
    const end = lineEndCode(text, off);
    const newText = text.slice(0, end) + "\n" + text.slice(end);
    ctx.setText(newText);
    insertCode = end + 1;
  } else {
    const start = lineStartCode(text, off);
    const newText = text.slice(0, start) + "\n" + text.slice(start);
    ctx.setText(newText);
    insertCode = start;
  }
  ctx.enterInsert(codeUnitToGrapheme(ctx.text, insertCode));
  ctx.recordChange({ type: "openLine", direction });
}

// dG / dgg — operate linewise from the current line to the first / last line.
export function executeOperatorG(
  op: Operator,
  toFirst: boolean,
  count: number,
  ctx: VimContext,
): void {
  const text = ctx.text;
  const off = graphemeToCodeUnit(text, ctx.cursor);
  const curLine = lineStartCode(text, off);
  let from: number;
  let to: number;
  if (toFirst) {
    from = 0;
    const nl = text.indexOf("\n", off);
    to = nl === -1 ? text.length : nl + 1;
  } else {
    from = curLine;
    to = text.length;
  }

  let content = text.slice(from, to);
  if (!content.endsWith("\n")) content += "\n";
  ctx.setRegister(content, true);

  if (op === "yank") {
    ctx.setCursor(codeUnitToGrapheme(text, from));
  } else {
    let delFrom = from;
    if (to === text.length && delFrom > 0 && text[delFrom - 1] === "\n") delFrom -= 1;
    const newText = text.slice(0, delFrom) + text.slice(to);
    ctx.setText(newText);
    const landing = codeUnitToGrapheme(newText, Math.min(delFrom, newText.length));
    if (op === "delete") ctx.setCursor(landing);
    else ctx.enterInsert(landing);
  }
  ctx.recordChange({ type: "operatorG", op, toFirst, count });
}

// ============================================================================
// Cursor-only helpers used directly by the transition table
// ============================================================================

/**
 * Resolve an f/F/t/T target. Returns a grapheme index or null when the
 * character is not found in the required direction.
 */
export function findChar(
  text: string,
  cursor: number,
  char: string,
  type: FindType,
  count: number,
): number | null {
  const graphemes = splitGraphemes(text);
  const forward = type === "f" || type === "t";
  let idx = cursor;

  for (let c = 0; c < count; c++) {
    let found = -1;
    if (forward) {
      for (let k = idx + 1; k < graphemes.length; k++) {
        if (graphemes[k] === char) { found = k; break; }
      }
    } else {
      for (let k = idx - 1; k >= 0; k--) {
        if (graphemes[k] === char) { found = k; break; }
      }
    }
    if (found === -1) return null;
    idx = found;
  }

  if (type === "t") idx -= 1;
  else if (type === "T") idx += 1;
  return idx;
}

/** Goto the first / last (or Nth) logical line; returns a grapheme index. */
export function gotoLine(text: string, lineIndex: number): number {
  const lines = text.split("\n");
  const target = Math.max(0, Math.min(lineIndex, lines.length - 1));
  let code = 0;
  for (let i = 0; i < target; i++) code += (lines[i]?.length ?? 0) + 1;
  const line = lines[target] ?? "";
  const firstNonBlank = (line.match(/^\s*/)?.[0] ?? "").length;
  return codeUnitToGrapheme(text, code + firstNonBlank);
}

// ============================================================================
// Dot-repeat
// ============================================================================

export function replayChange(change: RecordedChange, ctx: VimContext): void {
  switch (change.type) {
    case "insert": {
      const insertCode = graphemeToCodeUnit(ctx.text, ctx.cursor);
      const newText = ctx.text.slice(0, insertCode) + change.text + ctx.text.slice(insertCode);
      ctx.setText(newText);
      ctx.setCursor(ctx.cursor + graphemeCount(change.text));
      return;
    }
    case "operatorMotion":
      return executeOperatorMotion(change.op, change.motion, change.count, ctx);
    case "lineOp":
      return executeLineOp(change.op, change.count, ctx);
    case "delToEol":
      return executeDeleteToEol(change.op, change.count, ctx);
    case "operatorTextObj":
      return executeOperatorTextObj(change.op, change.scope, change.objType, change.count, ctx);
    case "operatorFind":
      return executeOperatorFind(change.op, change.find, change.char, change.count, ctx);
    case "operatorG":
      return executeOperatorG(change.op, change.toFirst, change.count, ctx);
    case "x":
      return executeX(change.count, ctx);
    case "replace":
      return executeReplace(change.char, change.count, ctx);
    case "toggleCase":
      return executeToggleCase(change.count, ctx);
    case "join":
      return executeJoin(change.count, ctx);
    case "indent":
      return executeIndent(change.dir, change.count, ctx);
    case "openLine":
      return executeOpenLine(change.direction, ctx);
    case "paste":
      return executePaste(change.after, change.count, ctx);
  }
}
