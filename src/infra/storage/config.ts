import { mkdir, readdir } from "node:fs/promises";
import { join } from "node:path";
import { GordonConfigSchema, type GordonConfig } from "../../types/index.ts";
import { GORDON_DIR } from "./paths.ts";
export const CONFIG_PATH = join(GORDON_DIR, "config.json");
export const PROFILES_DIR = join(GORDON_DIR, "profiles");
export const WORKSPACE_CONFIG_PATH = join(process.cwd(), ".gordonrc");

export type ConfigScope = "global" | "profile" | "workspace";

export interface ConfigLayers {
  activeProfile: string | null;
  sources: ConfigScope[];
  globalPath: string;
  workspacePath: string;
  profilePath: string | null;
}

export interface ResolvedConfigResult {
  config: GordonConfig;
  layers: ConfigLayers;
}

export interface SaveResolvedConfigOptions {
  profileName?: string | null;
}

interface WorkspaceConfigPayload {
  profile?: string | null;
  overrides: Record<string, unknown>;
}

/**
 * Ensures the ~/.gordon directory exists
 */
async function ensureGordonDir(): Promise<void> {
  await mkdir(GORDON_DIR, { recursive: true });
}

async function ensureProfilesDir(): Promise<void> {
  await mkdir(PROFILES_DIR, { recursive: true });
}

/**
 * Returns a default GordonConfig
 */
function getDefaultConfig(): GordonConfig {
  return GordonConfigSchema.parse({});
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function mergeConfigRecords(
  base: Record<string, unknown>,
  override: Record<string, unknown>,
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...base };

  for (const [key, value] of Object.entries(override)) {
    if (value === undefined) {
      continue;
    }

    const existing = merged[key];
    if (isRecord(existing) && isRecord(value)) {
      merged[key] = mergeConfigRecords(existing, value);
      continue;
    }

    merged[key] = value;
  }

  return merged;
}

export function normalizeWorkspaceConfigPayload(raw: unknown): WorkspaceConfigPayload | null {
  if (!isRecord(raw)) {
    return null;
  }

  const explicitOverrides = isRecord(raw.overrides)
    ? raw.overrides
    : isRecord(raw.config)
      ? raw.config
      : null;

  if (explicitOverrides) {
    return {
      profile: typeof raw.profile === "string" && raw.profile.trim().length > 0
        ? raw.profile.trim()
        : null,
      overrides: explicitOverrides,
    };
  }

  const { profile, ...rest } = raw;
  return {
    profile: typeof profile === "string" && profile.trim().length > 0 ? profile.trim() : null,
    overrides: rest,
  };
}

export function getResolvedConfigWriteScope(layers: ConfigLayers): ConfigScope {
  if (layers.sources.includes("workspace")) {
    return "workspace";
  }

  if (layers.activeProfile) {
    return "profile";
  }

  return "global";
}

function getProfilePath(profileName: string): string {
  return join(PROFILES_DIR, `${profileName}.json`);
}

async function loadRawConfigFile(path: string): Promise<Record<string, unknown> | null> {
  const file = Bun.file(path);
  if (!(await file.exists())) {
    return null;
  }

  const content = await file.text();
  const parsed = JSON.parse(content);
  if (!isRecord(parsed)) {
    throw new Error(`Expected config object in ${path}`);
  }

  return parsed;
}

/**
 * Loads the Gordon config from ~/.gordon/config.json
 * If the file doesn't exist, creates a default config.
 * Merges per-project .gordonrc overrides if present in CWD.
 */
export async function loadConfig(): Promise<GordonConfig> {
  const resolved = await loadConfigBundle();
  return resolved.config;
}

/**
 * Load per-project .gordonrc overrides from CWD.
 * Returns partial config or null if no file found.
 */
async function loadProjectConfig(): Promise<WorkspaceConfigPayload | null> {
  try {
    const parsed = await loadRawConfigFile(WORKSPACE_CONFIG_PATH);
    return parsed ? normalizeWorkspaceConfigPayload(parsed) : null;
  } catch (err) {
    console.warn(`[config] Failed to parse .gordonrc: ${err instanceof Error ? err.message : err}`);
    return null;
  }
}

