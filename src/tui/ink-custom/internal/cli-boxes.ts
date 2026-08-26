// cli-boxes — inlined border-drawing characters.
//
// Active in charPool and renderBorder as the local replacement for the
// `cli-boxes` npm dependency. Gordon only uses a small subset of the
// border styles cli-boxes ships, so inlining them here saves a dep in
// the final Phase 6 shipping tree.
//
// Only the styles Gordon actually renders today are included. If a
// consumer requests a style not in this table, Phase 1+ should throw
// at runtime rather than silently mis-render.

export type BoxStyle = {
  readonly topLeft: string;
  readonly top: string;
  readonly topRight: string;
  readonly right: string;
  readonly bottomRight: string;
  readonly bottom: string;
  readonly bottomLeft: string;
  readonly left: string;
};

export type BoxStyleName =
  | "single"
  | "double"
  | "round"
  | "bold"
  | "singleDouble"
  | "doubleSingle"
  | "classic"
  | "arrow";

// Unicode box-drawing characters. These are the only styles Gordon's TUI uses
// (verified by grepping `borderStyle=` across src/tui/**). Preserving Unicode
// on purpose — box-drawing codepoints are load-bearing.
const boxes: Record<BoxStyleName, BoxStyle> = {
  single: {
    topLeft: "┌", // ┌
    top: "─", // ─
    topRight: "┐", // ┐
    right: "│", // │
    bottomRight: "┘", // ┘
    bottom: "─", // ─
    bottomLeft: "└", // └
    left: "│", // │
  },
  double: {
    topLeft: "╔", // ╔
    top: "═", // ═
    topRight: "╗", // ╗
    right: "║", // ║
    bottomRight: "╝", // ╝
    bottom: "═", // ═
    bottomLeft: "╚", // ╚
    left: "║", // ║
  },
  round: {
    topLeft: "╭", // ╭
    top: "─", // ─
    topRight: "╮", // ╮
    right: "│", // │
    bottomRight: "╯", // ╯
    bottom: "─", // ─
    bottomLeft: "╰", // ╰
    left: "│", // │
  },
  bold: {
    topLeft: "┏", // ┏
    top: "━", // ━
    topRight: "┓", // ┓
    right: "┃", // ┃
    bottomRight: "┛", // ┛
    bottom: "━", // ━
    bottomLeft: "┗", // ┗
    left: "┃", // ┃
  },
  singleDouble: {
    topLeft: "╓", // ╓
    top: "─", // ─
    topRight: "╖", // ╖
    right: "║", // ║
    bottomRight: "╜", // ╜
    bottom: "─", // ─
    bottomLeft: "╙", // ╙
    left: "║", // ║
  },
  doubleSingle: {
    topLeft: "╒", // ╒
    top: "═", // ═
    topRight: "╕", // ╕
    right: "│", // │
    bottomRight: "╛", // ╛
    bottom: "═", // ═
    bottomLeft: "╘", // ╘
    left: "│", // │
  },
  classic: {
    topLeft: "+",
    top: "-",
    topRight: "+",
    right: "|",
    bottomRight: "+",
    bottom: "-",
    bottomLeft: "+",
    left: "|",
  },
  arrow: {
    topLeft: "↙", // ↙
    top: "↓", // ↓
    topRight: "↘", // ↘
    right: "←", // ←
    bottomRight: "↗", // ↗
    bottom: "↑", // ↑
    bottomLeft: "↖", // ↖
    left: "→", // →
  },
};

export default boxes;
