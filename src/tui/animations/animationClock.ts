/**
 * Global Animation Clock with Viewport Pause
 *
 * Claude Code pattern: shared global clock so all animations stay in sync.
 * Animations pause when the terminal is scrolled up (off-screen) or when
 * the app is backgrounded.
 *
 * Subscribers register a tick callback; the clock calls them at a fixed
 * interval. When paused, no ticks fire — saves CPU for background tabs.
 */

type TickCallback = (frame: number) => void;

interface Subscription {
  id: number;
  callback: TickCallback;
  intervalMs: number;
  lastTick: number;
}

class AnimationClock {
  private subscriptions = new Map<number, Subscription>();
  private nextId = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private frame = 0;
  private paused = false;
  private readonly baseIntervalMs = 100; // 10fps base clock

  /**
   * Subscribe to animation ticks.
   * @param callback - Called on each tick with the current frame number.
   * @param intervalMs - Desired interval between ticks. Default 100ms (10fps).
   * @returns Unsubscribe function.
   */
  subscribe(callback: TickCallback, intervalMs: number = 100): () => void {
    const id = this.nextId++;
    this.subscriptions.set(id, {
      id,
      callback,
      intervalMs: Math.max(this.baseIntervalMs, intervalMs),
      lastTick: Date.now(),
    });

    this.ensureRunning();

    return () => {
      this.subscriptions.delete(id);
      if (this.subscriptions.size === 0) this.stop();
    };
  }

  /**
   * Pause all animations (e.g., terminal scrolled up or backgrounded).
   */
  pause(): void {
    this.paused = true;
  }

  /**
   * Resume animations.
   */
  resume(): void {
    this.paused = false;
  }

  /**
   * Check if animations are paused.
   */
  isPaused(): boolean {
    return this.paused;
  }

  /**
   * Current frame number (monotonically increasing).
   */
  currentFrame(): number {
    return this.frame;
  }

  /**
   * Number of active subscribers.
   */
  get subscriberCount(): number {
    return this.subscriptions.size;
  }

  // ── Internal ──

  private ensureRunning(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick(), this.baseIntervalMs);
    // Prevent timer from keeping the process alive
    if (this.timer && typeof this.timer === "object" && "unref" in this.timer) {
      (this.timer as NodeJS.Timeout).unref();
    }
  }

  private stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private tick(): void {
    if (this.paused) return;

    this.frame++;
    const now = Date.now();

    for (const sub of this.subscriptions.values()) {
      if (now - sub.lastTick >= sub.intervalMs) {
        sub.lastTick = now;
        try {
          sub.callback(this.frame);
        } catch {
          // Subscriber errors don't crash the clock
        }
      }
    }
  }
}

// ── Singleton ──

let instance: AnimationClock | null = null;

export function getAnimationClock(): AnimationClock {
  if (!instance) instance = new AnimationClock();
  return instance;
}

export function resetAnimationClock(): void {
  instance = null;
}

export { AnimationClock };
