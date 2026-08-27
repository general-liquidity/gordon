// log-update — inlined ANSI cursor/erase helper.
//
// Status: NOT WIRED. Phase 1 swaps ink's `log-update.js` for this module.
//
// This is a faithful TypeScript port of ink's log-update implementation
// (`node_modules/ink/build/log-update.js`). It is deliberately minimal so
// future phases can replace it with a cell-diffing paint that only writes
// the lines that changed.
//
// The `incremental` mode is preserved because Gordon's `Ink` constructor
// supports `incrementalRendering: true`. The synchronized-output BSU/ESU
// envelope is also preserved so terminals (iTerm2, Windows Terminal,
// Ghostty, kitty, WezTerm, foot, Contour) that support it render without
// visible tear.

import ansiEscapes from "ansi-escapes";
import cliCursor from "cli-cursor";

// Begin/End Synchronized Update — terminals that implement DEC mode 2026
// paint the buffer atomically between BSU and ESU, eliminating tear.
const BSU = "\x1b[?2026h";
const ESU = "\x1b[?2026l";

const isSyncSupported = ((): boolean => {
  try {
    const term = process.env.TERM_PROGRAM ?? "";
    return (
      /iTerm|WezTerm|Ghostty|kitty|foot|Contour/i.test(term) || Boolean(process.env.WT_SESSION)
    );
  } catch {
    return false;
  }
})();

export type LogUpdate = {
  (str: string): void;
  clear: () => void;
  done: () => void;
  sync: (str: string) => void;
};

export type LogUpdateOptions = {
  showCursor?: boolean;
  incremental?: boolean;
};

const createStandard = (
  stream: NodeJS.WriteStream,
  { showCursor = false }: LogUpdateOptions = {},
): LogUpdate => {
  let previousLineCount = 0;
  let previousOutput = "";
  let hasHiddenCursor = false;

  const render = ((str: string) => {
    if (!showCursor && !hasHiddenCursor) {
      cliCursor.hide();
      hasHiddenCursor = true;
    }
    const output = `${str}\n`;
    if (output === previousOutput) return;
    previousOutput = output;
    stream.write(ansiEscapes.eraseLines(previousLineCount) + output);
    previousLineCount = output.split("\n").length;
  }) as LogUpdate;

  render.clear = () => {
    stream.write(ansiEscapes.eraseLines(previousLineCount));
    previousOutput = "";
    previousLineCount = 0;
  };
  render.done = () => {
    previousOutput = "";
    previousLineCount = 0;
    if (!showCursor) {
      cliCursor.show();
      hasHiddenCursor = false;
    }
  };
  render.sync = (str: string) => {
    const output = `${str}\n`;
    previousOutput = output;
    previousLineCount = output.split("\n").length;
  };
  return render;
};

const createIncremental = (
  stream: NodeJS.WriteStream,
  { showCursor = false }: LogUpdateOptions = {},
): LogUpdate => {
  let previousLines: string[] = [];
  let previousOutput = "";
  let hasHiddenCursor = false;

  const render = ((str: string) => {
    if (!showCursor && !hasHiddenCursor) {
      cliCursor.hide();
      hasHiddenCursor = true;
    }
    const output = `${str}\n`;
    if (output === previousOutput) return;

    const previousCount = previousLines.length;
    const nextLines = output.split("\n");
    const nextCount = nextLines.length;
    const visibleCount = nextCount - 1;

    if (output === "\n" || previousOutput.length === 0) {
      if (isSyncSupported) stream.write(BSU);
      stream.write(ansiEscapes.eraseLines(previousCount) + output);
      if (isSyncSupported) stream.write(ESU);
      previousOutput = output;
      previousLines = nextLines;
      return;
    }

    const buffer: string[] = [];
    if (nextCount < previousCount) {
      buffer.push(
        ansiEscapes.eraseLines(previousCount - nextCount + 1),
        ansiEscapes.cursorUp(visibleCount),
      );
    } else {
      buffer.push(ansiEscapes.cursorUp(previousCount - 1));
    }

    for (let i = 0; i < visibleCount; i++) {
      if (nextLines[i] === previousLines[i]) {
        buffer.push(ansiEscapes.cursorNextLine);
        continue;
      }
      buffer.push(`${ansiEscapes.cursorTo(0) + (nextLines[i] ?? "") + ansiEscapes.eraseEndLine}\n`);
    }

    if (isSyncSupported) stream.write(BSU);
    stream.write(buffer.join(""));
    if (isSyncSupported) stream.write(ESU);

    previousOutput = output;
    previousLines = nextLines;
  }) as LogUpdate;

  render.clear = () => {
    stream.write(ansiEscapes.eraseLines(previousLines.length));
    previousOutput = "";
    previousLines = [];
  };
  render.done = () => {
    previousOutput = "";
    previousLines = [];
    if (!showCursor) {
      cliCursor.show();
      hasHiddenCursor = false;
    }
  };
  render.sync = (str: string) => {
    const output = `${str}\n`;
    previousOutput = output;
    previousLines = output.split("\n");
  };
  return render;
};

const create = (
  stream: NodeJS.WriteStream,
  { showCursor = false, incremental = false }: LogUpdateOptions = {},
): LogUpdate => {
  if (incremental) return createIncremental(stream, { showCursor });
  return createStandard(stream, { showCursor });
};

const logUpdate = { create };
export default logUpdate;
