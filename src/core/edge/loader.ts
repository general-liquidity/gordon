/**
 * Load EDGE.md specs from disk.
 *
 * Scans the builtin dir (core/edge/builtin/*.edge.md) plus any caller-supplied
 * extra dirs (e.g. an infra-resolved ~/.gordon/edges). Kept pure of infra: the
 * caller passes the user-edge path in, so core does not import up into infra for
 * GORDON_DIR. Later dirs override earlier ones by edge name (workspace > builtin).
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { parseEdgeSpec } from "./parser.ts";
import type { EdgeSpec } from "./types.ts";

const BUILTIN_DIR = join(import.meta.dirname ?? __dirname, "builtin");

const EDGE_SUFFIX = ".edge.md";

function loadDir(dir: string): EdgeSpec[] {
  if (!existsSync(dir)) return [];
  let entries: string[];
  try {
    if (!statSync(dir).isDirectory()) return [];
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  const specs: EdgeSpec[] = [];
  for (const entry of entries) {
    if (!entry.endsWith(EDGE_SUFFIX)) continue;
    try {
      specs.push(parseEdgeSpec(readFileSync(join(dir, entry), "utf8")));
    } catch {
      // A single malformed edge file must not break the scan.
    }
  }
  return specs;
}

/**
 * Load every EDGE.md spec from the builtin dir and any extra dirs. Dedupes by
 * `name`; a later dir's edge overrides an earlier one (so a user edge can shadow
 * a builtin of the same name).
 */
export function loadEdgeSpecs(extraDirs: string[] = []): EdgeSpec[] {
  const byName = new Map<string, EdgeSpec>();
  for (const dir of [BUILTIN_DIR, ...extraDirs]) {
    for (const spec of loadDir(dir)) byName.set(spec.name, spec);
  }
  return [...byName.values()];
}

/** Convenience: only the edges currently in force (status === "live"). */
export function loadLiveEdges(extraDirs: string[] = []): EdgeSpec[] {
  return loadEdgeSpecs(extraDirs).filter((e) => e.status === "live");
}
