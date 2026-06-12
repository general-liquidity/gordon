/**
 * Performance Monitor — Phase 5 reconciler baseline instrumentation.
 *
 * Collects real-world TUI perf metrics so we can compare "before reconciler"
 * vs "after reconciler" once the custom reconciler behind ink-custom activates.
 *
 * Captured:
 *   1. Frame-time histogram — deltas between successive stdout writes from Ink
 *      (p50 / p95 / p99 computed over a rolling window, default 60 samples).
 *   2. Render count per message — count of ADD_MESSAGE (or equivalent) events
 *      observed by the caller.
 *   3. Cell churn approximation — bytes/chars written to stdout per frame.
 *   4. Memory snapshots — `process.memoryUsage()` sampled every `memoryIntervalMs`.
 *
 * Activation:
 *   - Zero-cost when `GORDON_PERF_LOG` is unset and no caller invokes `record()`.
 *   - If `GORDON_PERF_LOG=/path/to/output.jsonl` is set, `start({ flushPath })`
 *     (or auto-pickup via the env var) appends a JSON line every `flushIntervalMs`
 *     using an atomic write (temp file + rename) so process crashes don't
 *     corrupt the log.
 *
 * Design notes:
 *   - Ring buffers are plain bounded arrays (`events`, `frameDeltas`, `memory`)
 *     to keep allocation pressure low and avoid pulling in a data-structure lib.
 *   - Histograms are computed on demand from the frame-time ring by sorting
 *     a copy — O(n log n) on ≤ `frameWindow` elements (default 60). Cheap.
 *   - Pool saturation (N/A until reconciler lands) is intentionally omitted.
 */

import { writeFileSync, renameSync, existsSync, mkdirSync, readFileSync, appendFileSync } from "node:fs";
import { dirname } from "node:path";

// ─────────────────────────────────────────────────────────────────────────────
// Event types
// ─────────────────────────────────────────────────────────────────────────────

export type MetricEventKind =
  | "frame"      // a stdout write happened — the "frame" boundary for Ink
  | "render"    // React re-render (ADD_MESSAGE or equivalent dispatch)
  | "memory";   // sampled process.memoryUsage()

export interface FrameEvent {
  kind: "frame";
  /** High-resolution timestamp in milliseconds since monitor start. */
  ts: number;
  /** Bytes / characters in this stdout write (cell-churn approximation). */
  bytes: number;
  /** Duration of the stdout.write call itself, in milliseconds. */
  writeMs: number;
}

export interface RenderEvent {
  kind: "render";
  ts: number;
  /** Number of messages in the app store at the time of the dispatch. */
  messageCount: number;
  /** Optional label (e.g. action type) for later grouping. */
  label?: string;
}

export interface MemoryEvent {
  kind: "memory";
  ts: number;
  heapUsed: number;
  heapTotal: number;
  external: number;
  rss: number;
}

export type MetricEvent = FrameEvent | RenderEvent | MemoryEvent;
export type InteractionKind = "keystroke" | "stream";
export type AttributedFrameKind = InteractionKind | "other";
export type AttributedFrameCallback = (kind: AttributedFrameKind, durationMs: number) => void;

// ─────────────────────────────────────────────────────────────────────────────
// Snapshot shape
// ─────────────────────────────────────────────────────────────────────────────

export interface FrameHistogram {
  /** Number of samples in the rolling window used to compute these values. */
  samples: number;
  /** 50th / 95th / 99th percentile frame delta in ms. */
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  /** Mean delta, ms. */
  meanMs: number;
  /** Mean bytes per frame (cell-churn proxy). */
  meanBytes: number;
  /** Mean stdout.write duration. */
  meanWriteMs: number;
}

export interface MemorySample {
  ts: number;
  heapUsed: number;
  heapTotal: number;
  external: number;
  rss: number;
}

