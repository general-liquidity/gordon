/**
 * Deprecation Warnings
 * Shows deprecation notices for features being phased out.
 * Each warning is shown at most once per session.
 */

const shownWarnings = new Set<string>();

/**
 * Show a deprecation warning (once per session per key).
 *
 * @param key - Unique key to deduplicate warnings
 * @param message - The deprecation message
 * @param alternative - What to use instead
 */
export function deprecationWarning(key: string, message: string, alternative?: string): void {
  if (shownWarnings.has(key)) return;
  shownWarnings.add(key);

  let output = `[deprecated] ${message}`;
  if (alternative) {
    output += ` Use ${alternative} instead.`;
  }

  console.error(output);
}

/**
 * Reset shown warnings (for testing).
 */
export function resetDeprecationWarnings(): void {
  shownWarnings.clear();
}
