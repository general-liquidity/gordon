import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { GordonConfigSchema, type GordonConfig } from "../../types/index.ts";

const GORDON_DIR = join(homedir(), ".gordon");
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
 * If the file doesn't exist, creates a default config
 */
export async function loadConfig(): Promise<GordonConfig> {
  await ensureGordonDir();

  const file = Bun.file(CONFIG_PATH);
  const exists = await file.exists();

  if (!exists) {
    const defaultConfig = getDefaultConfig();
    await saveConfig(defaultConfig);
    return defaultConfig;
  }

  try {
    const content = await file.text();
    const parsed = JSON.parse(content);
    return GordonConfigSchema.parse(parsed);
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(`Invalid JSON in config file: ${CONFIG_PATH}`);
    }
    throw error;
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
