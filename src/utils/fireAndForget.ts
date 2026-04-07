/**
 * Fire-and-Forget Async with Cleanup Registry
 *
 * Pattern: start async operations without blocking, but ensure they
 * complete before the process exits. Prevents lost writes to audit
 * logs, trade journals, or telemetry.
 *
 * Claude Code pattern: `void storePastedText(hash, content)` with a
 * cleanup registry that flushes pending I/O on exit.
 */

// ============================================================================
// Registry
// ============================================================================

const pending = new Set<Promise<unknown>>();
let shutdownHookInstalled = false;

function installShutdownHook(): void {
  if (shutdownHookInstalled) return;
  shutdownHookInstalled = true;

  const flush = () => {
    if (pending.size > 0) {
      // Give pending operations up to 5s to complete
      Promise.allSettled([...pending])
        .then(() => process.exit(0))
        .catch(() => process.exit(1));

      // Hard exit after 5s
      setTimeout(() => process.exit(0), 5000).unref();
    }
  };

  process.on("beforeExit", flush);
  process.on("SIGINT", flush);
  process.on("SIGTERM", flush);
}

// ============================================================================
// API
// ============================================================================

/**
 * Fire an async operation without awaiting it. The operation is tracked
 * and will be flushed on process exit.
 *
 * @param operation - Async function to run.
 * @param onError - Optional error handler (default: silent).
 */
export function fireAndForget<T>(
  operation: () => Promise<T>,
  onError?: (err: unknown) => void,
): void {
  installShutdownHook();

  const promise = operation()
    .catch((err) => {
      if (onError) onError(err);
      // Swallow — fire-and-forget means we don't propagate
    })
    .finally(() => {
      pending.delete(promise);
    });

  pending.add(promise);
}

/**
 * Wait for all pending fire-and-forget operations to complete.
 * Useful in tests or explicit flush points.
 */
export async function flushPending(): Promise<void> {
  await Promise.allSettled([...pending]);
}

/**
 * Number of pending operations.
 */
export function pendingCount(): number {
  return pending.size;
}

/**
 * Convenience: fire-and-forget a file write.
 */
export function fireAndForgetWrite(
  path: string,
  content: string,
): void {
  fireAndForget(async () => {
    const { writeFileSync, mkdirSync, existsSync } = await import("node:fs");
    const { dirname } = await import("node:path");
    const dir = dirname(path);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(path, content, { encoding: "utf-8", mode: 0o600 });
  });
}
