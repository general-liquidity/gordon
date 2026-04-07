/**
 * FPS Metrics Tracking
 *
 * Tracks average FPS and P1 (1st percentile) FPS — worst-case frame time.
 * Useful for detecting if rendering degrades under load (e.g., high-frequency
 * market data updates).
 *
 * Claude Code pattern: persisted to session config for telemetry.
 */

export interface FpsSnapshot {
  avgFps: number;
  p1Fps: number;
  totalFrames: number;
  droppedFrames: number;
  measurementDurationMs: number;
}

export class FpsTracker {
  private frameTimes: number[] = [];
  private lastFrameTime: number = 0;
  private maxSamples: number;
  private startTime: number;
  private droppedFrames: number = 0;
  /** FPS below this threshold counts as "dropped". */
  private dropThreshold: number;

  constructor(options?: { maxSamples?: number; dropThresholdFps?: number }) {
    this.maxSamples = options?.maxSamples ?? 300;
    this.dropThreshold = 1000 / (options?.dropThresholdFps ?? 5); // 5fps = 200ms/frame
    this.startTime = Date.now();
  }

  /**
   * Record a frame render. Call once per render cycle.
   */
  recordFrame(): void {
    const now = Date.now();
    if (this.lastFrameTime > 0) {
      const delta = now - this.lastFrameTime;
      this.frameTimes.push(delta);

      if (delta > this.dropThreshold) {
        this.droppedFrames++;
      }

      // Keep bounded
      if (this.frameTimes.length > this.maxSamples) {
        this.frameTimes.splice(0, this.frameTimes.length - this.maxSamples);
      }
    }
    this.lastFrameTime = now;
  }

  /**
   * Get current FPS metrics.
   */
  snapshot(): FpsSnapshot {
    if (this.frameTimes.length === 0) {
      return {
        avgFps: 0,
        p1Fps: 0,
        totalFrames: 0,
        droppedFrames: 0,
        measurementDurationMs: Date.now() - this.startTime,
      };
    }

    const sorted = [...this.frameTimes].sort((a, b) => a - b);
    const avgDelta = sorted.reduce((sum, d) => sum + d, 0) / sorted.length;
    const p99Delta = sorted[Math.floor(sorted.length * 0.99)] ?? avgDelta;

    return {
      avgFps: Math.round(1000 / avgDelta),
      p1Fps: Math.round(1000 / p99Delta),
      totalFrames: this.frameTimes.length,
      droppedFrames: this.droppedFrames,
      measurementDurationMs: Date.now() - this.startTime,
    };
  }

  /**
   * Format for display.
   */
  formatDisplay(): string {
    const s = this.snapshot();
    return `${s.avgFps}fps avg, ${s.p1Fps}fps P1, ${s.droppedFrames} dropped`;
  }

  /**
   * Reset counters.
   */
  reset(): void {
    this.frameTimes = [];
    this.lastFrameTime = 0;
    this.droppedFrames = 0;
    this.startTime = Date.now();
  }
}

// ── Singleton ──

let instance: FpsTracker | null = null;

export function getFpsTracker(): FpsTracker {
  if (!instance) instance = new FpsTracker();
  return instance;
}

export function resetFpsTracker(): void {
  instance = null;
}
