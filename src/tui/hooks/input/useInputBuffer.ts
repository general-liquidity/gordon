import { useRef, useCallback } from "react";

// ============================================================================
// useInputBuffer — Circular undo buffer for text input with Ctrl+Z support
// ============================================================================

interface BufferEntry {
  text: string;
  cursor: number;
}

export function useInputBuffer(maxSize = 50) {
  const bufferRef = useRef<BufferEntry[]>([]);
  const lastPushRef = useRef<number>(0);

  const push = useCallback(
    (text: string, cursor: number) => {
      const now = Date.now();
      if (now - lastPushRef.current < 300) return; // Debounce
      lastPushRef.current = now;

      const buf = bufferRef.current;
      if (buf.length > 0 && buf[buf.length - 1]!.text === text) return; // No change

      buf.push({ text, cursor });
      if (buf.length > maxSize) buf.shift();
    },
    [maxSize],
  );

  const undo = useCallback((): BufferEntry | null => {
    const buf = bufferRef.current;
    if (buf.length <= 1) return null;
    buf.pop(); // Remove current state
    return buf[buf.length - 1] ?? null;
  }, []);

  const clear = useCallback(() => {
    bufferRef.current = [];
  }, []);

  return { push, undo, canUndo: bufferRef.current.length > 1, clear };
}
