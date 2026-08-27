// ============================================================================
// Config Migrations — Ordered schema migrations for version upgrades
//
// Each migration transforms the config object. Tracks applied migrations
// to avoid re-running. Runs in order by ID.
// ============================================================================

export interface Migration {
  id: string;
  description: string;
  migrate: (config: Record<string, any>) => Record<string, any>;
}

export interface MigrationResult {
  applied: string[];
  skipped: string[];
  errors: string[];
}

const MIGRATIONS: Migration[] = [
  {
    id: "001_add_theme",
    description: "Add theme field with dark default",
    migrate: (config) => {
      if (!config.theme) {
        config.theme = "dark";
      }
      return config;
    },
  },
  {
    id: "002_add_keybindings",
    description: "Add keybindings field",
    migrate: (config) => {
      if (!config.keybindings) {
        config.keybindings = {};
      }
      return config;
    },
  },
  {
    id: "003_rename_armed_to_permission",
    description: "Migrate legacy ARMED/SAFE/DISARMED to permissionMode",
    migrate: (config) => {
      if (config.mode === "ARMED") {
        config.permissionMode = "auto";
      } else if (config.mode === "SAFE" || config.mode === "DISARMED") {
        config.permissionMode = "ask";
      }
      delete config.mode;
      delete config.armedUntil;
      return config;
    },
  },
  {
    id: "004_add_effort_level",
    description: "Add effort level setting",
    migrate: (config) => {
      if (!config.effortLevel) {
        config.effortLevel = "high";
      }
      return config;
    },
  },
  {
    id: "005_add_output_style",
    description: "Add output style setting",
    migrate: (config) => {
      if (!config.outputStyle) {
        config.outputStyle = "default";
      }
      return config;
    },
  },
  {
    id: "006_add_reduce_motion",
    description: "Add accessibility reduce motion setting",
    migrate: (config) => {
      if (config.reduceMotion === undefined) {
        config.reduceMotion = false;
      }
      return config;
    },
  },
];

export function runMigrations(config: Record<string, any>): {
  config: Record<string, any>;
  result: MigrationResult;
} {
  const applied: string[] = config.appliedMigrations ?? [];
  const result: MigrationResult = { applied: [], skipped: [], errors: [] };
  let current = { ...config };

  for (const migration of MIGRATIONS) {
    if (applied.includes(migration.id)) {
      result.skipped.push(migration.id);
      continue;
    }

    try {
      current = migration.migrate(current);
      result.applied.push(migration.id);
      applied.push(migration.id);
    } catch (err) {
      result.errors.push(`${migration.id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  current.appliedMigrations = applied;
  return { config: current, result };
}

export function getMigrationCount(): number {
  return MIGRATIONS.length;
}
