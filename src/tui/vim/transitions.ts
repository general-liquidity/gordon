// ============================================================================
// Vim Transitions — NORMAL-mode command parser.
//
// Ported from the Claude Code vim state machine. `transition(command, input,
// ctx)` dispatches on the current CommandState and returns the next state
// and/or a side-effecting `execute` thunk. The consumer (PromptInput) owns the
// buffer / cursor / register via the VimContext callbacks, so this module has
// no React or string-editing concerns of its own beyond routing.
//
// This structure is what fixes the historical bugs: an operator-pending `i`/`a`
// routes to a text-object scope (never INSERT), f/F/t/T and r park in a state
// that consumes the next literal keystroke, and every motion / operator pairing
// is an explicit, total transition.
// ============================================================================

import { applyMotion } from "./motions.js";
import {
  executeDeleteToEol,
  executeIndent,
  executeJoin,
  executeLineOp,
  executeOpenLine,
  executeOperatorFind,
  executeOperatorG,
  executeOperatorMotion,
  executeOperatorTextObj,
  executePaste,
  executeReplace,
  executeToggleCase,
  executeX,
  executeYankLine,
  findChar,
  gotoLine,
  type VimContext,
} from "./operators.js";
import {
  type CommandState,
  FIND_KEYS,
  type FindType,
  isOperatorKey,
  isTextObjScopeKey,
  MAX_VIM_COUNT,
  OPERATORS,
  type Operator,
  type TextObjScope,
  SIMPLE_MOTIONS,
  TEXT_OBJ_SCOPES,
  TEXT_OBJ_TYPES,
} from "./types.js";
import { graphemeToCodeUnit, codeUnitToGrapheme, graphemeCount } from "../utils/graphemes.js";

export interface TransitionResult {
  next?: CommandState;
  execute?: () => void;
}

export function transition(
  command: CommandState,
  input: string,
  ctx: VimContext,
): TransitionResult {
  switch (command.type) {
    case "idle":
      return fromIdle(input, ctx);
    case "count":
      return fromCount(command, input, ctx);
    case "operator":
      return fromOperator(command, input, ctx);
    case "operatorCount":
      return fromOperatorCount(command, input, ctx);
    case "operatorFind":
      return fromOperatorFind(command, input, ctx);
    case "operatorTextObj":
      return fromOperatorTextObj(command, input, ctx);
    case "find":
      return fromFind(command, input, ctx);
    case "g":
      return fromG(command, input, ctx);
    case "operatorG":
      return fromOperatorG(command, input, ctx);
    case "replace":
      return fromReplace(command, input, ctx);
    case "indent":
      return fromIndent(command, input, ctx);
  }
}

// ============================================================================
// Shared input handling
// ============================================================================

