/**
 * Database Backup and Recovery System
 *
 * Provides automated daily backups, retention policies, and recovery capabilities.
 * Backups are stored in ~/.gordon/backups/ directory.
 */

import { mkdir, readdir, stat, unlink, copyFile } from "node:fs/promises";
import { join, basename } from "node:path";
import { createModuleLogger } from "../logger/index.ts";
import { DB_PATH, closeDatabase, initDatabase } from "./database.ts";
import { GORDON_DIR } from "./paths.ts";

const logger = createModuleLogger("backup");
const BACKUPS_DIR = join(GORDON_DIR, "backups");

/**
 * Backup retention policy configuration
 */
export interface RetentionPolicy {
  /** Number of days to keep backups (default: 7) */
  retentionDays: number;
  /** Maximum number of backups to keep regardless of age (default: 30) */
  maxBackups: number;
  /** Minimum number of backups to always keep (default: 3) */
  minBackups: number;
}

const DEFAULT_RETENTION_POLICY: RetentionPolicy = {
  retentionDays: 7,
  maxBackups: 30,
  minBackups: 3,
};

/**
 * Backup metadata
 */
export interface BackupInfo {
  /** Full path to backup file */
  path: string;
  /** Backup filename */
  filename: string;
  /** Backup creation date */
  date: Date;
  /** Backup file size in bytes */
  sizeBytes: number;
  /** Backup type (manual or auto) */
  type: "manual" | "auto";
}

/**
 * Ensures the backups directory exists
 */
async function ensureBackupsDir(): Promise<void> {
  await mkdir(BACKUPS_DIR, { recursive: true });
}

/**
 * Generate backup filename with timestamp
 */
function generateBackupFilename(type: "manual" | "auto"): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `gordon-${type}-${timestamp}.db`;
}

/**
 * Parse backup filename to extract info
 */
function parseBackupFilename(filename: string): { date: Date; type: "manual" | "auto" } | null {
  // Format: gordon-{type}-{timestamp}.db
  const match = filename.match(/^gordon-(manual|auto)-(.+)\.db$/);
  if (!match) return null;

  const type = match[1] as "manual" | "auto";
  const matchedTimestamp = match[2];
  if (!matchedTimestamp) return null;
  const timestampStr = matchedTimestamp.replace(/-/g, (_, index) => {
    // Convert back to ISO format: first 2 dashes stay, rest become colons or dots
    if (index < 10) return "-";
    if (index === 13 || index === 16) return ":";
    if (index === 19) return ".";
    return "-";
  });

  // Try to parse the date
  try {
    const date = new Date(timestampStr);
    if (isNaN(date.getTime())) {
      // Fallback: use file stats
      return { date: new Date(), type };
    }
    return { date, type };
  } catch {
    return { date: new Date(), type };
  }
}

/**
 * Create a backup of the current database
 *
 * @param type - Backup type (manual or auto)
 * @returns Backup info or null if backup failed
 */
export async function backupDatabase(type: "manual" | "auto" = "manual"): Promise<BackupInfo | null> {
  try {
    // Check if database exists
    const dbFile = Bun.file(DB_PATH);
    const dbExists = await dbFile.exists();

    if (!dbExists) {
      logger.warn("Database does not exist, nothing to backup");
      return null;
    }

    await ensureBackupsDir();

    const filename = generateBackupFilename(type);
    const backupPath = join(BACKUPS_DIR, filename);

    // Copy database file
    await copyFile(DB_PATH, backupPath);

    // Get backup file stats
    const stats = await stat(backupPath);

    const backupInfo: BackupInfo = {
      path: backupPath,
      filename,
      date: new Date(),
      sizeBytes: stats.size,
      type,
    };

    logger.info("Database backup created", {
      filename,
      sizeBytes: stats.size,
      type,
    });

    return backupInfo;
  } catch (error) {
    logger.error(
      "Failed to create database backup",
      error instanceof Error ? error : undefined
    );
    return null;
  }
}

/**
 * List all available database backups
 *
 * @returns Array of backup info sorted by date (newest first)
 */
