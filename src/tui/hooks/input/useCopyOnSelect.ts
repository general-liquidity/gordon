import { useState, useCallback } from "react";
import { execSync } from "node:child_process";

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

  // Try native clipboard commands. Each attempt is wrapped in its own
  // try/catch so a missing tool on one path doesn't blow up the next
  // fallback. Returns true on first success, false if everything fails.
  if (process.platform === "darwin") {
    try {
      execSync("pbcopy", { input: text, timeout: 2000 });
      return true;
    } catch {
      return false;
    }
  }

  if (process.platform === "win32" || process.env.WSL_DISTRO_NAME) {
    try {
      execSync("clip.exe", { input: text, timeout: 2000 });
      return true;
    } catch {
      // WSL 1 may not have clip.exe in PATH; OSC 52 above already
      // covered the modern terminal path. Nothing else to try.
      return false;
    }
  }

  // Linux: try xclip, then xsel, then wl-copy (Wayland). Each guarded.
  try {
    execSync("xclip -selection clipboard", { input: text, timeout: 2000 });
    return true;
  } catch {
    // xclip not installed
  }
  try {
    execSync("xsel --clipboard --input", { input: text, timeout: 2000 });
    return true;
  } catch {
    // xsel not installed
  }
  try {
    execSync("wl-copy", { input: text, timeout: 2000 });
    return true;
  } catch {
    // No Linux clipboard tool available
  }
  return false;
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
