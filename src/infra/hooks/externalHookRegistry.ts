/**
 * Production installer for operator-defined external lifecycle hooks.
 *
 * Enabling GORDON_EXTERNAL_HOOK_RUNNER is intentionally fail-closed: a missing,
 * unreadable, or invalid config aborts process startup instead of advertising a
 * policy plane that dispatches nothing.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { getGordonDir } from "../storage/paths.ts";
import { registerHook } from "./engine.ts";
import {
  EXTERNAL_HOOK_RUNNER_FLAG_ENV,
  isExternalHookRunnerEnabled,
  resolveHandlerPath,
  runExternalHook,
  type ExternalHookConfig,
} from "./externalHookRunner.ts";
import { HOOK_POINTS, type HookDefinition, type HookPoint } from "./types.ts";
import { flagEnv } from "../config/flagResolver.ts";

export const EXTERNAL_HOOKS_PATH_ENV = "GORDON_EXTERNAL_HOOKS_PATH";
export const DEFAULT_EXTERNAL_HOOKS_FILENAME = "hooks.json";

const SUPPORTED_HOOK_POINTS: ReadonlySet<string> = new Set(HOOK_POINTS);

export interface ExternalHookInstallerState {
  installed: boolean;
  configPath: string | null;
  hookCount: number;
  error: string | null;
}

interface ExternalHookFileEntry extends ExternalHookConfig {
  priority?: number;
  toolFilter?: string;
  asyncRewake?: boolean;
  statusMessage?: string;
}

let state: ExternalHookInstallerState = {
  installed: false,
  configPath: null,
  hookCount: 0,
  error: null,
};
let unregisterInstalled: Array<() => void> = [];

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function optionalString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new Error(`${key} must be a string`);
  return value;
}

function parseEntry(value: unknown, index: number): ExternalHookFileEntry {
  const record = asRecord(value, `hooks[${index}]`);
  const id = optionalString(record, "id");
  const point = optionalString(record, "point");
  const handlerPath = optionalString(record, "handlerPath");
  if (!id?.trim()) throw new Error(`hooks[${index}].id must be a non-empty string`);
  if (!point || !SUPPORTED_HOOK_POINTS.has(point)) {
    throw new Error(`hooks[${index}].point is not a supported lifecycle point`);
  }
  if (!handlerPath?.trim()) {
    throw new Error(`hooks[${index}].handlerPath must be a non-empty string`);
  }

  const args = record.args;
  if (args !== undefined && (!Array.isArray(args) || args.some((arg) => typeof arg !== "string"))) {
    throw new Error(`hooks[${index}].args must be an array of strings`);
  }
  const env = record.env;
  if (
    env !== undefined &&
    (!env ||
      typeof env !== "object" ||
      Array.isArray(env) ||
      Object.values(env as Record<string, unknown>).some((item) => typeof item !== "string"))
  ) {
    throw new Error(`hooks[${index}].env must map strings to strings`);
  }
  for (const key of ["timeoutMs", "priority"] as const) {
    const numeric = record[key];
    if (numeric !== undefined && (typeof numeric !== "number" || !Number.isFinite(numeric))) {
      throw new Error(`hooks[${index}].${key} must be a finite number`);
    }
  }
  if (typeof record.timeoutMs === "number" && record.timeoutMs <= 0) {
    throw new Error(`hooks[${index}].timeoutMs must be greater than zero`);
  }
  for (const key of ["asyncRewake"] as const) {
    if (record[key] !== undefined && typeof record[key] !== "boolean") {
      throw new Error(`hooks[${index}].${key} must be a boolean`);
    }
  }

  return {
    id,
    point: point as HookPoint,
    handlerPath,
    args: args as string[] | undefined,
    timeoutMs: record.timeoutMs as number | undefined,
    env: env as Record<string, string> | undefined,
    description: optionalString(record, "description"),
    priority: record.priority as number | undefined,
    toolFilter: optionalString(record, "toolFilter"),
    asyncRewake: record.asyncRewake as boolean | undefined,
    statusMessage: optionalString(record, "statusMessage"),
  };
}

export function resolveExternalHooksPath(env: NodeJS.ProcessEnv = process.env): string {
  return env[EXTERNAL_HOOKS_PATH_ENV] ?? join(getGordonDir(), DEFAULT_EXTERNAL_HOOKS_FILENAME);
}

export function loadExternalHookConfig(path: string): ExternalHookFileEntry[] {
  if (!existsSync(path)) throw new Error(`External hook config not found: ${path}`);
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf-8"));
  } catch (error) {
    throw new Error(
      `External hook config is unreadable or invalid JSON: ${path}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const values = Array.isArray(parsed) ? parsed : asRecord(parsed, "external hook config").hooks;
  if (!Array.isArray(values))
    throw new Error("External hook config must be an array or { hooks: [...] }");
  if (values.length === 0) {
    throw new Error(
      `External hook runner is enabled but ${path} declares no hooks; disable the runner or configure at least one policy hook`,
    );
  }
  const entries = values.map(parseEntry);
  const ids = new Set<string>();
  for (const entry of entries) {
    if (ids.has(entry.id)) throw new Error(`Duplicate external hook id: ${entry.id}`);
    ids.add(entry.id);
  }
  return entries;
}

export function installExternalHooks(
  env: NodeJS.ProcessEnv = flagEnv(),
): ExternalHookInstallerState {
  if (!isExternalHookRunnerEnabled(env)) return getExternalHookInstallerState();
  if (state.installed) return getExternalHookInstallerState();

  const configPath = resolveExternalHooksPath(env);
  try {
    const entries = loadExternalHookConfig(configPath);
    const cwd = dirname(configPath);
    unregisterInstalled = entries.map((config) => {
      const handlerPath = resolveHandlerPath(config.handlerPath, cwd);
      const resolvedConfig = { ...config, handlerPath };
      const definition: HookDefinition = {
        id: config.id,
        point: config.point,
        source: "user",
        priority: config.priority,
        toolFilter: config.toolFilter,
        asyncRewake: config.asyncRewake,
        statusMessage: config.statusMessage,
        handler: async (payload) =>
          (await runExternalHook(resolvedConfig, payload as never, { cwd })).result,
      };
      return registerHook(definition);
    });
    state = { installed: true, configPath, hookCount: entries.length, error: null };
    return getExternalHookInstallerState();
  } catch (error) {
    for (const unregister of unregisterInstalled.splice(0)) unregister();
    const message = error instanceof Error ? error.message : String(error);
    state = { installed: false, configPath, hookCount: 0, error: message };
    throw new Error(
      `${EXTERNAL_HOOK_RUNNER_FLAG_ENV}=1 but external hooks were not installed: ${message}`,
    );
  }
}

export function getExternalHookInstallerState(): ExternalHookInstallerState {
  return { ...state };
}

/** Test-only reset; production installation is process-lifetime. */
export function resetExternalHooksForTests(): void {
  for (const unregister of unregisterInstalled.splice(0)) unregister();
  state = { installed: false, configPath: null, hookCount: 0, error: null };
}
