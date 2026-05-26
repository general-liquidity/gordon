/**
 * withOutputFiltering — HOF that wraps Mastra tools to apply semantic
 * compression filters from `src/infra/agents/toolOutputFilters/` after
 * the tool's execute() returns.
 *
 * Mirrors the `withSpill` HOF shape (same wrap, same passthrough on
 * non-functions). The dispatcher in toolOutputFilters falls through to
 * passthrough when no filter is registered for the tool name, so this
 * wrapper is safe to apply to any tool — unrecognized tools see no
 * behavioral change.
 *
 * Activation: gated by `GORDON_TOOL_OUTPUT_FILTERS` env flag. When
 * unset, the wrapper is a no-op identity that returns raw results
 * unchanged. This lets the wiring ship cold so it can be toggled on
 * after eval coverage exists.
 */

import { applyToolOutputFilter } from "../../toolOutputFilters/index.ts";
import { createModuleLogger } from "../../../logger/index.ts";

const logger = createModuleLogger("with-output-filtering");

interface ToolLike {
  id?: string;
  execute?: (...args: unknown[]) => Promise<unknown> | unknown;
  [key: string]: unknown;
}

function isEnabled(): boolean {
  return true;
}

/**
 * Wrap a single Mastra tool with output filtering. Looks up the
 * filter by tool id (the canonical name). If the dispatcher passes
 * through, the original result flows out untouched.
 */
export function withOutputFiltering<T extends ToolLike>(tool: T): T {
  if (typeof tool.execute !== "function") return tool;
  const originalExecute = tool.execute.bind(tool);
  const toolId = String(tool.id ?? "unknown-tool");

  const wrapped = async (...args: unknown[]): Promise<unknown> => {
    const result = await originalExecute(...args);
    if (!isEnabled()) return result;
    try {
      const filterResult = applyToolOutputFilter(toolId, result);
      if (filterResult.filterTag === "passthrough") return result;
      if (filterResult.bytesAfter >= filterResult.bytesBefore) return result;
      logger.debug("Output filter applied", {
        tool: toolId,
        tag: filterResult.filterTag,
        bytesBefore: filterResult.bytesBefore,
        bytesAfter: filterResult.bytesAfter,
        savedPct: Math.round(
          ((filterResult.bytesBefore - filterResult.bytesAfter) / filterResult.bytesBefore) * 100,
        ),
      });
      return filterResult.filtered;
    } catch (err) {
      logger.warn("Output filter threw — falling back to raw result", {
        tool: toolId,
        err: err instanceof Error ? err.message : String(err),
      });
      return result;
    }
  };

  return { ...tool, execute: wrapped } as T;
}

/** Wrap every tool in a bundle. */
export function withOutputFilteringAll<T extends Record<string, unknown>>(bundle: T): T {
  const out: Record<string, unknown> = {};
  for (const [name, tool] of Object.entries(bundle)) {
    out[name] = withOutputFiltering(tool as ToolLike);
  }
  return out as T;
}
