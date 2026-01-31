// Configuration management
export { CONFIG_PATH, loadConfig, saveConfig } from "./config.ts";

// Config migration
export {
  CURRENT_CONFIG_VERSION,
  migrateConfig,
  needsMigration,
  backupConfig as backupConfigFile,
  listConfigBackups,
  restoreConfigFromBackup,
  pruneConfigBackups,
  registerMigration,
  getRegisteredMigrations,
  getMigrationInfo,
  type ConfigVersion,
  type Migration,
  type MigrationFn,
} from "./config-migration.ts";

// Environment file management
export {
  ENV_FILE_PATH,
  loadEnvFile,
  checkEnvStatus,
  saveEnvKeys,
  createEnvFile,
  type EnvKeys,
  type EnvStatus,
} from "./env.ts";

// Database management
export {
  DB_PATH,
  initDatabase,
  getDatabase,
  closeDatabase,
  // Transactions
  withTransaction,
  isInTransaction,
  getTransactionDepth,
  createPlanAndTradeInTransaction,
  type TransactionOptions,
  // Query logging
  getQueryStats,
  resetQueryStats,
  getAverageQueryTime,
  executeWithLogging,
} from "./database.ts";

// Database backup and recovery
export {
  BACKUP_DIR,
  backupDatabase,
  restoreDatabase,
  restoreLatestBackup,
  listBackups,
  getLatestBackup,
  deleteBackup,
  pruneOldBackups,
  needsDailyBackup,
  performDailyBackupIfNeeded,
  getBackupStats,
  verifyBackup,
  type BackupInfo,
  type RetentionPolicy,
} from "./backup.ts";

// Plan CRUD operations
export { createPlan, getPlan, updatePlan, listPlans } from "./plans.ts";

// Trade CRUD operations
export { createTrade, getTrade, updateTrade, listTrades } from "./trades.ts";

// Event logging
export { logEvent, getEvents } from "./events.ts";

// Chat history persistence
export {
  saveChatSession,
  loadChatSession,
  loadLatestSession,
  listChatSessions,
  deleteChatSession,
  cleanupOldSessions,
  searchChatHistory,
  getChatHistoryStats,
  exportChatHistory,
  type ChatHistoryMessage,
  type ChatSession,
  type ChatSessionSummary,
} from "./chat-history.ts";
