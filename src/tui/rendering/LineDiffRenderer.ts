/**
 * LineDiffRenderer — Differential line rendering on top of stock Ink
 *
 * Caches the last frame as an array of lines. On each new frame,
 * only writes lines that changed. This gives ~80% of Claude Code's
 * cell-level diffing benefit without forking Ink.
 *
 * For a 200-line conversation, if only the spinner line changes,
 * we write 1 line instead of 200.
 */

const ESC = "\x1b";
const CSI = `${ESC}[`;

// BSU/ESU for atomic terminal painting
const BSU = `${CSI}?2026h`;
const ESU = `${CSI}?2026l`;

let previousLines: string[] = [];
let isFirstFrame = true;
let syncOutputSupported = true;

// Detect if terminal supports synchronized output
try {
  const term = process.env.TERM_PROGRAM ?? "";
  syncOutputSupported = /iTerm|WezTerm|Ghostty|kitty|foot|Contour/i.test(term)
    || !!process.env.WT_SESSION;
} catch {
  syncOutputSupported = false;
}

/**
 * Patch stdout.write to diff frames line-by-line.
 * Call once at startup. Returns cleanup function.
 */
export function installLineDiffRenderer(): () => void {
  const originalWrite = process.stdout.write.bind(process.stdout);

  const patchedWrite = function (
    chunk: string | Buffer | Uint8Array,
    encodingOrCallback?: BufferEncoding | ((err?: Error) => void),
    callback?: (err?: Error) => void,
  ): boolean {
    // Only diff string writes (Ink's output)
    if (typeof chunk !== "string") {
      return originalWrite(chunk, encodingOrCallback as BufferEncoding, callback);
    }

    // Skip non-frame writes (cursor sequences, etc.)
    if (chunk.length < 10 || !chunk.includes("\n")) {
      return originalWrite(chunk, encodingOrCallback as BufferEncoding, callback);
    }

    const newLines = chunk.split("\n");

    // First frame: write everything
    if (isFirstFrame) {
      previousLines = newLines;
      isFirstFrame = false;
      return originalWrite(chunk, encodingOrCallback as BufferEncoding, callback);
    }

    // Diff: find changed lines
    const output: string[] = [];
    const maxLen = Math.max(newLines.length, previousLines.length);
    let hasChanges = false;

    for (let i = 0; i < maxLen; i++) {
      const newLine = newLines[i] ?? "";
      const oldLine = previousLines[i] ?? "";

      if (newLine !== oldLine) {
        // Move cursor to line i, clear line, write new content
        output.push(`${CSI}${i + 1};1H${CSI}2K${newLine}`);
        hasChanges = true;
      }
    }

    // If fewer lines now, clear the extras
    if (newLines.length < previousLines.length) {
      for (let i = newLines.length; i < previousLines.length; i++) {
        output.push(`${CSI}${i + 1};1H${CSI}2K`);
      }
      hasChanges = true;
    }

    previousLines = newLines;

    if (!hasChanges) return true;

    // Write diff with synchronized output
    const diffStr = output.join("");
    if (syncOutputSupported) {
      return originalWrite(BSU + diffStr + ESU, encodingOrCallback as BufferEncoding, callback);
    }
    return originalWrite(diffStr, encodingOrCallback as BufferEncoding, callback);
  };

  (process.stdout as any).write = patchedWrite;

  return () => {
    (process.stdout as any).write = originalWrite;
    previousLines = [];
    isFirstFrame = true;
  };
}

/**
 * Reset the diff cache (e.g., after terminal resize or alt-screen toggle)
 */
export function resetLineDiffCache(): void {
  previousLines = [];
  isFirstFrame = true;
}

/**
 * Get stats about the diff renderer
 */
export function getLineDiffStats(): { cachedLines: number; syncOutput: boolean } {
  return { cachedLines: previousLines.length, syncOutput: syncOutputSupported };
}
