const TEAL = "\x1b[38;2;52;238;176m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";

/** 6-line ANSI-Shadow GORDON. Every line is exactly LOGO_WIDTH visible chars. */
export const GORDON_LOGO: readonly string[] = [
  " ██████╗  ██████╗ ██████╗ ██████╗  ██████╗ ███╗   ██╗",
  "██╔════╝ ██╔═══██╗██╔══██╗██╔══██╗██╔═══██╗████╗  ██║",
  "██║  ███╗██║   ██║██████╔╝██║  ██║██║   ██║██╔██╗ ██║",
  "██║   ██║██║   ██║██╔══██╗██║  ██║██║   ██║██║╚██╗██║",
  "╚██████╔╝╚██████╔╝██║  ██║██████╔╝╚██████╔╝██║ ╚████║",
  " ╚═════╝  ╚═════╝ ╚═╝  ╚═╝╚═════╝  ╚═════╝ ╚═╝  ╚═══╝",
];

export const LOGO_WIDTH = 53;
/** Minimum terminal columns for the full logo (logo + 2-col left margin + slack). */
export const FULL_LOGO_MIN_COLUMNS = 60;

export interface BannerOptions {
  columns: number;
  version: string;
}

function visibleLength(value: string): number {
  return value.replace(/\x1b\[[0-9;]*m/g, "").length;
}

function truncatePlain(value: string, maxVisible: number): string {
  if (maxVisible <= 0) return "";
  if (visibleLength(value) <= maxVisible) return value;
  if (maxVisible === 1) return "…";
  return `${Array.from(value).slice(0, maxVisible - 1).join("")}…`;
}

/** Raw-ANSI lines, no trailing newline. Caller joins with "\n". */
export function renderBanner(opts: BannerOptions): string[] {
  const { columns, version } = opts;
  if (columns <= 0) return [];

  if (columns >= FULL_LOGO_MIN_COLUMNS) {
    return [
      ...GORDON_LOGO.map((line) => ` ${TEAL}${line}${RESET}`),
      `  ${TEAL}${BOLD}v${version}${RESET}${DIM} · The Frontier Trading Agent · General Liquidity, Inc.${RESET}`,
    ];
  }

  const wordmark = `  ${TEAL}${BOLD}≫ GORDON${RESET}${DIM}  v${version}${RESET}`;
  const tagline = "  The Frontier Trading Agent · General Liquidity, Inc.";
  return [
    truncatePlain(wordmark, columns - 1),
    `${DIM}${truncatePlain(tagline, columns - 1)}${RESET}`,
  ];
}
