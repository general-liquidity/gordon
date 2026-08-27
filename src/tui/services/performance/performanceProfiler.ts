// ============================================================================
// Performance Profiler — Track startup time, query latency, and TTFT
//
// Track startup time, query latency (TTFT), and operation durations
// for monitoring and optimization.
// ============================================================================

export interface PerfMetrics {
  startupMs: number;
  ttftMs: number; // time to first token
  avgQueryMs: number;
  totalQueries: number;
  coldStart: boolean;
}

export class PerformanceProfiler {
  private startTime = Date.now();
  private startupDuration: number | null = null;
  private queryTimes: number[] = [];
  private firstTokenTime: number | null = null;
  private currentQueryStart: number | null = null;
  private coldStart = true;

  markStartupComplete(): void {
    this.startupDuration = Date.now() - this.startTime;
  }

  markQueryStart(): () => void {
    const start = Date.now();
    this.currentQueryStart = start;
    return () => {
      const duration = Date.now() - start;
      this.queryTimes.push(duration);
      this.currentQueryStart = null;
      // After first query completes, subsequent starts are warm
      this.coldStart = false;
    };
  }

  markFirstToken(): void {
    if (this.currentQueryStart !== null) {
      this.firstTokenTime = Date.now() - this.currentQueryStart;
    }
  }

  getMetrics(): PerfMetrics {
    const totalQueries = this.queryTimes.length;
    const avgQueryMs =
      totalQueries > 0 ? this.queryTimes.reduce((a, b) => a + b, 0) / totalQueries : 0;

    return {
      startupMs: this.startupDuration ?? Date.now() - this.startTime,
      ttftMs: this.firstTokenTime ?? 0,
      avgQueryMs: Math.round(avgQueryMs),
      totalQueries,
      coldStart: this.coldStart,
    };
  }

  reset(): void {
    this.startTime = Date.now();
    this.startupDuration = null;
    this.queryTimes = [];
    this.firstTokenTime = null;
    this.currentQueryStart = null;
    this.coldStart = true;
  }
}

let instance: PerformanceProfiler | null = null;

export function getProfiler(): PerformanceProfiler {
  if (!instance) instance = new PerformanceProfiler();
  return instance;
}