function handleNormalInput(input: string, count: number, ctx: VimContext): TransitionResult | null {
  if (isOperatorKey(input)) {
    return { next: { type: "operator", op: OPERATORS[input], count } };
  }

  if (SIMPLE_MOTIONS.has(input)) {
    return { execute: () => ctx.setCursor(applyMotion(ctx.text, ctx.cursor, input, count)) };
  }

  if (FIND_KEYS.has(input as FindType)) {
    return { next: { type: "find", find: input as FindType, count } };
  }

  if (input === "g") return { next: { type: "g", count } };
  if (input === "r") return { next: { type: "replace", count } };
  if (input === ">" || input === "<") {
    return { next: { type: "indent", dir: input, count } };
  }
  if (input === "~") return { execute: () => executeToggleCase(count, ctx) };
  if (input === "x") return { execute: () => executeX(count, ctx) };
  if (input === "J") return { execute: () => executeJoin(count, ctx) };
  if (input === "p" || input === "P") {
    return { execute: () => executePaste(input === "p", count, ctx) };
  }
  if (input === "D") return { execute: () => executeDeleteToEol("delete", 1, ctx) };
  if (input === "C") return { execute: () => executeDeleteToEol("change", 1, ctx) };
  if (input === "Y") return { execute: () => executeYankLine(count, ctx) };
  if (input === "G") {
    return {
      execute: () => {
        const lineIdx = count > 1 ? count - 1 : lastLineIndex(ctx.text);
        ctx.setCursor(gotoLine(ctx.text, lineIdx));
      },
    };
  }
  if (input === ".") return { execute: () => ctx.onDotRepeat?.() };
  if (input === ";" || input === ",") {
    return { execute: () => executeRepeatFind(input === ",", count, ctx) };
  }
  if (input === "u") return { execute: () => ctx.onUndo?.() };
  if (input === "i") return { execute: () => ctx.enterInsert(ctx.cursor) };
  if (input === "I")
    return { execute: () => ctx.enterInsert(firstNonBlankGrapheme(ctx.text, ctx.cursor)) };
  if (input === "a") {
    return { execute: () => ctx.enterInsert(Math.min(graphemeCount(ctx.text), ctx.cursor + 1)) };
  }
  if (input === "A")
    return { execute: () => ctx.enterInsert(endOfLineGrapheme(ctx.text, ctx.cursor)) };
  if (input === "o") return { execute: () => executeOpenLine("below", ctx) };
  if (input === "O") return { execute: () => executeOpenLine("above", ctx) };

  return null;
}

function handleOperatorInput(
  op: Operator,
  count: number,
  input: string,
  ctx: VimContext,
): TransitionResult | null {
  if (isTextObjScopeKey(input)) {
    return { next: { type: "operatorTextObj", op, count, scope: TEXT_OBJ_SCOPES[input] } };
  }

  if (FIND_KEYS.has(input as FindType)) {
    return { next: { type: "operatorFind", op, count, find: input as FindType } };
  }

  if (SIMPLE_MOTIONS.has(input)) {
    return { execute: () => executeOperatorMotion(op, input, count, ctx) };
  }

  if (input === "G") return { execute: () => executeOperatorG(op, false, count, ctx) };
  if (input === "g") return { next: { type: "operatorG", op, count } };

  return null;
}

// ============================================================================
// Transition functions — one per state type
// ============================================================================

function fromIdle(input: string, ctx: VimContext): TransitionResult {
  if (/[1-9]/.test(input)) return { next: { type: "count", digits: input } };
  if (input === "0") {
    return { execute: () => ctx.setCursor(applyMotion(ctx.text, ctx.cursor, "0", 1)) };
  }
  return handleNormalInput(input, 1, ctx) ?? {};
}

function fromCount(
  command: { type: "count"; digits: string },
  input: string,
  ctx: VimContext,
): TransitionResult {
  if (/[0-9]/.test(input)) {
    const count = Math.min(parseInt(command.digits + input, 10), MAX_VIM_COUNT);
    return { next: { type: "count", digits: String(count) } };
  }
  const count = parseInt(command.digits, 10);
  return handleNormalInput(input, count, ctx) ?? { next: { type: "idle" } };
}

function fromOperator(
  command: { type: "operator"; op: Operator; count: number },
  input: string,
  ctx: VimContext,
): TransitionResult {
  if (input === OPERATOR_KEY[command.op]) {
    return { execute: () => executeLineOp(command.op, command.count, ctx) };
  }
  if (/[0-9]/.test(input)) {
    return { next: { type: "operatorCount", op: command.op, count: command.count, digits: input } };
  }
  return handleOperatorInput(command.op, command.count, input, ctx) ?? { next: { type: "idle" } };
}

function fromOperatorCount(
  command: { type: "operatorCount"; op: Operator; count: number; digits: string },
  input: string,
  ctx: VimContext,
): TransitionResult {
  if (/[0-9]/.test(input)) {
    const digits = String(Math.min(parseInt(command.digits + input, 10), MAX_VIM_COUNT));
    return { next: { ...command, digits } };
  }
  const effective = command.count * parseInt(command.digits, 10);
  return handleOperatorInput(command.op, effective, input, ctx) ?? { next: { type: "idle" } };
}

