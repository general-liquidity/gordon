// stylePool — Phase 1 ANSI style interning with LRU eviction.
//
// Active in customRender. Maps pre-serialized ANSI SGR strings to compact 8-bit
// IDs so cells can store them in the packed Int32 layout. Default capacity
// is 256 (the cell layout's styleId field is 8 bits). Baseline styles are
// pre-interned at construction to keep common cases stable across sessions.

import type { PoolStats, StylePool } from "./internal/contracts.ts";

// Baseline ANSI SGR sequences that Gordon emits frequently. Pre-interning
// them keeps their IDs stable at startup so snapshot diffing remains cheap
// and they never get evicted under pressure (they sit at the MRU tail after
// any touch). Order matters — index = initial ID.
const BASELINE_STYLES: readonly string[] = [
  "",             // 0: empty / no style
  "\x1b[0m",     // 1: reset
  "\x1b[1m",     // 2: bold
  "\x1b[2m",     // 3: dim
  "\x1b[3m",     // 4: italic
  "\x1b[4m",     // 5: underline
  "\x1b[7m",     // 6: inverse (used by selection overlay in Phase 4)
  "\x1b[22m",    // 7: bold/dim off
  "\x1b[39m",    // 8: default foreground
  "\x1b[49m",    // 9: default background
];

export function createStylePool(capacity: number = 256): StylePool {
  if (!Number.isInteger(capacity) || capacity < BASELINE_STYLES.length) {
    throw new Error(
      `createStylePool: capacity ${capacity} must be >= ${BASELINE_STYLES.length}`,
    );
  }

  // Two maps implement LRU: `strToId` for interning, `idToNode` for ordering.
  // A classic doubly-linked list keeps eviction O(1). We keep the head=LRU,
  // tail=MRU so new/touched items move to the tail.
  type Node = { id: number; str: string; prev: Node | null; next: Node | null };

  const strToId = new Map<string, number>();
  const idToNode = new Map<number, Node>();
  let head: Node | null = null;
  let tail: Node | null = null;
  let evictions = 0;
  let nextId = 0;

  function detach(node: Node): void {
    if (node.prev) node.prev.next = node.next;
    else head = node.next;
    if (node.next) node.next.prev = node.prev;
    else tail = node.prev;
    node.prev = null;
    node.next = null;
  }

  function append(node: Node): void {
    node.prev = tail;
    node.next = null;
    if (tail) tail.next = node;
    else head = node;
    tail = node;
  }

  function evictLRU(): void {
    if (!head) return;
    const victim = head;
    detach(victim);
    strToId.delete(victim.str);
    idToNode.delete(victim.id);
    evictions++;
  }

  function insert(str: string): number {
    // If full, evict the least-recently-used entry before adding the new one.
    while (strToId.size >= capacity) evictLRU();
    const id = nextId < capacity ? nextId++ : reclaimId();
    const node: Node = { id, str, prev: null, next: null };
    strToId.set(str, id);
    idToNode.set(id, node);
    append(node);
    return id;
  }

  // Reuse evicted IDs so we never outgrow the 8-bit styleId field even over
  // very long sessions. After eviction there is at least one free ID below
  // `nextId`; scan from 0 until we find one not in `idToNode`.
  function reclaimId(): number {
    for (let i = 0; i < capacity; i++) {
      if (!idToNode.has(i)) return i;
    }
    throw new Error("stylePool: no free id despite eviction — internal bug");
  }

  const pool: StylePool = {
    intern(ansi) {
      const existing = strToId.get(ansi);
      if (existing !== undefined) {
        // Touch: move to MRU tail.
        const node = idToNode.get(existing);
        if (node) {
          detach(node);
          append(node);
        }
        return existing;
      }
      return insert(ansi);
    },
    get(id) {
      return idToNode.get(id)?.str;
    },
    get size() {
      return strToId.size;
    },
    get capacity() {
      return capacity;
    },
    stats(): PoolStats {
      return { size: strToId.size, capacity, evictions };
    },
    reset() {
      strToId.clear();
      idToNode.clear();
      head = null;
      tail = null;
      evictions = 0;
      nextId = 0;
      for (const s of BASELINE_STYLES) insert(s);
    },
  };

  // Pre-intern baselines so IDs 0..N-1 are stable.
  for (const s of BASELINE_STYLES) insert(s);

  return pool;
}

/** Exposed for tests — the baseline style strings in insertion order. */
export const BASELINE_STYLE_STRINGS: readonly string[] = BASELINE_STYLES;
