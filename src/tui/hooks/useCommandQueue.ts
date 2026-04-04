import { useState, useEffect, useCallback } from "react";
import { getCommandQueue, Priority, type QueuedCommand } from "../services/commandQueue.js";

// ============================================================================
// useCommandQueue — React hook wrapping CommandQueue with state sync
// ============================================================================

export function useCommandQueue() {
  const queue = getCommandQueue();
  const [snapshot, setSnapshot] = useState<QueuedCommand[]>(queue.getSnapshot());

  useEffect(() => {
    return queue.subscribe(setSnapshot);
  }, [queue]);

  const enqueue = useCallback(
    (action: string, payload: any, priority = Priority.Normal) => {
      queue.enqueue({
        id: `cmd_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        priority,
        action,
        payload,
        createdAt: Date.now(),
      });
    },
    [queue],
  );

  return {
    queue: snapshot,
    enqueue,
    dequeue: () => queue.dequeue(),
    size: snapshot.length,
    pendingCount: snapshot.length,
  };
}

export { Priority };
