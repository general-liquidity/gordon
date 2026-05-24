/**
 * FW7 — Subagent Profile Loader (file discovery).
 *
 * Reads operator-authored `.json` files from `.claude/subagents/` at
 * project root and at user home, validates each against the
 * `SubagentProfileSchema`, and returns a deduplicated registry keyed
 * by profile name.
 *
 * Precedence: project-level wins over user-level (same convention as
 * `.claude/settings.json` via FW5b). Conflicts emit a warning and the
 * user entry is dropped.
 *
 * Discovery contract:
 *   - Each `.json` file in the subagents directory is treated as one
 *     profile. The file basename (without `.json`) MUST match the
 *     profile's `name` field — mismatch is an error and the file is
 *     skipped.
 *   - Non-`.json` files are ignored.
 *   - Missing directories: silently no-op (operator may not have any
 *     custom profiles).
 *   - Malformed JSON: skipped with a warning per file.
 *   - Schema validation failure: skipped with per-field warnings.
 *
 * Pure-ish: file reads are real, but the function accepts an
 * `options.sources` override (for tests) and an `options.fileContent`
 * map for deterministic in-memory profile loading.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, basename, extname } from "node:path";
import {
  validateSubagentProfile,
  type SubagentProfile,
  type SubagentProfileValidationIssue,
} from "./subagentProfile.ts";

export interface SubagentSourceDir {
  /** Resolved absolute path to the subagents directory. */
  path: string;
  /** Origin label for provenance + precedence. */
  origin: "project" | "user";
}

export interface LoadSubagentProfilesOptions {
  /** Project root. Default: process.cwd(). */
  projectRoot?: string;
  /** User home directory. Default: homedir(). */
  userHome?: string;
  /**
   * Override the source directories (used by tests). When supplied, the
   * function reads these paths instead of the conventional ones.
   */
  sources?: ReadonlyArray<SubagentSourceDir>;
  /**
   * Optional in-memory file content map for deterministic tests. Keys
   * are absolute paths; values are the file content. When a path
   * matches a key the in-memory content wins over disk.
   */
  fileContent?: ReadonlyMap<string, string>;
  /**
   * Optional in-memory directory listing override. Keys are absolute
   * directory paths; values are the entries that would be returned by
   * `readdirSync`. When supplied for a given directory, disk reads are
   * skipped for that directory.
   */
  directoryListing?: ReadonlyMap<string, ReadonlyArray<string>>;
}

export interface LoadedSubagentProfilesResult {
  /** Profiles keyed by name, with conflicts resolved. */
  profiles: Map<string, SubagentProfile>;
  /** Loading warnings (malformed files, conflicts, validation issues). */
  warnings: string[];
  /** Per-source-directory breakdown. */
  sources: Array<{
    path: string;
    origin: "project" | "user";
    found: boolean;
    fileCount: number;
    accepted: number;
    rejected: number;
  }>;
  /** Total accepted across all sources after conflict resolution. */
  totalAccepted: number;
  /** Total rejected (validation failures + dropped-on-conflict). */
  totalRejected: number;
}

function defaultSources(projectRoot: string, userHome: string): SubagentSourceDir[] {
  return [
    { path: join(projectRoot, ".claude", "subagents"), origin: "project" },
    { path: join(userHome, ".claude", "subagents"), origin: "user" },
  ];
}

function listJsonFiles(
  dir: string,
  override: ReadonlyMap<string, ReadonlyArray<string>> | undefined,
): string[] {
  if (override?.has(dir)) {
    return [...(override.get(dir) ?? [])].filter((e) => extname(e) === ".json");
  }
  if (!existsSync(dir)) return [];
  try {
    return readdirSync(dir)
      .filter((entry) => extname(entry) === ".json")
      .filter((entry) => {
        try {
          return statSync(join(dir, entry)).isFile();
        } catch {
          return false;
        }
      });
  } catch {
    return [];
  }
}

