// ============================================================================
// Command Queue — Thread-safe priority queue for trading commands
//
// Priority: Interrupt (0) > High (1) > Normal (2) > Low (3)
// Emergency halt = Interrupt. User orders = Normal. Scheduled = Low.
// ============================================================================

export enum Priority {
  Interrupt = 0,
  High = 1,
  Normal = 2,
  Low = 3,
}

export interface QueuedCommand {
  id: string;
  priority: Priority;
  action: string;
  payload: any;
  createdAt: number;
}

type Subscriber = (queue: QueuedCommand[]) => void;

export class CommandQueue {
  private queue: QueuedCommand[] = [];
  private subscribers = new Set<Subscriber>();

  enqueue(command: QueuedCommand): void {
    // Insert at correct priority position
    const idx = this.queue.findIndex((c) => c.priority > command.priority);
    if (idx === -1) {
      this.queue.push(command);
    } else {
      this.queue.splice(idx, 0, command);
    }
    this.notify();
  }

  dequeue(): QueuedCommand | null {
    const item = this.queue.shift() ?? null;
    if (item) this.notify();
    return item;
  }

  peek(): QueuedCommand | null {
    return this.queue[0] ?? null;
  }

  size(): number {
    return this.queue.length;
  }

  clear(priority?: Priority): void {
    if (priority !== undefined) {
      this.queue = this.queue.filter((c) => c.priority !== priority);
    } else {
      this.queue = [];
    }
    this.notify();
  }

  getSnapshot(): QueuedCommand[] {
    return [...this.queue];
  }

  subscribe(callback: Subscriber): () => void {
    this.subscribers.add(callback);
    return () => this.subscribers.delete(callback);
  }

  private notify(): void {
    const snapshot = this.getSnapshot();
    for (const sub of this.subscribers) {
      sub(snapshot);
    }
  }
}

// Singleton
let instance: CommandQueue | null = null;

export function getCommandQueue(): CommandQueue {
  if (!instance) instance = new CommandQueue();
  return instance;
}
