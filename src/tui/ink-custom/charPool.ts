// charPool — Phase 1 grapheme interning with LRU eviction.
//
// Active in customRender. Maps short strings (typically one grapheme, sometimes
// a short run) to 20-bit IDs suitable for the packed cell layout. Default
// capacity is 1<<20 = 1048576, the full addressable range. ASCII printable
// and common box-drawing chars are pre-interned so startup IDs are stable.

import boxes from "./internal/cli-boxes.ts";
import type { CharPool, PoolStats } from "./internal/contracts.ts";

const DEFAULT_CAPACITY = 1 << 20; // 1,048,576 — matches CELL_CHAR_MASK range.

function buildBaselineChars(): readonly string[] {
  const out: string[] = [];
  // Start with blank — ID 0 is the canonical "empty cell" glyph.
  out.push(" ");
  // ASCII printable, skipping the space we already pushed.
  for (let code = 0x21; code <= 0x7e; code++) out.push(String.fromCharCode(code));
  // Pull every unique box-drawing character from cli-boxes so border diffs
  // don't allocate. De-duplicate via a Set because several styles share glyphs.
  const seen = new Set(out);
  for (const style of Object.values(boxes)) {
    for (const ch of Object.values(style)) {
      if (!seen.has(ch)) {
        out.push(ch);
        seen.add(ch);
      }
    }
  }
  return out;
}

const BASELINE_CHARS: readonly string[] = buildBaselineChars();

export function createCharPool(capacity: number = DEFAULT_CAPACITY): CharPool {
  if (!Number.isInteger(capacity) || capacity < BASELINE_CHARS.length) {
    throw new Error(
      `createCharPool: capacity ${capacity} must be >= ${BASELINE_CHARS.length}`,
    );
  }

  // Same LRU skeleton as stylePool but over graphemes. For Phase 1 this is a
  // Map<string, id> + doubly-linked list; a trie can land later if profiling
  // demands it.
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

  function reclaimId(): number {
    for (let i = 0; i < capacity; i++) {
      if (!idToNode.has(i)) return i;
    }
    throw new Error("charPool: no free id despite eviction — internal bug");
  }

  function insert(str: string): number {
    while (strToId.size >= capacity) evictLRU();
    const id = nextId < capacity ? nextId++ : reclaimId();
    const node: Node = { id, str, prev: null, next: null };
    strToId.set(str, id);
    idToNode.set(id, node);
    append(node);
    return id;
  }

  const pool: CharPool = {
    intern(s) {
      const existing = strToId.get(s);
      if (existing !== undefined) {
        const node = idToNode.get(existing);
        if (node) {
          detach(node);
          append(node);
        }
        return existing;
      }
      return insert(s);
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
      for (const s of BASELINE_CHARS) insert(s);
    },
  };

  for (const s of BASELINE_CHARS) insert(s);

  return pool;
}

/** Exposed for tests — baseline grapheme list in insertion order. */
export const BASELINE_CHAR_STRINGS: readonly string[] = BASELINE_CHARS;