function readFile(
  path: string,
  override: ReadonlyMap<string, string> | undefined,
): { content?: string; error?: string } {
  if (override?.has(path)) {
    return { content: override.get(path) };
  }
  try {
    return { content: readFileSync(path, "utf8") };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

function formatIssues(issues: ReadonlyArray<SubagentProfileValidationIssue>): string {
  return issues.map((i) => `${i.field}: ${i.message}`).join("; ");
}

/**
 * Discover and load all operator-authored subagent profiles from
 * `.claude/subagents/` at project + user level. Project profiles win
 * on conflict; conflicts are warned but never error.
 */
export function loadSubagentProfiles(
  options: LoadSubagentProfilesOptions = {},
): LoadedSubagentProfilesResult {
  const projectRoot = options.projectRoot ?? process.cwd();
  const userHome = options.userHome ?? homedir();
  const sources = options.sources ?? defaultSources(projectRoot, userHome);

  const warnings: string[] = [];
  const profiles = new Map<string, SubagentProfile>();
  const perSource: LoadedSubagentProfilesResult["sources"] = [];
  let totalAccepted = 0;
  let totalRejected = 0;

  // Sort: project first so its entries win on conflict.
  const sorted = [...sources].sort((a, b) =>
    a.origin === b.origin ? 0 : a.origin === "project" ? -1 : 1,
  );

  for (const source of sorted) {
    const entry = {
      path: source.path,
      origin: source.origin,
      found: false,
      fileCount: 0,
      accepted: 0,
      rejected: 0,
    };

    const dirExists =
      options.directoryListing?.has(source.path) === true || existsSync(source.path);
    if (!dirExists) {
      perSource.push(entry);
      continue;
    }
    entry.found = true;

    const files = listJsonFiles(source.path, options.directoryListing);
    entry.fileCount = files.length;

    for (const file of files) {
      const fullPath = join(source.path, file);
      const expectedName = basename(file, ".json");

      const read = readFile(fullPath, options.fileContent);
      if (read.error) {
        warnings.push(
          `Could not read ${fullPath} (${source.origin}): ${read.error}`,
        );
        entry.rejected++;
        totalRejected++;
        continue;
      }

      let parsedJson: unknown;
      try {
        parsedJson = JSON.parse(read.content ?? "");
      } catch (err) {
        warnings.push(
          `Malformed JSON in ${fullPath} (${source.origin}): ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
        entry.rejected++;
        totalRejected++;
        continue;
      }

      const validation = validateSubagentProfile(parsedJson, { expectedName });
      if (!validation.profile) {
        warnings.push(
          `Invalid profile ${fullPath} (${source.origin}): ${formatIssues(validation.issues)}`,
        );
        entry.rejected++;
        totalRejected++;
        continue;
      }

      // Emit non-blocking warnings.
      const warnIssues = validation.issues.filter((i) => i.severity === "warning");
      for (const w of warnIssues) {
        warnings.push(`${fullPath} (${source.origin}): ${w.field}: ${w.message}`);
      }

      const existing = profiles.get(validation.profile.name);
      if (existing) {
        warnings.push(
          `${fullPath} (${source.origin}): profile '${validation.profile.name}' dropped — already defined by an earlier source.`,
        );
        entry.rejected++;
        totalRejected++;
        continue;
      }

      profiles.set(validation.profile.name, validation.profile);
      entry.accepted++;
      totalAccepted++;
    }

    perSource.push(entry);
  }

  return {
    profiles,
    warnings,
    sources: perSource,
    totalAccepted,
    totalRejected,
  };
}

/**
 * One-line summary for operator-facing log output.
 */
export function summarizeLoadedSubagentProfiles(
  result: LoadedSubagentProfilesResult,
): string {
  const sourcesFound = result.sources.filter((s) => s.found).length;
  const totalSources = result.sources.length;
  const parts = [
    `${result.totalAccepted} profile${result.totalAccepted === 1 ? "" : "s"}`,
  ];
  if (result.totalRejected > 0) parts.push(`${result.totalRejected} dropped`);
  if (result.warnings.length > 0) {
    parts.push(
      `${result.warnings.length} warning${result.warnings.length === 1 ? "" : "s"}`,
    );
  }
  return `subagent profiles loaded from ${sourcesFound}/${totalSources} sources: ${parts.join(", ")}.`;
}
