export const STREAM_FLUSH_INTERVAL_MS = 100;

export interface StreamFlusher {
  readonly buffer: string;
  push(chunk: string): void;
  flushNow(): void;
  dispose(): void;
}

export function createStreamFlusher(
  onFlush: (buffer: string) => void,
  intervalMs: number = STREAM_FLUSH_INTERVAL_MS,
): StreamFlusher {
  let buffer = "";
  let lastFlushAt = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;

  function flush(): void {
    if (disposed) return;
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    lastFlushAt = Date.now();
    onFlush(buffer);
  }

  return {
    get buffer() {
      return buffer;
    },
    push(chunk: string) {
      if (disposed || chunk.length === 0) return;
      buffer += chunk;
      const now = Date.now();
      const elapsed = now - lastFlushAt;
      if (lastFlushAt === 0 || elapsed >= intervalMs) {
        flush();
        return;
      }
      if (!timer) {
        timer = setTimeout(flush, intervalMs - elapsed);
      }
    },
    flushNow() {
      if (disposed) return;
      flush();
    },
    dispose() {
      disposed = true;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    },
  };
}
