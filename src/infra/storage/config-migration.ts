/**
 * Config Migration System
 *
 * Handles automatic migration of config files between versions.
 * Backs up old configs before migration and supports incremental migrations.
 */

import { mkdir, copyFile, readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join, basename } from "node:path";
import { createModuleLogger } from "../logger/index.ts";

const logger = createModuleLogger("config-migration");

const GORDON_DIR = join(homedir(), ".gordon");
const CONFIG_PATH = join(GORDON_DIR, "config.json");
const BACKUPS_DIR = join(GORDON_DIR, "config-backups");

/**
 * Config version type - semantic versioning
 */
export type ConfigVersion = string;

/**
 * Migration function type
 */
export type MigrationFn = (config: Record<string, unknown>) => Record<string, unknown>;

/**
 * Migration definition
 */
export interface Migration {
  fromVersion: ConfigVersion;
  toVersion: ConfigVersion;
  migrate: MigrationFn;
  description: string;
}

/**
 * Current config version (should match GordonConfigSchema default)
 */
export const CURRENT_CONFIG_VERSION = "1.0.0";

/**
 * Registry of all migrations
 */
const migrations: Migration[] = [
  // Example migration: v1.0.0 -> v1.1.0
  // {
  //   fromVersion: "1.0.0",
  //   toVersion: "1.1.0",
  //   description: "Add new preference fields",
  //   migrate: (config) => ({
  //     ...config,
  //     version: "1.1.0",
  //     preferences: {
  //       ...(config.preferences as Record<string, unknown>),
  //       newField: "defaultValue",
  //     },
  //   }),
  // },

  // Migration: Add version field to legacy configs (pre-versioning)
  {
    fromVersion: "0.0.0",
    toVersion: "1.0.0",
    description: "Add version field to legacy config",
    migrate: (config) => ({
      ...config,
      version: "1.0.0",
    }),
  },

  // Future migrations will be added here:
  // v1.0.0 -> v1.1.0
  // v1.1.0 -> v1.2.0
  // etc.
];

/**
 * Compare semantic versions
 * Returns: -1 if a < b, 0 if a === b, 1 if a > b
 */
function compareVersions(a: ConfigVersion, b: ConfigVersion): number {
  const partsA = a.split(".").map(Number);
  const partsB = b.split(".").map(Number);

  for (let i = 0; i < Math.max(partsA.length, partsB.length); i++) {
    const numA = partsA[i] || 0;
    const numB = partsB[i] || 0;

    if (numA < numB) return -1;
    if (numA > numB) return 1;
  }

  return 0;
}

/**
 * Get config version from config object
 */
function getConfigVersion(config: Record<string, unknown>): ConfigVersion {
  if (typeof config.version === "string") {
    return config.version;
  }
  // Legacy configs without version field
  return "0.0.0";
}

/**
 * Find migration path from source version to target version
 */
function findMigrationPath(
  fromVersion: ConfigVersion,
  toVersion: ConfigVersion
): Migration[] {
  const path: Migration[] = [];
  let currentVersion = fromVersion;

  while (compareVersions(currentVersion, toVersion) < 0) {
    const nextMigration = migrations.find(
      (m) => m.fromVersion === currentVersion
    );

    if (!nextMigration) {
      // No direct migration, try to find any migration from current version
      const availableMigrations = migrations.filter(
        (m) =>
          compareVersions(m.fromVersion, currentVersion) >= 0 &&
          compareVersions(m.toVersion, toVersion) <= 0
      );

      if (availableMigrations.length === 0) {
        logger.warn("No migration path found", {
          from: currentVersion,
          to: toVersion,
        });
        break;
      }

      // Sort by fromVersion and take the first applicable
      availableMigrations.sort((a, b) =>
        compareVersions(a.fromVersion, b.fromVersion)
      );
      const migration = availableMigrations[0];
      if (!migration) break;
      path.push(migration);
      currentVersion = migration.toVersion;
    } else {
      path.push(nextMigration);
      currentVersion = nextMigration.toVersion;
    }
  }

  return path;
}

/**
 * Ensures the config backups directory exists
 */
async function ensureBackupsDir(): Promise<void> {
  await mkdir(BACKUPS_DIR, { recursive: true });
}

/**
 * Create a backup of the current config file
 */
export async function backupConfig(): Promise<string | null> {
  try {
    const configFile = Bun.file(CONFIG_PATH);
    const exists = await configFile.exists();

    if (!exists) {
      return null;
    }

    await ensureBackupsDir();

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const backupPath = join(BACKUPS_DIR, `config-${timestamp}.json`);

    await copyFile(CONFIG_PATH, backupPath);
    logger.info("Config backup created", { path: backupPath });

    return backupPath;
  } catch (error) {
    logger.error(
      "Failed to backup config",
      error instanceof Error ? error : undefined
    );
    return null;
  }
}

/**
 * List available config backups
 */
export async function listConfigBackups(): Promise<
  Array<{ path: string; date: Date; size: number }>
