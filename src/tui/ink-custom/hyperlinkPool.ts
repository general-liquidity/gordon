/**
 * hyperlinkPool — Phase 4 reconciler module.
 *
 * Interns OSC 8 hyperlink URLs and returns compact integer IDs so the cell
 * grid can carry hyperlink metadata without re-serializing the URL string on
 * every cell. LRU eviction keeps the pool bounded in long sessions.
 *
 * This is the reconciler-level equivalent of what `components/TerminalLink`
 * emits inline today; when Phase 6 activates, cells referencing a hyperlink
 * ID will resolve the URL through this pool at ANSI-patch time.
 */

import type { HyperlinkPool, PoolStats } from "./internal/contracts.ts";

export function createHyperlinkPool(capacity = 256): HyperlinkPool {
  if (!Number.isInteger(capacity) || capacity <= 0) {
    throw new Error(`hyperlinkPool: capacity must be a positive integer, got ${capacity}`);
  }

  // Map iteration order preserves insertion order; re-inserting on access
  // moves an entry to the most-recent position, giving us LRU for free.
  const urlToId = new Map<string, number>();
  const idToUrl = new Map<number, string>();
  let nextId = 1;
  let evictions = 0;

  function touch(url: string, id: number): void {
    // Re-insert to mark most-recently-used (Map preserves insertion order).
    urlToId.delete(url);
    urlToId.set(url, id);
  }

  function evictOldest(): void {
    const oldestEntry = urlToId.entries().next();
    if (oldestEntry.done) return;
    const [oldestUrl, oldestId] = oldestEntry.value;
    urlToId.delete(oldestUrl);
    idToUrl.delete(oldestId);
    evictions++;
  }

  const pool: HyperlinkPool = {
    intern(url: string): number {
      const existing = urlToId.get(url);
      if (existing !== undefined) {
        touch(url, existing);
        return existing;
      }

      if (urlToId.size >= capacity) {
        evictOldest();
      }

      const id = nextId++;
      urlToId.set(url, id);
      idToUrl.set(id, url);
      return id;
    },

    get(id: number): string | undefined {
      return idToUrl.get(id);
    },

    get size(): number {
      return urlToId.size;
    },

    get capacity(): number {
      return capacity;
    },

    stats(): PoolStats {
      return {
        size: urlToId.size,
        capacity,
        evictions,
      };
    },

    reset(): void {
      urlToId.clear();
      idToUrl.clear();
      nextId = 1;
      evictions = 0;
    },
  };

  return pool;
}
