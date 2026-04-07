/**
 * Paste Detection & Large Content Spilling
 *
 * Claude Code pattern: detects when user pastes large text (>10KB),
 * stores externally with hash reference. Small pastes inline, large
 * ones spilled to disk with preview.
 *
 * For Gordon: allows pasting bulk trade data, CSV exports, or large
 * JSON payloads without bloating the conversation context.
 */

import { existsSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { GORDON_DIR } from "../../infra/storage/paths.ts";

// ============================================================================
// Configuration
// ============================================================================

/** Threshold in characters for "large paste" detection. */
export const PASTE_THRESHOLD_CHARS = 10_000;

/** Characters to retain as inline preview for large pastes. */
export const PASTE_PREVIEW_CHARS = 500;

/** Minimum characters received in a single input event to consider it a paste. */
export const MIN_PASTE_DETECT_CHARS = 50;

const PASTE_DIR = join(GORDON_DIR, "pastes");

// ============================================================================
// Detection
// ============================================================================

/**
 * Heuristic: input is a paste if it arrives as a single chunk larger than
 * MIN_PASTE_DETECT_CHARS. Terminal emulators deliver typed input char-by-char
 * but pastes arrive as a single buffer.
 */
export function isProbablyPaste(input: string): boolean {
  return input.length >= MIN_PASTE_DETECT_CHARS;
}

/**
 * Check if a paste is "large" (should be spilled to disk).
 */
export function isLargePaste(input: string): boolean {
  return input.length >= PASTE_THRESHOLD_CHARS;
}

// ============================================================================
// Storage
// ============================================================================

function ensureDir(): void {
  if (!existsSync(PASTE_DIR)) mkdirSync(PASTE_DIR, { recursive: true });
}

async function hashContent(content: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(content);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 16); // 16-char hash for filenames
}

/**
 * Store a large paste to disk and return a reference.
 */
export async function spillPaste(content: string): Promise<PasteReference> {
  ensureDir();
  const hash = await hashContent(content);
  const filePath = join(PASTE_DIR, `paste_${hash}.txt`);
  const lineCount = content.split("\n").length;

  if (!existsSync(filePath)) {
    writeFileSync(filePath, content, { encoding: "utf-8", mode: 0o600 });
  }

  return {
    hash,
    filePath,
    originalSize: content.length,
    lineCount,
    preview: content.slice(0, PASTE_PREVIEW_CHARS),
  };
}

/**
 * Resolve a paste reference back to full content.
 */
export function resolvePaste(ref: PasteReference): string | null {
  if (!existsSync(ref.filePath)) return null;
  try {
    return readFileSync(ref.filePath, "utf-8");
  } catch {
    return null;
  }
}

/**
 * Build the inline replacement text for a spilled paste.
 */
export function buildPasteInlineContent(ref: PasteReference): string {
  const sizeKB = Math.round(ref.originalSize / 1024);
  return (
    `[Pasted content: ${sizeKB}KB, ${ref.lineCount} lines — stored at ${ref.filePath}]\n\n` +
    `Preview:\n${ref.preview}\n\n` +
    `[...${ref.lineCount - ref.preview.split("\n").length} more lines...]`
  );
}

// ============================================================================
// Types
// ============================================================================

export interface PasteReference {
  hash: string;
  filePath: string;
  originalSize: number;
  lineCount: number;
  preview: string;
}

/**
 * Process user input: detect paste, spill if large, return processed text.
 * Returns the original text for small inputs, or a spilled reference for large ones.
 */
export async function processInput(input: string): Promise<{
  text: string;
  wasPaste: boolean;
  wasSpilled: boolean;
  reference?: PasteReference;
}> {
  const wasPaste = isProbablyPaste(input);

  if (!wasPaste || !isLargePaste(input)) {
    return { text: input, wasPaste, wasSpilled: false };
  }

  const reference = await spillPaste(input);
  const text = buildPasteInlineContent(reference);
  return { text, wasPaste: true, wasSpilled: true, reference };
}