export async function listBackups(): Promise<BackupInfo[]> {
  try {
    await ensureBackupsDir();

    const files = await readdir(BACKUPS_DIR);
    const backups: BackupInfo[] = [];

    for (const file of files) {
      if (!file.startsWith("gordon-") || !file.endsWith(".db")) {
        continue;
      }

      const filePath = join(BACKUPS_DIR, file);

      try {
        const stats = await stat(filePath);
        const parsed = parseBackupFilename(file);

        backups.push({
          path: filePath,
          filename: file,
          date: parsed?.date || stats.mtime,
          sizeBytes: stats.size,
          type: parsed?.type || "manual",
        });
      } catch {
        // Skip files we can't stat
        continue;
      }
    }

    // Sort by date, newest first
    return backups.sort((a, b) => b.date.getTime() - a.date.getTime());
  } catch (error) {
    logger.error(
      "Failed to list backups",
      error instanceof Error ? error : undefined
    );
    return [];
  }
}

/**
 * Get the most recent backup
 */
export async function getLatestBackup(): Promise<BackupInfo | null> {
  const backups = await listBackups();
  return backups[0] ?? null;
}

/**
 * Restore database from a backup
 *
 * @param backupPath - Path to the backup file to restore
 * @param createBackupFirst - Whether to backup current database before restore (default: true)
 */
export async function restoreDatabase(
  backupPath: string,
  createBackupFirst: boolean = true
): Promise<void> {
  // Verify backup exists
  const backupFile = Bun.file(backupPath);
  const backupExists = await backupFile.exists();

  if (!backupExists) {
    throw new Error(`Backup file not found: ${backupPath}`);
  }

  logger.info("Starting database restore", { from: basename(backupPath) });

  // Close current database connection
  closeDatabase();

  // Backup current database before restore
  if (createBackupFirst) {
    const dbFile = Bun.file(DB_PATH);
    const dbExists = await dbFile.exists();

    if (dbExists) {
      const preRestoreBackup = join(
        BACKUPS_DIR,
        `gordon-pre-restore-${new Date().toISOString().replace(/[:.]/g, "-")}.db`
      );
      await ensureBackupsDir();
      await copyFile(DB_PATH, preRestoreBackup);
      logger.info("Created pre-restore backup", { path: basename(preRestoreBackup) });
    }
  }

  // Restore the backup
  await copyFile(backupPath, DB_PATH);

  // Re-initialize database connection
  initDatabase();

  logger.info("Database restored successfully", { from: basename(backupPath) });
}

/**
 * Restore from the most recent backup
 */
export async function restoreLatestBackup(): Promise<void> {
  const latest = await getLatestBackup();

  if (!latest) {
    throw new Error("No backups available to restore");
  }

  await restoreDatabase(latest.path);
}

/**
 * Delete a specific backup
 *
 * @param backupPath - Path to the backup file to delete
 */
export async function deleteBackup(backupPath: string): Promise<void> {
  try {
    await unlink(backupPath);
    logger.info("Backup deleted", { path: basename(backupPath) });
  } catch (error) {
    logger.error(
      "Failed to delete backup",
      error instanceof Error ? error : undefined,
      { path: backupPath }
    );
    throw error;
  }
}

/**
 * Prune old backups according to retention policy
 *
 * @param policy - Retention policy configuration
 * @returns Number of backups deleted
 */