function fromOperatorFind(
  command: { type: "operatorFind"; op: Operator; count: number; find: FindType },
  input: string,
  ctx: VimContext,
): TransitionResult {
  if (input === "") return { next: { type: "idle" } };
  return {
    execute: () => executeOperatorFind(command.op, command.find, input, command.count, ctx),
  };
}

function fromOperatorTextObj(
  command: { type: "operatorTextObj"; op: Operator; count: number; scope: TextObjScope },
  input: string,
  ctx: VimContext,
): TransitionResult {
  if (TEXT_OBJ_TYPES.has(input)) {
    return {
      execute: () => executeOperatorTextObj(command.op, command.scope, input, command.count, ctx),
    };
  }
  return { next: { type: "idle" } };
}

function fromFind(
  command: { type: "find"; find: FindType; count: number },
  input: string,
  ctx: VimContext,
): TransitionResult {
  if (input === "") return { next: { type: "idle" } };
  return {
    execute: () => {
      const target = findChar(ctx.text, ctx.cursor, input, command.find, command.count);
      if (target !== null) {
        ctx.setCursor(target);
        ctx.setLastFind(command.find, input);
      }
    },
  };
}

function fromG(
  command: { type: "g"; count: number },
  input: string,
  ctx: VimContext,
): TransitionResult {
  if (input === "g") {
    return {
      execute: () => ctx.setCursor(gotoLine(ctx.text, command.count > 1 ? command.count - 1 : 0)),
    };
  }
  return { next: { type: "idle" } };
}

function fromOperatorG(
  command: { type: "operatorG"; op: Operator; count: number },
  input: string,
  ctx: VimContext,
): TransitionResult {
  if (input === "g") {
    return { execute: () => executeOperatorG(command.op, true, command.count, ctx) };
  }
  return { next: { type: "idle" } };
}

function fromReplace(
  command: { type: "replace"; count: number },
  input: string,
  ctx: VimContext,
): TransitionResult {
  // r<BS> cancels; without this guard executeReplace("") would blank the char.
  if (input === "") return { next: { type: "idle" } };
  return { execute: () => executeReplace(input, command.count, ctx) };
}

function fromIndent(
  command: { type: "indent"; dir: ">" | "<"; count: number },
  input: string,
  ctx: VimContext,
): TransitionResult {
  if (input === command.dir) {
    return { execute: () => executeIndent(command.dir, command.count, ctx) };
  }
  return { next: { type: "idle" } };
}

// ============================================================================
// Helpers
// ============================================================================

const OPERATOR_KEY: Record<Operator, string> = { delete: "d", change: "c", yank: "y" };

function executeRepeatFind(reverse: boolean, count: number, ctx: VimContext): void {
  const last = ctx.getLastFind();
  if (!last) return;
  let findType = last.type;
  if (reverse) {
    const flip: Record<FindType, FindType> = { f: "F", F: "f", t: "T", T: "t" };
    findType = flip[findType];
  }
  const target = findChar(ctx.text, ctx.cursor, last.char, findType, count);
  if (target !== null) ctx.setCursor(target);
}

function lastLineIndex(text: string): number {
  return text.split("\n").length - 1;
}

function firstNonBlankGrapheme(text: string, cursor: number): number {
  const off = graphemeToCodeUnit(text, cursor);
  const lineStart = text.lastIndexOf("\n", off - 1) + 1;
  const lineEnd = text.indexOf("\n", off);
  const line = text.slice(lineStart, lineEnd === -1 ? text.length : lineEnd);
  const blank = (line.match(/^\s*/)?.[0] ?? "").length;
  return codeUnitToGrapheme(text, lineStart + blank);
}

function endOfLineGrapheme(text: string, cursor: number): number {
  const off = graphemeToCodeUnit(text, cursor);
  const nl = text.indexOf("\n", off);
  return codeUnitToGrapheme(text, nl === -1 ? text.length : nl);
}
