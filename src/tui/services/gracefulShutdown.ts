// ============================================================================
// Graceful Shutdown — Clean exit with state persistence
//
// Registers process exit handlers. Runs cleanup callbacks in order.
// 5-second timeout: force exit if cleanup takes too long.
// ============================================================================

type CleanupFn = () => void | Promise<void>;

const cleanupHandlers: CleanupFn[] = [];
let shuttingDown = false;

export function onShutdown(callback: CleanupFn): void {
  cleanupHandlers.push(callback);
}

async function performShutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;

  // Force exit timeout
  const timeout = setTimeout(() => {
    process.exit(1);
  }, 5000);

  try {
    for (const handler of cleanupHandlers) {
      try {
        await handler();
      } catch {
        // Continue cleanup even if individual handler fails
      }
    }
  } finally {
    clearTimeout(timeout);
    process.exit(0);
  }
}

export function registerShutdownHandlers(): void {
  process.on("SIGINT", () => performShutdown("SIGINT"));
  process.on("SIGTERM", () => performShutdown("SIGTERM"));
  process.on("exit", () => {
    if (!shuttingDown) {
      for (const handler of cleanupHandlers) {
        try {
          const result = handler();
          if (result instanceof Promise) {
            // Can't await in exit handler, but try
          }
        } catch {
          // Best effort
        }
      }
    }
  });
}
