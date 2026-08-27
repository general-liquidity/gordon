/**
 * read_offloaded_result — the read side of the tool-result offload machinery.
 *
 * Two write sides exist and neither had a reader: `optimizeToolResultForContext`
 * (harness/runtimeHarness.ts) spills to `<tmpdir>/gordon-tool-results/<thread>/`
 * and returns a `scratchFile`, while `persistLargeResult`
 * (context/toolResultStorage.ts) spills to `<GORDON_DIR>/tool-results/` and
 * returns a `_spilledTo`. Both told the agent to recover the payload with a
 * `read_file` tool that is registered nowhere, so the digest/preview was the
 * only surviving representation of the result.
 *
 * This is deliberately NOT a general filesystem read. The path must resolve
 * inside one of the two offload roots after symlink resolution; anything else
 * is refused. It reads a character window so the recovered payload cannot
 * re-blow the context that the spill was there to protect.
 */

import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { GORDON_DIR } from "../../../storage/paths.ts";

/** Default characters returned per call. */
export const OFFLOAD_READ_DEFAULT_CHARS = 20_000;

/** Hard ceiling on a single read, whatever the caller asks for. */
export const OFFLOAD_READ_MAX_CHARS = 100_000;

/** The only directories this tool will read from. */
export function offloadRoots(): string[] {
  return [path.join(os.tmpdir(), "gordon-tool-results"), path.join(GORDON_DIR, "tool-results")];
}

/** Resolve symlinks where the path exists; fall back to the lexical path. */
function canonical(p: string): string {
  try {
    return realpathSync(p);
  } catch {
    return path.resolve(p);
  }
}

function isInside(child: string, parent: string): boolean {
  const rel = path.relative(parent, child);
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
}

export interface OffloadReadResult {
  ok: boolean;
  path: string;
  error?: string;
  totalChars?: number;
  startChar?: number;
  returnedChars?: number;
  truncated?: boolean;
  content?: string;
}

/** Pure core so the guard is testable without a Mastra runtime. */
export function readOffloadedResult(input: {
  path: string;
  startChar?: number;
  maxChars?: number;
}): OffloadReadResult {
  const requested = input.path;
  const resolved = canonical(requested);

  const roots = offloadRoots().map(canonical);
  if (!roots.some((root) => isInside(resolved, root))) {
    return {
      ok: false,
      path: requested,
      error:
        `Refused: ${requested} is outside the tool-result offload directories. ` +
        `This tool only reads spilled tool results (${offloadRoots().join(", ")}).`,
    };
  }

  if (!existsSync(resolved) || !statSync(resolved).isFile()) {
    return {
      ok: false,
      path: requested,
      error: `No offloaded result at ${requested}. Spilled results are transient — re-invoke the tool.`,
    };
  }

  const full = readFileSync(resolved, "utf-8");
  const startChar = Math.max(0, Math.min(input.startChar ?? 0, full.length));
  const maxChars = Math.min(
    Math.max(1, input.maxChars ?? OFFLOAD_READ_DEFAULT_CHARS),
    OFFLOAD_READ_MAX_CHARS,
  );
  const content = full.slice(startChar, startChar + maxChars);

  return {
    ok: true,
    path: requested,
    totalChars: full.length,
    startChar,
    returnedChars: content.length,
    truncated: startChar + content.length < full.length,
    content,
  };
}

export const readOffloadedResultTool = createTool({
  id: "read_offloaded_result",
  description: [
    "Read back the full payload of a tool result that was spilled to disk.",
    "When a tool result is too large for context, Gordon writes it to disk and",
    "leaves you a preview plus a path (`scratchFile`, `_spilledTo`, or the path",
    "named in a spill/trim marker). Pass that path here to recover the parts the",
    "preview dropped.",
    "",
    "Reads a character window, not the whole file: use `startChar` to page",
    "through a payload larger than `maxChars`. `truncated: true` means there is",
    "more after the window you got.",
    "",
    "This reads ONLY spilled tool results. It is not a filesystem read tool and",
    "will refuse any path outside the offload directories.",
  ].join("\n"),
  inputSchema: z.object({
    path: z.string().min(1).describe("The spill path handed to you (scratchFile / _spilledTo)."),
    startChar: z
      .number()
      .int()
      .min(0)
      .optional()
      .describe("Character offset to start reading from. Default 0."),
    maxChars: z
      .number()
      .int()
      .min(1)
      .max(OFFLOAD_READ_MAX_CHARS)
      .optional()
      .describe(`Characters to return. Default ${OFFLOAD_READ_DEFAULT_CHARS}.`),
  }),
  outputSchema: z.object({
    ok: z.boolean(),
    path: z.string(),
    error: z.string().optional(),
    totalChars: z.number().optional(),
    startChar: z.number().optional(),
    returnedChars: z.number().optional(),
    truncated: z.boolean().optional(),
    content: z.string().optional(),
  }),
  execute: async ({
    path: filePath,
    startChar,
    maxChars,
  }: {
    path: string;
    startChar?: number;
    maxChars?: number;
  }): Promise<OffloadReadResult> => {
    return readOffloadedResult({ path: filePath, startChar, maxChars });
  },
});

export const offloadedResultTools = {
  read_offloaded_result: readOffloadedResultTool,
};