> {
  try {
    await ensureBackupsDir();

    const files = await readdir(BACKUPS_DIR);
    const backups: Array<{ path: string; date: Date; size: number }> = [];

    for (const file of files) {
      if (file.startsWith("config-") && file.endsWith(".json")) {
        const filePath = join(BACKUPS_DIR, file);
        const stats = await stat(filePath);
        backups.push({
          path: filePath,
          date: stats.mtime,
          size: stats.size,
        });
      }
    }

    // Sort by date, newest first
    return backups.sort((a, b) => b.date.getTime() - a.date.getTime());
  } catch {
    return [];
  }
}

/**
 * Restore config from a backup file
 */
export async function restoreConfigFromBackup(backupPath: string): Promise<void> {
  const backupFile = Bun.file(backupPath);
  const exists = await backupFile.exists();

  if (!exists) {
    throw new Error(`Backup file not found: ${backupPath}`);
  }

  // Backup current config before restoring
  await backupConfig();

  await copyFile(backupPath, CONFIG_PATH);
  logger.info("Config restored from backup", { from: backupPath });
}

/**
 * Prune old config backups, keeping only the specified number of recent backups
 */
export async function pruneConfigBackups(keepCount: number = 10): Promise<number> {
  const backups = await listConfigBackups();

  if (backups.length <= keepCount) {
    return 0;
  }

  const toDelete = backups.slice(keepCount);
  let deleted = 0;

  for (const backup of toDelete) {
    try {
      await Bun.write(backup.path, ""); // Clear file
      const { unlink } = await import("node:fs/promises");
      await unlink(backup.path);
      deleted++;
    } catch (error) {
      logger.warn("Failed to delete backup", {
        path: backup.path,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (deleted > 0) {
    logger.info("Pruned old config backups", { deleted });
  }

  return deleted;
}

/**
 * Check if config needs migration
 */
export function needsMigration(config: Record<string, unknown>): boolean {
  const currentVersion = getConfigVersion(config);
  return compareVersions(currentVersion, CURRENT_CONFIG_VERSION) < 0;
}

/**
 * Migrate config to the current version
 * Returns the migrated config or null if no migration was needed
 */
export async function migrateConfig(
  config: Record<string, unknown>
): Promise<Record<string, unknown> | null> {
  const fromVersion = getConfigVersion(config);

  if (!needsMigration(config)) {
    logger.debug("Config is up to date", { version: fromVersion });
    return null;
  }

  logger.info("Starting config migration", {
    from: fromVersion,
    to: CURRENT_CONFIG_VERSION,
  });

  // Backup before migration
  const backupPath = await backupConfig();
  if (backupPath) {
    logger.info("Created backup before migration", { path: basename(backupPath) });
  }

  // Find and execute migration path
  const migrationPath = findMigrationPath(fromVersion, CURRENT_CONFIG_VERSION);

  if (migrationPath.length === 0) {
    logger.warn("No migration path found, adding version field only");
    return {
      ...config,
      version: CURRENT_CONFIG_VERSION,
    };
  }

  let migratedConfig = { ...config };

  for (const migration of migrationPath) {
    logger.info("Applying migration", {
      from: migration.fromVersion,
      to: migration.toVersion,
      description: migration.description,
    });

    try {
      migratedConfig = migration.migrate(migratedConfig);
    } catch (error) {
      logger.error(
        "Migration failed",
        error instanceof Error ? error : undefined,
        {
          migration: `${migration.fromVersion} -> ${migration.toVersion}`,
        }
      );
      throw new Error(
        `Migration from ${migration.fromVersion} to ${migration.toVersion} failed: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  logger.info("Config migration completed", {
    from: fromVersion,
    to: CURRENT_CONFIG_VERSION,
    migrationsApplied: migrationPath.length,
  });

  // Prune old backups
  await pruneConfigBackups(10);

  return migratedConfig;
}

/**
 * Register a new migration
 * Useful for plugins or extensions that need to add migrations
 */
export function registerMigration(migration: Migration): void {
  // Check for duplicate
  const existing = migrations.find(
    (m) =>
      m.fromVersion === migration.fromVersion &&
      m.toVersion === migration.toVersion
  );

  if (existing) {
    logger.warn("Migration already registered", {
      from: migration.fromVersion,
      to: migration.toVersion,
    });
    return;
  }

  migrations.push(migration);
  logger.debug("Migration registered", {
    from: migration.fromVersion,
    to: migration.toVersion,
    description: migration.description,
  });
}

/**
 * Get all registered migrations
 */
export function getRegisteredMigrations(): readonly Migration[] {
  return [...migrations];
}

/**
 * Get migration info for a config
 */
export function getMigrationInfo(config: Record<string, unknown>): {
  currentVersion: ConfigVersion;
  targetVersion: ConfigVersion;
  needsMigration: boolean;
  migrationPath: Array<{ from: ConfigVersion; to: ConfigVersion; description: string }>;
} {
  const currentVersion = getConfigVersion(config);
  const migrationPath = findMigrationPath(currentVersion, CURRENT_CONFIG_VERSION);

  return {
    currentVersion,
    targetVersion: CURRENT_CONFIG_VERSION,
    needsMigration: needsMigration(config),
    migrationPath: migrationPath.map((m) => ({
      from: m.fromVersion,
      to: m.toVersion,
      description: m.description,
    })),
  };
}
