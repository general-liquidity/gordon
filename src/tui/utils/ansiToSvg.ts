// ============================================================================
// ANSI to SVG — Renders terminal output as SVG for sharing/export
//
// Parses ANSI escape sequences (basic colors, bold, dim, underline, inverse)
// and produces an SVG with tspan elements per styled segment.
// ============================================================================

const ANSI_COLORS: Record<number, string> = {
  30: "#1e1e1e",
  31: "#e06c75",
  32: "#98c379",
  33: "#e5c07b",
  34: "#61afef",
  35: "#c678dd",
  36: "#56b6c2",
  37: "#abb2bf",
  90: "#5c6370",
  91: "#e06c75",
  92: "#98c379",
  93: "#e5c07b",
  94: "#61afef",
  95: "#c678dd",
  96: "#56b6c2",
  97: "#ffffff",
};

const BG_COLORS: Record<number, string> = {
  40: "#1e1e1e",
  41: "#e06c75",
  42: "#98c379",
  43: "#e5c07b",
  44: "#61afef",
  45: "#c678dd",
  46: "#56b6c2",
  47: "#abb2bf",
};

interface AnsiSegment {
  text: string;
  fg?: string;
  bg?: string;
  bold?: boolean;
  dim?: boolean;
  underline?: boolean;
}

function parseAnsi(input: string): AnsiSegment[][] {
  const lines = input.split("\n");
  const result: AnsiSegment[][] = [];
  let fg: string | undefined;
  let bg: string | undefined;
  let bold = false;
  let dim = false;
  let underline = false;

  for (const line of lines) {
    const segments: AnsiSegment[] = [];
    const parts = line.split(/\x1b\[([0-9;]*)m/);

    for (let i = 0; i < parts.length; i++) {
      if (i % 2 === 0) {
        const text = parts[i]!;
        if (text) {
          segments.push({ text, fg, bg, bold, dim, underline });
        }
      } else {
        const codes = parts[i]!.split(";").map(Number);
        for (const code of codes) {
          if (code === 0) {
            fg = undefined;
            bg = undefined;
            bold = false;
            dim = false;
            underline = false;
          } else if (code === 1) bold = true;
          else if (code === 2) dim = true;
          else if (code === 4) underline = true;
          else if (code >= 30 && code <= 37) fg = ANSI_COLORS[code];
          else if (code >= 90 && code <= 97) fg = ANSI_COLORS[code];
          else if (code >= 40 && code <= 47) bg = BG_COLORS[code];
          else if (code === 39) fg = undefined;
          else if (code === 49) bg = undefined;
        }
      }
    }
    result.push(segments);
  }
  return result;
}

export interface AnsiToSvgOptions {
  fontSize?: number;
  fontFamily?: string;
  lineHeight?: number;
  paddingX?: number;
  paddingY?: number;
}

export function ansiToSvg(ansiText: string, options: AnsiToSvgOptions = {}): string {
  const {
    fontSize = 14,
    fontFamily = "Menlo, Monaco, Consolas, 'Courier New', monospace",
    lineHeight = 1.4,
    paddingX = 16,
    paddingY = 12,
  } = options;

  const charWidth = fontSize * 0.6;
  const rowHeight = fontSize * lineHeight;
  const parsed = parseAnsi(ansiText);

  const maxCols = Math.max(
    ...parsed.map((line) => line.reduce((sum, seg) => sum + seg.text.length, 0)),
    1,
  );

  const width = Math.ceil(maxCols * charWidth + paddingX * 2);
  const height = Math.ceil(parsed.length * rowHeight + paddingY * 2);

  const textElements = parsed.map((segments, row) => {
    let x = paddingX;
    const y = paddingY + (row + 1) * rowHeight;

    const spans = segments.map((seg) => {
      const attrs: string[] = [`x="${x}"`];
      const styles: string[] = [];

      if (seg.fg) styles.push(`fill:${seg.fg}`);
      if (seg.dim) styles.push("opacity:0.5");
      if (seg.bold) attrs.push('font-weight="bold"');
      if (seg.underline) attrs.push('text-decoration="underline"');
      if (styles.length) attrs.push(`style="${styles.join(";")}"`);

      const escaped = seg.text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

      x += seg.text.length * charWidth;
      return `<tspan ${attrs.join(" ")}>${escaped}</tspan>`;
    });

    return `<text y="${y}">${spans.join("")}</text>`;
  });

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    `<rect width="100%" height="100%" fill="#282c34" rx="8"/>`,
    `<g font-family="${fontFamily}" font-size="${fontSize}" fill="#abb2bf">`,
    ...textElements,
    "</g>",
    "</svg>",
  ].join("\n");
}
