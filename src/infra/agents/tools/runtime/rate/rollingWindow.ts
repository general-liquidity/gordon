/**
 * Rolling-window tool output capping.
 *
 * When a tool produces a large payload (venue orderbook dumps, raw ccxt
 * trade history, onchain logs, etc.), feeding the full text back into the
 * LLM eats the context budget. Instead, cap the payload at a configurable
 * size, preserve HEAD and TAIL windows (the only parts an LLM usually needs
 * to reason), and spill the full output to a temp file so the agent can
 * point follow-up tools at it if needed.
 *
 * Inspired by pi-mono's bash-output rolling window + `fullOutputPath` metadata
 * pattern, adapted for Gordon's market/account/order payloads which are
 * noisier than bash output.
 */

import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";

export interface CappedOutput {
  /** The (possibly truncated) text the LLM sees */
  output: string;
  /** Whether the output was truncated */
  truncated: boolean;
  /** Total characters in the original payload */
  originalChars: number;
  /** Characters elided from the middle */
  elidedChars: number;
  /** Path to the full payload on disk, if overflow was spilled */
  fullOutputPath?: string;
}

export interface RollingWindowOptions {
  /** Maximum total chars the LLM should see. Default 8000. */
  maxChars?: number;
  /**
   * Fraction of `maxChars` to allocate to the HEAD window. Tail gets the
   * remainder (minus the elision marker). Default 0.5 (balanced).
   */
  headFraction?: number;
  /**
   * Whether to spill the full payload to a temp file. Default true.
   * Disable for secrets / content you don't want on disk.
   */
  spillToDisk?: boolean;
  /** Optional label used in the temp filename for easier debugging. */
  label?: string;
}

const DEFAULT_MAX = 8000;
const DEFAULT_HEAD_FRACTION = 0.5;
/** Subdirectory under `os.tmpdir()` where spilled tool payloads land. */
export const GORDON_ARTIFACTS_SUBDIR = "gordon-artifacts";

/**
 * Cap a string output with a rolling window. Preserves head + tail,
 * elides the middle. Optionally spills overflow to a temp file.
 *
 * Usage inside a tool:
 *   const capped = await capWithRollingWindow(rawPayload, { label: "orderbook" });
 *   return {
 *     summary: capped.output,
 *     truncated: capped.truncated,
 *     fullOutputPath: capped.fullOutputPath,
 *   };
 */
export async function capWithRollingWindow(
  content: string,
  options: RollingWindowOptions = {},
): Promise<CappedOutput> {
  const maxChars = options.maxChars ?? DEFAULT_MAX;
  const headFraction = options.headFraction ?? DEFAULT_HEAD_FRACTION;
  const originalChars = content.length;

  if (originalChars <= maxChars) {
    return {
      output: content,
      truncated: false,
      originalChars,
      elidedChars: 0,
    };
  }

  const elisionLabel = "…";
  const marker = `\n\n[${elisionLabel} {ELIDED} chars elided {PATH_HINT} {ELISION_LABEL}]\n\n`;
  const markerOverhead = marker.length + 40; // rough; refined below
  const budget = Math.max(200, maxChars - markerOverhead);
  const headSize = Math.floor(budget * headFraction);
  const tailSize = Math.max(100, budget - headSize);

  const head = content.slice(0, headSize);
  const tail = content.slice(content.length - tailSize);
  const elidedChars = originalChars - headSize - tailSize;

  let fullOutputPath: string | undefined;
  if (options.spillToDisk !== false) {
    try {
      fullOutputPath = await spillToTempFile(content, options.label);
    } catch {
      // Spilling is best-effort — a temp-dir write failure should not
      // prevent the agent from receiving the capped output.
      fullOutputPath = undefined;
    }
  }

  const pathHint = fullOutputPath ? `· full: ${fullOutputPath}` : "";
  const finalMarker = `\n\n[${elisionLabel} ${elidedChars.toLocaleString()} chars elided ${pathHint} ${elisionLabel}]\n\n`;

  return {
    output: `${head}${finalMarker}${tail}`,
    truncated: true,
    originalChars,
    elidedChars,
    fullOutputPath,
  };
}

/**
 * Cap a JSON-serializable object. Caps the pretty-printed form; if the
 * object is small enough, serialization is returned as-is with truncated=false.
 */
export async function capJsonWithRollingWindow(
  value: unknown,
  options: RollingWindowOptions = {},
): Promise<CappedOutput> {
  const pretty = JSON.stringify(value, null, 2);
  return capWithRollingWindow(pretty, options);
}

async function spillToTempFile(content: string, label?: string): Promise<string> {
  const hash = createHash("sha1").update(content).digest("hex").slice(0, 10);
  const safeLabel = (label ?? "gordon-tool").replace(/[^a-z0-9-]/gi, "-").slice(0, 40);
  const filename = `${safeLabel}-${hash}.txt`;
  const spillDir = join(tmpdir(), GORDON_ARTIFACTS_SUBDIR);
  await fs.mkdir(spillDir, { recursive: true });
  const target = join(spillDir, filename);
  await fs.writeFile(target, content, "utf8");
  return target;
}
