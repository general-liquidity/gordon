import { useState, useCallback, useRef } from "react";
import { execSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";

// ============================================================================
// useImagePaste — Detects pasted image paths and clipboard images
//
// Monitors for file paths ending in image extensions. On macOS, checks
// clipboard for image data via osascript. Saves to temp file for AI analysis.
// ============================================================================

const IMAGE_EXTENSIONS = /\.(png|jpg|jpeg|gif|webp|svg|bmp|tiff?)$/i;

function checkClipboardForImage(): string | null {
  if (process.platform !== "darwin") return null;

  try {
    const info = execSync('osascript -e "clipboard info"', { timeout: 2000 }).toString();
    if (info.includes("PNGf") || info.includes("TIFF") || info.includes("JPEG")) {
      // Extract image from clipboard and save to temp
      const tempPath = join(tmpdir(), `gordon-paste-${Date.now()}.png`);
      execSync(
        `osascript -e 'set theImage to the clipboard as «class PNGf»' -e 'set theFile to open for access POSIX file "${tempPath}" with write permission' -e 'write theImage to theFile' -e 'close access theFile'`,
        { timeout: 5000 },
      );
      return tempPath;
    }
  } catch {
    // Clipboard doesn't contain an image
  }
  return null;
}

export function useImagePaste(onImagePasted: (imagePath: string) => void) {
  const [hasPendingImage, setHasPendingImage] = useState(false);
  const [pendingImagePath, setPendingImagePath] = useState<string | null>(null);
  const callbackRef = useRef(onImagePasted);
  callbackRef.current = onImagePasted;

  const handlePastedText = useCallback((text: string) => {
    const trimmed = text.trim();

    // Check if it's a file path to an image
    if (IMAGE_EXTENSIONS.test(trimmed)) {
      setPendingImagePath(trimmed);
      setHasPendingImage(true);
      callbackRef.current(trimmed);
      return true;
    }

    // Check if clipboard contains an image (macOS only)
    const clipboardImage = checkClipboardForImage();
    if (clipboardImage) {
      setPendingImagePath(clipboardImage);
      setHasPendingImage(true);
      callbackRef.current(clipboardImage);
      return true;
    }

    return false;
  }, []);

  const clearPending = useCallback(() => {
    setHasPendingImage(false);
    setPendingImagePath(null);
  }, []);

  return { hasPendingImage, pendingImagePath, clearPending, handlePastedText };
}
