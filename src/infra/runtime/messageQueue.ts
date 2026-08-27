/**
 * Priority-based Message Queue
 *
 * When Gordon's agent loop is mid-run, new user input (CLI, gateway, cron,
 * heartbeat) enqueues here instead of blocking or being dropped. The agent
 * drains the queue between tool rounds, batching multiple messages into a
 * single follow-up turn.
 *
 * Priorities:
 *   "next"  — user typed input (pre-empts everything else)
 *   "later" — background/system signals (heartbeats, scheduled cron events)
 */

export type QueuePriority = "next" | "later";

export interface QueuedMessage {
  /** Message text / serialized payload */
  text: string;
  priority: QueuePriority;
  /** Date.now() at enqueue time */
  enqueuedAt: number;
  /** Where the message came from: "cli" | "gateway" | "cron:..." | "heartbeat" | "alert" */
  source?: string;
  /** Optional opaque metadata for downstream consumers */
  metadata?: Record<string, unknown>;
}

export type QueueSubscriber = () => void;

const PRIORITY_ORDER: Record<QueuePriority, number> = { next: 0, later: 1 };

export interface MessageQueue {
  enqueue(msg: QueuedMessage): void;
  dequeue(): QueuedMessage | undefined;
  dequeueAll(): QueuedMessage[];
  peek(): QueuedMessage | undefined;
  length(): number;
  isEmpty(): boolean;
  snapshot(): readonly QueuedMessage[];
  subscribe(listener: QueueSubscriber): () => void;
  clear(): void;
}

export function createMessageQueue(): MessageQueue {
  let items: QueuedMessage[] = [];
  let frozenSnapshot: readonly QueuedMessage[] = Object.freeze([]);
  const subscribers = new Set<QueueSubscriber>();

  function notify(): void {
    frozenSnapshot = Object.freeze([...items]);
    for (const fn of subscribers) fn();
  }

  function findBestIndex(): number {
    let bestIdx = 0;
    const best0 = items[0]!;
    let bestPrio = PRIORITY_ORDER[best0.priority];
    let bestTs = best0.enqueuedAt;
    for (let i = 1; i < items.length; i++) {
      const cur = items[i]!;
      const curPrio = PRIORITY_ORDER[cur.priority];
      if (curPrio < bestPrio || (curPrio === bestPrio && cur.enqueuedAt < bestTs)) {
        bestIdx = i;
        bestPrio = curPrio;
        bestTs = cur.enqueuedAt;
      }
    }
    return bestIdx;
  }

  return {
    enqueue(msg) {
      items.push(msg);
      notify();
    },
    dequeue() {
      if (items.length === 0) return undefined;
      const idx = findBestIndex();
      const [m] = items.splice(idx, 1);
      notify();
      return m;
    },
    dequeueAll() {
      if (items.length === 0) return [];
      const drained = items.sort(
        (a, b) =>
          PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority] || a.enqueuedAt - b.enqueuedAt,
      );
      items = [];
      notify();
      return drained;
    },
    peek() {
      if (items.length === 0) return undefined;
      return items[findBestIndex()];
    },
    length() {
      return items.length;
    },
    isEmpty() {
      return items.length === 0;
    },
    snapshot() {
      return frozenSnapshot;
    },
    subscribe(listener) {
      subscribers.add(listener);
      return () => {
        subscribers.delete(listener);
      };
    },
    clear() {
      items = [];
      notify();
    },
  };
}

/** Shared default queue for the single-process CLI. */
export const defaultMessageQueue: MessageQueue = createMessageQueue();
