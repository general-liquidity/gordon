export const COALESCE_WINDOW_MS = 33;

export interface Coalescer<T> {
  push(item: T): void;
  flushNow(): void;
  dispose(): void;
}

export function createCoalescer<T>(
  onFlush: (items: T[]) => void,
  windowMs: number = COALESCE_WINDOW_MS,
): Coalescer<T> {
  let buffer: T[] = [];
  let lastFlushAt = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;

  function flush(): void {
    if (disposed || buffer.length === 0) return;
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    const items = buffer;
    buffer = [];
    lastFlushAt = Date.now();
    onFlush(items);
  }

  return {
    push(item: T) {
      if (disposed) return;
      buffer.push(item);
      const now = Date.now();
      const elapsed = now - lastFlushAt;
      if (lastFlushAt === 0 || elapsed >= windowMs) {
        flush();
        return;
      }
      if (!timer) {
        timer = setTimeout(flush, windowMs - elapsed);
      }
    },
    flushNow() {
      flush();
    },
    dispose() {
      disposed = true;
      buffer = [];
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    },
  };
}