async function loadProfileConfig(profileName: string | null): Promise<Record<string, unknown> | null> {
  if (!profileName) {
    return null;
  }

  try {
    return await loadRawConfigFile(getProfilePath(profileName));
  } catch (err) {
    console.warn(`[config] Failed to parse profile "${profileName}": ${err instanceof Error ? err.message : err}`);
    return null;
  }
}

export async function loadConfigBundle(): Promise<ResolvedConfigResult> {
  await ensureGordonDir();

  const globalFile = Bun.file(CONFIG_PATH);
  const globalExists = await globalFile.exists();

  let globalConfig: GordonConfig;
  if (!globalExists) {
    globalConfig = getDefaultConfig();
    await saveConfig(globalConfig);
  } else {
    try {
      const content = await globalFile.text();
      const parsed = JSON.parse(content);
      globalConfig = GordonConfigSchema.parse(parsed);
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new Error(`Invalid JSON in config file: ${CONFIG_PATH}`);
      }
      throw error;
    }
  }

  const workspaceConfig = await loadProjectConfig();
  const activeProfile = (
    process.env.GORDON_PROFILE
    || workspaceConfig?.profile
    || globalConfig.activeProfile
    || null
  )?.trim() || null;

  const profileOverrides = await loadProfileConfig(activeProfile);
  const mergedWithProfile = profileOverrides
    ? mergeConfigRecords(globalConfig as Record<string, unknown>, profileOverrides)
    : (globalConfig as Record<string, unknown>);
  const merged = workspaceConfig?.overrides
    ? mergeConfigRecords(mergedWithProfile, workspaceConfig.overrides)
    : mergedWithProfile;

  const config = GordonConfigSchema.parse({
    ...merged,
    activeProfile: activeProfile ?? undefined,
  });

  const layers: ConfigLayers = {
    activeProfile,
    sources: [
      "global",
      ...(profileOverrides ? ["profile" as const] : []),
      ...(workspaceConfig?.overrides && Object.keys(workspaceConfig.overrides).length > 0
        ? ["workspace" as const]
        : []),
    ],
    globalPath: CONFIG_PATH,
    workspacePath: WORKSPACE_CONFIG_PATH,
    profilePath: activeProfile ? getProfilePath(activeProfile) : null,
  };

  return { config, layers };
}

export async function listTradingProfiles(): Promise<string[]> {
  await ensureProfilesDir();
  const entries = await readdir(PROFILES_DIR, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => entry.name.replace(/\.json$/u, ""))
    .sort((left, right) => left.localeCompare(right));
}

/**
 * Saves the Gordon config to ~/.gordon/config.json
 */
export async function saveConfig(
  config: GordonConfig,
  scope: ConfigScope = "global",
  options?: { profileName?: string | null },
): Promise<void> {
  await ensureGordonDir();
  await ensureProfilesDir();

  // Validate before saving
  const validated = GordonConfigSchema.parse(config);

  if (scope === "workspace") {
    const payload = {
      profile: options?.profileName ?? validated.activeProfile ?? null,
      overrides: validated,
    };
    await Bun.write(WORKSPACE_CONFIG_PATH, JSON.stringify(payload, null, 2));
    return;
  }

  if (scope === "profile") {
    const profileName = options?.profileName ?? validated.activeProfile;
    if (!profileName) {
      throw new Error("A profile name is required when saving profile-scoped config");
    }
    await Bun.write(getProfilePath(profileName), JSON.stringify(validated, null, 2));
    return;
  }

  await Bun.write(CONFIG_PATH, JSON.stringify(validated, null, 2));
}

export async function saveResolvedConfig(
  config: GordonConfig,
  layers: ConfigLayers,
  options?: SaveResolvedConfigOptions,
): Promise<void> {
  await saveConfig(
    config,
    getResolvedConfigWriteScope(layers),
    { profileName: options?.profileName ?? layers.activeProfile },
  );
}