export interface PerfSnapshot {
  /** Epoch ms when the monitor was started. */
  startedAt: number;
  /** Epoch ms when the snapshot was taken. */
  takenAt: number;
  /** Total events observed across all buffers (may exceed buffer capacity). */
  totalEvents: number;
  /** Total frame / stdout write events observed. */
  totalFrames: number;
  /** Total render events observed. */
  totalRenders: number;
  /** Render counter partitioned by label, e.g. { "ADD_MESSAGE": 42 }. */
  rendersByLabel: Record<string, number>;
  /** Frame-time histogram across the rolling `frameWindow`. */
  frameHistogram: FrameHistogram;
  /** Latest memory sample, or null if none have been taken. */
  latestMemory: MemorySample | null;
  /** Recent memory samples (most-recent-first, up to `memoryBufferSize`). */
  memorySamples: MemorySample[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Options
// ─────────────────────────────────────────────────────────────────────────────

export interface PerfMonitorOptions {
  /**
   * How long (ms) of history to retain across the ring buffer. Default 10 min.
   * Used to derive the event buffer capacity.
   */
  retentionMs?: number;
  /** Size of the rolling window used to compute frame-time histograms. Default 60. */
  frameWindow?: number;
  /** How many memory samples to keep in memory. Default = retentionMs / memoryIntervalMs. */
  memoryBufferSize?: number;
  /** Memory sample cadence. Default 30000 (30s). */
  memoryIntervalMs?: number;
  /** JSONL flush cadence when a `flushPath` is configured. Default 30000 (30s). */
  flushIntervalMs?: number;
  /** Hard cap on the generic event ring buffer. Default 4096. */
  maxEvents?: number;
}

export interface StartOptions {
  /** Path to a JSONL file. If provided, the monitor flushes snapshots here. */
  flushPath?: string;
  /** Override the memory interval for this run. */
  memoryIntervalMs?: number;
  /** Override the flush interval for this run. */
  flushIntervalMs?: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Ring buffer
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fixed-capacity ring buffer. Writes wrap when full; reads return entries in
 * chronological order. Keeps memory footprint predictable for long sessions.
 */
export class RingBuffer<T> {
  private readonly capacity: number;
  private buf: Array<T | undefined>;
  private head = 0;   // next write index
  private size = 0;   // current count
  private totalWrites = 0;

  constructor(capacity: number) {
    if (capacity <= 0) throw new Error("RingBuffer capacity must be > 0");
    this.capacity = capacity;
    this.buf = new Array<T | undefined>(capacity);
  }

  /** Append one item. Overwrites the oldest entry when full. */
  push(item: T): void {
    this.buf[this.head] = item;
    this.head = (this.head + 1) % this.capacity;
    if (this.size < this.capacity) this.size += 1;
    this.totalWrites += 1;
  }

  /** Current number of items stored. */
  length(): number {
    return this.size;
  }

  /** Monotonic counter of `push()` calls (including overwrites). */
  totalCount(): number {
    return this.totalWrites;
  }

  /** Configured capacity. */
  getCapacity(): number {
    return this.capacity;
  }

  /** Return a snapshot array in chronological (oldest-first) order. */
  toArray(): T[] {
    const out: T[] = [];
    if (this.size === 0) return out;
    const start = (this.head - this.size + this.capacity) % this.capacity;
    for (let i = 0; i < this.size; i++) {
      const entry = this.buf[(start + i) % this.capacity];
      if (entry !== undefined) out.push(entry);
    }
    return out;
  }

  /** Drop all contents (but keep the capacity). */
  clear(): void {
    this.buf = new Array<T | undefined>(this.capacity);
    this.head = 0;
    this.size = 0;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Main monitor
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULTS: Required<PerfMonitorOptions> = {
  retentionMs: 10 * 60 * 1000,
  frameWindow: 60,
  memoryBufferSize: 0, // derived in constructor when left at 0
  memoryIntervalMs: 30_000,
  flushIntervalMs: 30_000,
  maxEvents: 4096,
};

export class PerformanceMonitor {
  private readonly opts: Required<PerfMonitorOptions>;
  private readonly events: RingBuffer<MetricEvent>;
  private readonly frameDeltas: RingBuffer<FrameEvent>;
  private readonly memory: RingBuffer<MemoryEvent>;
  private lastFrameTs: number | null = null;
  private startedAt: number | null = null;
  private startHrMs = 0;
  private totalRenders = 0;
  private totalFrames = 0;
  private rendersByLabel: Record<string, number> = {};
  private interactionMark: { kind: InteractionKind; atMs: number } | null = null;
  private attributedFrameCallbacks = new Set<AttributedFrameCallback>();

  private memoryTimer: ReturnType<typeof setInterval> | null = null;
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private flushPath: string | null = null;

  constructor(options: PerfMonitorOptions = {}) {
    const merged: Required<PerfMonitorOptions> = { ...DEFAULTS, ...options };
    // Derive memoryBufferSize default from retention / sample interval
    if (!merged.memoryBufferSize || merged.memoryBufferSize <= 0) {
      merged.memoryBufferSize = Math.max(
        8,
        Math.ceil(merged.retentionMs / merged.memoryIntervalMs),
      );
    }
    this.opts = merged;
    this.events = new RingBuffer<MetricEvent>(merged.maxEvents);
    this.frameDeltas = new RingBuffer<FrameEvent>(merged.frameWindow);
    this.memory = new RingBuffer<MemoryEvent>(merged.memoryBufferSize);
  }

  /** Start sampling. Safe to call more than once; subsequent calls are no-ops
   *  until `stop()` is called.
   */
  start(opts: StartOptions = {}): void {
    if (this.startedAt !== null) return;
    this.startedAt = Date.now();
    this.startHrMs = this.hrNow();
    this.flushPath = opts.flushPath ?? process.env.GORDON_PERF_LOG ?? null;

    const memInt = opts.memoryIntervalMs ?? this.opts.memoryIntervalMs;
    this.memoryTimer = setInterval(() => {
      try {
        this.sampleMemory();
      } catch {
        // keep the monitor resilient — bad sample never kills the process
      }
    }, memInt);
    // Don't keep the event loop alive on account of diagnostics.
    this.memoryTimer.unref?.();

    if (this.flushPath) {
      const flushInt = opts.flushIntervalMs ?? this.opts.flushIntervalMs;
      this.flushTimer = setInterval(() => {
        try {
          this.flushSnapshot();
        } catch {
          // swallow; disk errors should not kill the TUI
        }
      }, flushInt);
      this.flushTimer.unref?.();
    }

    // Take one memory sample immediately so callers see something in a snapshot.
    this.sampleMemory();
  }

  /** Stop sampling. Flushes a final snapshot when a flush path is configured. */
  stop(): void {
    if (this.memoryTimer) {
      clearInterval(this.memoryTimer);
      this.memoryTimer = null;
    }
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    if (this.flushPath) {
      try {
        this.flushSnapshot();
      } catch {
        // ignore
      }
    }
    this.startedAt = null;
  }

  /**
   * Append an event to the appropriate ring buffer. Cheap; callers should not
   * fear invoking this on hot paths (it never allocates beyond the event
   * object itself and does not touch disk).
   */
  record(event: MetricEvent): void {
    this.events.push(event);
    if (event.kind === "frame") {
      this.frameDeltas.push(event);
      this.totalFrames += 1;
      this.lastFrameTs = event.ts;
    } else if (event.kind === "render") {
      this.totalRenders += 1;
      const label = event.label ?? "render";
      this.rendersByLabel[label] = (this.rendersByLabel[label] ?? 0) + 1;
    } else {
      this.memory.push(event);
    }
  }

  /**
   * Helper: record a stdout write. Computes the delta since the previous
   * frame automatically. Returns the delta in ms (useful for callers).
   */
  recordFrame(bytes: number, writeMs: number, atMs?: number): number {
    const ts = atMs ?? this.hrNow() - this.startHrMs;
    const delta = this.lastFrameTs === null ? 0 : ts - this.lastFrameTs;
    this.record({ kind: "frame", ts, bytes, writeMs });
    const mark = this.interactionMark;
    if (mark) {
      this.interactionMark = null;
      const durationMs = Math.max(0, ts - mark.atMs + writeMs);
      for (const cb of this.attributedFrameCallbacks) cb(mark.kind, durationMs);
    } else {
      for (const cb of this.attributedFrameCallbacks) cb("other", delta);
    }
    return delta;
  }

  /** Helper: record a render event (e.g. new message dispatched). */
  recordRender(messageCount: number, label?: string, atMs?: number): void {
    const ts = atMs ?? this.hrNow() - this.startHrMs;
    this.record({ kind: "render", ts, messageCount, label });
  }

  markInteraction(kind: InteractionKind, atMs?: number): void {
    this.interactionMark = { kind, atMs: atMs ?? this.hrNow() - this.startHrMs };
  }

  takeInteractionMark(): { kind: InteractionKind; atMs: number } | null {
    const mark = this.interactionMark;
    this.interactionMark = null;
    return mark;
  }

  onAttributedFrame(cb: AttributedFrameCallback): () => void {
    this.attributedFrameCallbacks.add(cb);
    return () => {
      this.attributedFrameCallbacks.delete(cb);
    };
  }

  /** Return a computed snapshot over the current ring buffer contents. */
  snapshot(): PerfSnapshot {
    const now = Date.now();
    const frames = this.frameDeltas.toArray();
    const memSamples = this.memory.toArray().map(toSample);

    return {
      startedAt: this.startedAt ?? now,
      takenAt: now,
      totalEvents: this.events.totalCount(),
      totalFrames: this.totalFrames,
      totalRenders: this.totalRenders,
      rendersByLabel: { ...this.rendersByLabel },
      frameHistogram: computeHistogram(frames),
      latestMemory: memSamples.length > 0 ? (memSamples[memSamples.length - 1] ?? null) : null,
      memorySamples: memSamples.slice().reverse(), // most-recent-first
    };
  }

  /** Reset all buffers and counters. Does not stop timers. */
  reset(): void {
    this.events.clear();
    this.frameDeltas.clear();
    this.memory.clear();
    this.lastFrameTs = null;
    this.totalFrames = 0;
    this.totalRenders = 0;
    this.rendersByLabel = {};
    this.startHrMs = this.hrNow();
  }

  /** Convenience for tests and observability endpoints. */
  isRunning(): boolean {
    return this.startedAt !== null;
  }

  /** Current flush path, if any. */
  getFlushPath(): string | null {
    return this.flushPath;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Internals
  // ───────────────────────────────────────────────────────────────────────────

  private sampleMemory(): void {
    const mu = process.memoryUsage();
    const ts = this.hrNow() - this.startHrMs;
    this.record({
      kind: "memory",
      ts,
      heapUsed: mu.heapUsed,
      heapTotal: mu.heapTotal,
      external: mu.external,
      rss: mu.rss,
    });
  }

  /**
   * Append a JSON-line snapshot to `flushPath`. Uses a temp file + rename so
   * a crash mid-write leaves either the previous file or the new file intact,
   * never a partial one.
   */
  private flushSnapshot(): void {
    if (!this.flushPath) return;
    const snap = this.snapshot();
    const dir = dirname(this.flushPath);
    if (dir && !existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    atomicAppendJsonl(this.flushPath, snap);
  }

  /** High-resolution monotonic timestamp (ms). */
  private hrNow(): number {
    // performance.now() is available under Bun & Node >= 16; the global is typed
    // as possibly undefined in older Node lib versions, so fall back to Date.
    const p = (globalThis as { performance?: { now: () => number } }).performance;
    return p ? p.now() : Date.now();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Pure helpers (exported for tests)
// ─────────────────────────────────────────────────────────────────────────────

export function computeHistogram(frames: FrameEvent[]): FrameHistogram {
  if (frames.length < 2) {
    return {
      samples: frames.length,
      p50Ms: 0,
      p95Ms: 0,
      p99Ms: 0,
      meanMs: 0,
      meanBytes: frames[0]?.bytes ?? 0,
      meanWriteMs: frames[0]?.writeMs ?? 0,
    };
  }

  // Deltas are computed from successive frame timestamps.
  const deltas: number[] = [];
  let bytesSum = 0;
  let writeSum = 0;
  for (let i = 0; i < frames.length; i++) {
    const f = frames[i]!;
    bytesSum += f.bytes;
    writeSum += f.writeMs;
    if (i > 0) {
      const prev = frames[i - 1]!;
      const d = f.ts - prev.ts;
      if (d >= 0) deltas.push(d);
    }
  }

  const sorted = deltas.slice().sort((a, b) => a - b);
  const n = sorted.length;
  const pick = (p: number): number => {
    if (n === 0) return 0;
    const idx = Math.min(n - 1, Math.max(0, Math.floor((n - 1) * p)));
    return sorted[idx] ?? 0;
  };
  const meanMs = n > 0 ? deltas.reduce((a, b) => a + b, 0) / n : 0;

  return {
    samples: frames.length,
    p50Ms: pick(0.5),
    p95Ms: pick(0.95),
    p99Ms: pick(0.99),
    meanMs,
    meanBytes: bytesSum / frames.length,
    meanWriteMs: writeSum / frames.length,
  };
}

function toSample(e: MemoryEvent): MemorySample {
  return {
    ts: e.ts,
    heapUsed: e.heapUsed,
    heapTotal: e.heapTotal,
    external: e.external,
    rss: e.rss,
  };
}

/**
 * Atomically append one JSON line to `path`. Strategy:
 *   1. Read the existing file (if any) into memory.
 *   2. Write (existing + newLine) to `<path>.tmp`.
 *   3. Rename `<path>.tmp` → `path`.
 * This preserves the previous contents on crash, at the cost of rewriting the
 * whole file each flush. For perf logs this is acceptable because snapshots
 * are taken every 30s and are small (<= a few KB each).
 *
 * If a simple append would be preferable for very large logs, callers can
 * opt out by rotating the file periodically.
 */
export function atomicAppendJsonl(path: string, record: unknown): void {
  const line = JSON.stringify(record) + "\n";
  const tmp = `${path}.tmp`;

  let prior = "";
  if (existsSync(path)) {
    try {
      prior = readFileSync(path, "utf8");
    } catch {
      // If we can't read the prior file, start fresh rather than failing.
      prior = "";
    }
  }
  try {
    writeFileSync(tmp, prior + line, "utf8");
    renameSync(tmp, path);
  } catch (err) {
    // Best-effort fallback: straight append. Not atomic, but better than losing
    // the data entirely when rename fails on some cross-device moves.
    try {
      appendFileSync(path, line, "utf8");
    } catch {
      // Give up silently — diagnostics never kill the host process.
    }
    // Re-throw only in development
    if (process.env.GORDON_PERF_DEBUG) throw err;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Singleton
// ─────────────────────────────────────────────────────────────────────────────

let instance: PerformanceMonitor | null = null;

/**
 * Lazily create (on first call) a process-wide monitor. Call sites that only
 * read metrics can still do so without paying the cost of `start()`.
 */
export function getPerformanceMonitor(options?: PerfMonitorOptions): PerformanceMonitor {
  if (!instance) {
    instance = new PerformanceMonitor(options);
  }
  return instance;
}

/** Reset the singleton. Useful for tests. */
export function resetPerformanceMonitor(): void {
  if (instance?.isRunning()) {
    instance.stop();
  }
  instance = null;
}

export function markInteraction(kind: InteractionKind): void {
  getPerformanceMonitor().markInteraction(kind);
}

export function takeInteractionMark(): { kind: InteractionKind; atMs: number } | null {
  return getPerformanceMonitor().takeInteractionMark();
}

// ─────────────────────────────────────────────────────────────────────────────
// Stdout wrapper — Option A: patch `process.stdout.write` to observe Ink writes.
//
// We keep this a free function rather than a method so it can be enabled /
// disabled explicitly from App.tsx without the monitor lifecycle owning it.
// ─────────────────────────────────────────────────────────────────────────────

type WriteFn = typeof process.stdout.write;
let originalWrite: WriteFn | null = null;

/**
 * Install a wrapper around `process.stdout.write` that records a `frame`
 * event for every write. Idempotent. Returns a function that restores the
 * original writer.
 *
 * NOTE: the wrapper approximates cell churn by counting the byte-length of
 * each payload. For exact cell-level churn we'd need cursor/escape parsing,
 * which is cheaper (and more accurate) in the custom reconciler. Until then
 * this is the best we can do without touching Ink's internals.
 */
export function installStdoutTap(monitor: PerformanceMonitor = getPerformanceMonitor()): () => void {
  if (originalWrite !== null) {
    return uninstallStdoutTap; // already installed; return the uninstall hook
  }
  const stdout = process.stdout;
  originalWrite = stdout.write.bind(stdout) as WriteFn;
  const base = originalWrite;

  // Use a bespoke wrapper that preserves the overloaded signature of
  // `stream.Writable.prototype.write`. We accept `unknown` inputs because the
  // real signature has multiple overloads.
  const wrapped = function write(
    this: typeof stdout,
    chunk: unknown,
    encodingOrCb?: unknown,
    maybeCb?: unknown,
  ): boolean {
    const start = perfNow();
    // Best-effort length. Buffers expose `length`; strings do too; everything
    // else falls back to 0 rather than throwing (we never want diagnostics to
    // break the TUI).
    let bytes = 0;
    if (typeof chunk === "string") {
      bytes = Buffer.byteLength(chunk);
    } else if (chunk && typeof (chunk as { length?: number }).length === "number") {
      bytes = (chunk as { length: number }).length;
    }
    // @ts-expect-error — delegating to the original overloaded signature.
    const ok = base(chunk, encodingOrCb, maybeCb);
    const writeMs = perfNow() - start;
    try {
      monitor.recordFrame(bytes, writeMs);
    } catch {
      // never let recorder throw break the pipe
    }
    return ok;
  } as WriteFn;

  // Install
  stdout.write = wrapped;
  return uninstallStdoutTap;
}

/** Restore the original `process.stdout.write`. Safe to call if not installed. */
export function uninstallStdoutTap(): void {
  if (originalWrite === null) return;
  process.stdout.write = originalWrite;
  originalWrite = null;
}

function perfNow(): number {
  const p = (globalThis as { performance?: { now: () => number } }).performance;
  return p ? p.now() : Date.now();
}