export async function pruneOldBackups(
  policy: Partial<RetentionPolicy> = {}
): Promise<number> {
  const config = { ...DEFAULT_RETENTION_POLICY, ...policy };
  const backups = await listBackups();

  if (backups.length <= config.minBackups) {
    logger.debug("Backup count at or below minimum, no pruning needed", {
      count: backups.length,
      minBackups: config.minBackups,
    });
    return 0;
  }

  const now = new Date();
  const cutoffDate = new Date(now.getTime() - config.retentionDays * 24 * 60 * 60 * 1000);

  const toDelete: BackupInfo[] = [];

  for (let i = 0; i < backups.length; i++) {
    const backup = backups[i];

    // Always keep minimum number of backups
    if (backups.length - toDelete.length <= config.minBackups) {
      break;
    }

    // Check if we're over max backups
    const isOverMax = backups.length - toDelete.length > config.maxBackups;

    // Check if backup is older than retention period
    const isExpired = backup && backup.date < cutoffDate;

    // Delete if over max OR expired (but respect minBackups)
    if (backup && (isOverMax || isExpired)) {
      // Skip the most recent backups even if expired
      if (i < config.minBackups) {
        continue;
      }
      toDelete.push(backup);
    }
  }

  // Delete the identified backups
  let deleted = 0;
  for (const backupToDelete of toDelete) {
    try {
      await unlink(backupToDelete.path);
      deleted++;
      logger.debug("Pruned old backup", {
        filename: backupToDelete.filename,
        age: Math.floor((now.getTime() - backupToDelete.date.getTime()) / (24 * 60 * 60 * 1000)),
      });
    } catch (error) {
      logger.warn("Failed to prune backup", {
        path: backupToDelete.path,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (deleted > 0) {
    logger.info("Pruned old backups", {
      deleted,
      remaining: backups.length - deleted,
      policy: config,
    });
  }

  return deleted;
}

/**
 * Check if a daily backup is needed
 * Returns true if no backup was created today
 */
export async function needsDailyBackup(): Promise<boolean> {
  const backups = await listBackups();

  if (backups.length === 0) {
    return true;
  }

  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  // Check if any backup was created today
  for (const backup of backups) {
    const backupDate = new Date(
      backup.date.getFullYear(),
      backup.date.getMonth(),
      backup.date.getDate()
    );

    if (backupDate.getTime() === today.getTime()) {
      return false;
    }
  }

  return true;
}

/**
 * Perform daily backup if needed
 * This should be called on application startup or periodically
 *
 * @returns Backup info if backup was created, null otherwise
 */
export async function performDailyBackupIfNeeded(): Promise<BackupInfo | null> {
  const needsBackup = await needsDailyBackup();

  if (!needsBackup) {
    logger.debug("Daily backup not needed, already backed up today");
    return null;
  }

  logger.info("Performing daily backup");
  const backup = await backupDatabase("auto");

  if (backup) {
    // Prune old backups after successful daily backup
    await pruneOldBackups();
  }

  return backup;
}

/**
 * Get backup statistics
 */
export async function getBackupStats(): Promise<{
  totalBackups: number;
  totalSizeBytes: number;
  oldestBackup: Date | null;
  newestBackup: Date | null;
  autoBackups: number;
  manualBackups: number;
}> {
  const backups = await listBackups();

  if (backups.length === 0) {
    return {
      totalBackups: 0,
      totalSizeBytes: 0,
      oldestBackup: null,
      newestBackup: null,
      autoBackups: 0,
      manualBackups: 0,
    };
  }

  const totalSizeBytes = backups.reduce((sum, b) => sum + b.sizeBytes, 0);
  const autoBackups = backups.filter((b) => b.type === "auto").length;
  const manualBackups = backups.filter((b) => b.type === "manual").length;

  const oldestBackup = backups[backups.length - 1];
  const newestBackup = backups[0];

  return {
    totalBackups: backups.length,
    totalSizeBytes,
    oldestBackup: oldestBackup?.date ?? new Date(),
    newestBackup: newestBackup?.date ?? new Date(),
    autoBackups,
    manualBackups,
  };
}

/**
 * Verify backup integrity by attempting to open it
 *
 * @param backupPath - Path to backup file to verify
 * @returns True if backup is valid SQLite database
 */
export async function verifyBackup(backupPath: string): Promise<boolean> {
  try {
    const { Database } = await import("bun:sqlite");
    const db = new Database(backupPath, { readonly: true });

    // Try to query the tables
    const tables = db.query("SELECT name FROM sqlite_master WHERE type='table'").all();

    db.close();

    // Check for expected tables
    const tableNames = tables.map((t) => (t as { name: string }).name);
    const expectedTables = ["plans", "trades", "events"];
    const hasExpectedTables = expectedTables.every((t) => tableNames.includes(t));

    if (!hasExpectedTables) {
      logger.warn("Backup missing expected tables", {
        path: basename(backupPath),
        found: tableNames,
        expected: expectedTables,
      });
      return false;
    }

    return true;
  } catch (error) {
    logger.error(
      "Backup verification failed",
      error instanceof Error ? error : undefined,
      { path: backupPath }
    );
    return false;
  }
}

/**
 * Export backup directory path for external use
 */
export const BACKUP_DIR = BACKUPS_DIR;
