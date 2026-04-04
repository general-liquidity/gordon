// ============================================================================
// CircularBuffer — Fixed-size rolling window with O(1) add
//
// Used for price ticks, trade history, indicator values.
// Auto-evicts oldest items when full.
// ============================================================================

export class CircularBuffer<T> {
  private buffer: (T | undefined)[];
  private head = 0;
  private count = 0;
  private readonly maxSize: number;

  constructor(maxSize: number) {
    this.maxSize = maxSize;
    this.buffer = new Array(maxSize);
  }

  add(item: T): void {
    this.buffer[this.head] = item;
    this.head = (this.head + 1) % this.maxSize;
    if (this.count < this.maxSize) this.count++;
  }

  addAll(items: T[]): void {
    for (const item of items) this.add(item);
  }

  getRecent(n?: number): T[] {
    const count = Math.min(n ?? this.count, this.count);
    const result: T[] = [];
    for (let i = 0; i < count; i++) {
      const idx = (this.head - count + i + this.maxSize) % this.maxSize;
      result.push(this.buffer[idx] as T);
    }
    return result;
  }

  toArray(): T[] {
    return this.getRecent(this.count);
  }

  clear(): void {
    this.head = 0;
    this.count = 0;
    this.buffer = new Array(this.maxSize);
  }

  get size(): number {
    return this.count;
  }

  get isFull(): boolean {
    return this.count === this.maxSize;
  }
}
