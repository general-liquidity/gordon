import { useRef, useEffect, useCallback } from "react";

// ============================================================================
// usePasteHandler — Detects bracketed paste mode and content types
// ============================================================================

export function usePasteHandler(onPaste: (text: string) => void) {
  const bufferRef = useRef("");
  const inBracketPasteRef = useRef(false);

  useEffect(() => {
    const onData = (data: Buffer) => {
      const str = data.toString();
      if (str.includes("\x1b[200~")) {
        inBracketPasteRef.current = true;
        bufferRef.current = "";
        return;
      }
      if (str.includes("\x1b[201~")) {
        inBracketPasteRef.current = false;
        if (bufferRef.current) {
          onPaste(bufferRef.current);
          bufferRef.current = "";
        }
        return;
      }
      if (inBracketPasteRef.current) {
        bufferRef.current += str;
      }
    };

    process.stdin.on("data", onData);
    return () => { process.stdin.off("data", onData); };
  }, [onPaste]);

  const detectContentType = useCallback((text: string): "csv" | "path" | "text" => {
    if (/\.(png|jpg|jpeg|gif|webp|svg)$/i.test(text.trim())) return "path";
    if (text.includes(",") && text.includes("\n")) return "csv";
    return "text";
  }, []);

  return { detectContentType };
}
