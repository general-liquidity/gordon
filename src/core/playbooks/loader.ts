/**
 * Playbook Loader
 *
 * Discovers and loads playbooks from the filesystem:
 * - Built-in playbooks from src/core/playbooks/builtin/
 * - User playbooks from ~/.gordon/playbooks/
 * - Workspace playbooks from a given directory
 */

import { readdir, stat, mkdir, watch as fsWatch } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createModuleLogger } from "../../infra/logger/logger.ts";
import { GORDON_DIR } from "../../infra/storage/paths.ts";
import type { PlaybookParser } from "./parser.ts";
import type { PlaybookRegistry } from "./registry.ts";
import type { Playbook } from "./types.ts";

const log = createModuleLogger("playbook-loader");

// ============================================================================
// Constants
// ============================================================================

/** Directory containing built-in playbooks (relative to this file) */
const BUILTIN_DIR = join(import.meta.dirname ?? __dirname, "builtin");

/** User playbook directory — honors GORDON_HOME / XDG_CONFIG_HOME */
const USER_PLAYBOOK_DIR = join(GORDON_DIR, "playbooks");

// ============================================================================
// PlaybookLoader Class
// ============================================================================

/**
 * Loader that discovers and loads Playbook Markdown files.
 */
export class PlaybookLoader {
  private parser: PlaybookParser;
  private registry: PlaybookRegistry;
  private watchers: AbortController[] = [];

  constructor(parser: PlaybookParser, registry: PlaybookRegistry) {
    this.parser = parser;
    this.registry = registry;
  }

  /**
   * Load built-in playbooks from the builtin/ directory.
   *
   * @returns Number of playbooks loaded
   */
  async loadBuiltins(): Promise<number> {
    return this.loadFromDirectory(BUILTIN_DIR, "builtin");
  }

  /**
   * Load user playbooks from ~/.gordon/playbooks/.
   * Creates the directory if it does not exist.
   *
   * @returns Number of playbooks loaded
   */
  async loadUserPlaybooks(): Promise<number> {
    // Ensure the directory exists
    try {
      await mkdir(USER_PLAYBOOK_DIR, { recursive: true });
    } catch {
      // Ignore if already exists or permissions issue
    }

    return this.loadFromDirectory(USER_PLAYBOOK_DIR, "workspace");
  }

  /**
   * Load all playbook .md files from a directory.
   *
   * @param dir - Absolute path to directory
   * @param source - Playbook source label
   * @returns Number of playbooks loaded
   */
  async loadFromDirectory(
    dir: string,
    source: "builtin" | "workspace" | "hub" = "workspace",
  ): Promise<number> {
    const absDir = resolve(dir);
    let count = 0;

    try {
      const dirStat = await stat(absDir);
      if (!dirStat.isDirectory()) {
        log.warn(`Not a directory: ${absDir}`);
        return 0;
      }
    } catch {
      log.debug(`Directory does not exist: ${absDir}`);
      return 0;
    }

    let entries: string[];
    try {
      entries = await readdir(absDir);
    } catch (err) {
      log.warn(`Could not read directory ${absDir}: ${err}`);
      return 0;
    }

    for (const entry of entries) {
      if (!entry.endsWith(".md")) continue;

      const filePath = join(absDir, entry);
      try {
        const playbook = await this.loadFile(filePath, source);
        if (playbook) count++;
      } catch (err) {
        log.warn(`Failed to load playbook ${filePath}: ${err}`);
      }
    }

    log.debug(`Loaded ${count} playbooks from ${absDir}`);
    return count;
  }

  /**
   * Load a single playbook file and register it.
   *
   * @param path - Path to the .md file
   * @param source - Playbook source label
   * @returns The loaded Playbook, or null if validation fails
   */
  async loadFile(
    path: string,
    source: "builtin" | "workspace" | "hub" = "workspace",
  ): Promise<Playbook | null> {
    const playbook = await this.parser.parseFile(path, source);
    const validation = this.parser.validate(playbook);

    if (!validation.valid) {
      log.warn(`Playbook ${path} has validation errors: ${validation.errors.join("; ")}`);
      return null;
    }

    if (validation.warnings.length > 0) {
      log.debug(`Playbook ${playbook.id} warnings: ${validation.warnings.join("; ")}`);
    }

    // Register (replace if already exists to support reload)
    if (this.registry.has(playbook.id)) {
      this.registry.replace(playbook);
    } else {
      this.registry.register(playbook);
    }

    return playbook;
  }

  /**
   * Watch a directory for playbook changes and automatically reload.
   * Uses the AbortController pattern so watchers can be stopped via dispose().
   *
   * @param dir - Directory to watch
   */
  watch(dir: string): void {
    const absDir = resolve(dir);
    const controller = new AbortController();
    this.watchers.push(controller);

    (async () => {
      try {
        const watcher = fsWatch(absDir, {
          signal: controller.signal,
          recursive: false,
        });

        for await (const event of watcher) {
          if (
            event.filename?.endsWith(".md") &&
            (event.eventType === "change" || event.eventType === "rename")
          ) {
            const filePath = join(absDir, event.filename);
            try {
              const s = await stat(filePath);
              if (s.isFile()) {
                log.debug(`Reloading playbook: ${filePath}`);
                await this.loadFile(filePath, "workspace");
              }
            } catch {
              // File may have been deleted; ignore
            }
          }
        }
      } catch (err: unknown) {
        if (err instanceof Error && err.name === "AbortError") {
          return; // Expected when dispose() is called
        }
        log.warn(`Watch error on ${absDir}: ${err}`);
      }
    })();

    log.debug(`Watching directory for playbook changes: ${absDir}`);
  }

  /**
   * Stop all file watchers.
   */
  dispose(): void {
    for (const controller of this.watchers) {
      controller.abort();
    }
    this.watchers = [];
  }
}
