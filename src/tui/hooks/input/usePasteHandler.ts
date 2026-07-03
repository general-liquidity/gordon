import { useEffect, useRef, useCallback } from "react";
import useStdin from "../../ink-custom/hooks/use-stdin.ts";

// ============================================================================
// usePasteHandler — subscribes to the coalesced bracketed-paste channel.
//
// The stdin tokenizer (src/tui/ink-custom/stdin-tokenizer.ts) recognizes the
// DEC-2004 paste markers, buffers the content across chunk boundaries, and
// emits a single `paste` event on the App's internal emitter. This hook is a
// thin subscriber over that channel. It deliberately does NOT attach its own
// `process.stdin` listener — a second reader competes with the App's readable
// handler and drops characters (the failure mode Claude Code documents).
// ============================================================================

export function usePasteHandler(onPaste: (text: string) => void) {
  // eslint-disable-next-line @typescript-eslint/naming-convention
  const { internal_eventEmitter } = useStdin();
  const onPasteRef = useRef(onPaste);
  onPasteRef.current = onPaste;

  useEffect(() => {
    if (!internal_eventEmitter) return;
    const handler = (text: string): void => {
      onPasteRef.current(text);
    };
    internal_eventEmitter.on("paste", handler);
    return () => {
      internal_eventEmitter.removeListener("paste", handler);
    };
  }, [internal_eventEmitter]);

  const detectContentType = useCallback((text: string): "csv" | "path" | "text" => {
    if (/\.(png|jpg|jpeg|gif|webp|svg)$/i.test(text.trim())) return "path";
    if (text.includes(",") && text.includes("\n")) return "csv";
    return "text";
  }, []);

  return { detectContentType };
}
