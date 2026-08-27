/**
 * Rendering Optimization Layer
 *
 * Additive wrappers on top of stock Ink that give ~80% of Claude Code's
 * custom Ink fork performance without actually forking.
 *
 * - LineDiffRenderer: only write changed lines to stdout
 * - StringWidthCache: memoize width calculations (4096 LRU)
 * - StyleCache: intern ANSI style strings (zero-alloc after warmup)
 * - SyncOutput: BSU/ESU atomic terminal painting
 */

export {
  installLineDiffRenderer,
  resetLineDiffCache,
  getLineDiffStats,
} from "./LineDiffRenderer.js";
export { cachedStringWidth, clearStringWidthCache } from "./StringWidthCache.js";
export { getCachedStyle, getCachedTransition, clearStyleCaches } from "./StyleCache.js";
export { beginSync, endSync, writeSynchronized } from "../utils/syncOutput.js";
