import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { GordonConfigSchema, type GordonConfig } from "../../types/index.ts";
import { GORDON_DIR } from "./paths.ts";
export const CONFIG_PATH = join(GORDON_DIR, "config.json");

/**
 * Ensures the ~/.gordon directory exists
 */
async function ensureGordonDir(): Promise<void> {
  await mkdir(GORDON_DIR, { recursive: true });
}

/**
 * Returns a default GordonConfig
 */
function getDefaultConfig(): GordonConfig {
  return GordonConfigSchema.parse({});
}

/**
 * Loads the Gordon config from ~/.gordon/config.json
 * If the file doesn't exist, creates a default config.
 * Merges per-project .gordonrc overrides if present in CWD.
 */
export async function loadConfig(): Promise<GordonConfig> {
  await ensureGordonDir();

  const file = Bun.file(CONFIG_PATH);
  const exists = await file.exists();

  let config: GordonConfig;

  if (!exists) {
    config = getDefaultConfig();
    await saveConfig(config);
  } else {
    try {
      const content = await file.text();
      const parsed = JSON.parse(content);
      config = GordonConfigSchema.parse(parsed);
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new Error(`Invalid JSON in config file: ${CONFIG_PATH}`);
      }
      throw error;
    }
  }

  // Merge per-project .gordonrc if it exists
  const projectOverrides = await loadProjectConfig();
  if (projectOverrides) {
    config = GordonConfigSchema.parse({ ...config, ...projectOverrides });
  }

  return config;
}

/**
 * Load per-project .gordonrc overrides from CWD.
 * Returns partial config or null if no file found.
 */
async function loadProjectConfig(): Promise<Record<string, unknown> | null> {
  try {
    const rcPath = join(process.cwd(), ".gordonrc");
    const rcFile = Bun.file(rcPath);
    if (!(await rcFile.exists())) return null;

    const content = await rcFile.text();
    return JSON.parse(content);
  } catch (err) {
    console.warn(`[config] Failed to parse .gordonrc: ${err instanceof Error ? err.message : err}`);
    return null;
  }
}

/**
 * Saves the Gordon config to ~/.gordon/config.json
 */
export async function saveConfig(config: GordonConfig): Promise<void> {
  await ensureGordonDir();

  // Validate before saving
  const validated = GordonConfigSchema.parse(config);

  await Bun.write(CONFIG_PATH, JSON.stringify(validated, null, 2));
}
