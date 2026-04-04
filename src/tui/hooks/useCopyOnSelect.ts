import { useState, useCallback } from "react";
import { execSync } from "child_process";

// ============================================================================
// useCopyOnSelect — Clipboard copy utility for terminal text
//
// Provides copyText() function that uses OSC 52, native commands, or
// platform-specific fallbacks. Returns last copied text and success state.
// ============================================================================

function writeToClipboard(text: string): boolean {
  // Try OSC 52 (works in most modern terminals including SSH)
  try {
    const b64 = Buffer.from(text).toString("base64");
    process.stdout.write(`\x1b]52;c;${b64}\x07`);
    return true;
  } catch {
    // Fall through
  }

  // Try native clipboard commands
  try {
    if (process.platform === "darwin") {
      execSync("pbcopy", { input: text, timeout: 2000 });
      return true;
    } else if (process.platform === "win32" || process.env.WSL_DISTRO_NAME) {
      execSync("clip.exe", { input: text, timeout: 2000 });
      return true;
    } else {
      // Linux: try xclip, then xsel
      try {
        execSync("xclip -selection clipboard", { input: text, timeout: 2000 });
        return true;
      } catch {
        execSync("xsel --clipboard --input", { input: text, timeout: 2000 });
        return true;
      }
    }
  } catch {
    return false;
  }
}

export function useCopyOnSelect(enabled = true) {
  const [lastCopied, setLastCopied] = useState<string | null>(null);
  const [copySuccess, setCopySuccess] = useState(false);

  const copyText = useCallback(
    (text: string) => {
      if (!enabled) return false;
      const success = writeToClipboard(text);
      setLastCopied(text);
      setCopySuccess(success);
      return success;
    },
    [enabled],
  );

  return { copyText, lastCopied, copySuccess };
}

export { writeToClipboard };
