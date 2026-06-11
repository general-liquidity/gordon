import { InMemoryStore, type MastraCompositeStore } from "@mastra/core/storage";
import type { MastraVector } from "@mastra/core/vector";
import { createRequire } from "node:module";

type LibSQLStoreConfig = {
  id: string;
  url: string;
};

type LibSQLRuntime = {
  LibSQLStore: new (config: LibSQLStoreConfig) => MastraCompositeStore;
  LibSQLVector: new (config: LibSQLStoreConfig) => MastraVector;
};

type RuntimeRequire = NodeJS.Require;

export interface MastraStorageOptions {
  storeId: string;
  dbUrl: string;
  vectorId?: string;
  vectorDbUrl?: string;
  enableVector?: boolean;
}

export interface MastraStorageConfig {
  storage: MastraCompositeStore;
  vector: MastraVector | false;
  mode: "libsql" | "memory";
}

const globalRequire = (globalThis as typeof globalThis & { require?: RuntimeRequire }).require;
const runtimeRequire: RuntimeRequire = globalRequire ?? createRequire(import.meta.url);

let cachedLibsqlRuntime: LibSQLRuntime | null | undefined;
let warnedAboutFallback = false;

function shouldDisableLibsql(): boolean {
  return process.env.GORDON_DISABLE_LIBSQL === "1";
}

function warnLibsqlFallbackOnce(reason: unknown): void {
  if (warnedAboutFallback || process.env.GORDON_STARTUP_QUIET === "1") {
    return;
  }

  warnedAboutFallback = true;
  const message = reason instanceof Error ? reason.message : String(reason);
  console.warn(
    `[Gordon] LibSQL runtime unavailable; using in-memory Mastra storage instead. `
    + `Thread memory will reset when Gordon exits. (${message})`
  );
}

function loadLibsqlRuntime(): LibSQLRuntime | null {
  if (shouldDisableLibsql()) {
    return null;
  }

  if (cachedLibsqlRuntime !== undefined) {
    return cachedLibsqlRuntime;
  }

  try {
    const moduleExports = runtimeRequire("@mastra/libsql") as Partial<LibSQLRuntime>;
    if (typeof moduleExports.LibSQLStore !== "function" || typeof moduleExports.LibSQLVector !== "function") {
      cachedLibsqlRuntime = null;
      return null;
    }

    cachedLibsqlRuntime = moduleExports as LibSQLRuntime;
    return cachedLibsqlRuntime;
  } catch (error) {
    cachedLibsqlRuntime = null;
    warnLibsqlFallbackOnce(error);
    return null;
  }
}

export function createMastraStorageConfig(options: MastraStorageOptions): MastraStorageConfig {
  const libsql = loadLibsqlRuntime();

  if (libsql) {
    try {
      return {
        storage: new libsql.LibSQLStore({
          id: options.storeId,
          url: options.dbUrl,
        }),
        vector: options.enableVector
          ? new libsql.LibSQLVector({
            id: options.vectorId ?? `${options.storeId}-vector`,
            url: options.vectorDbUrl ?? options.dbUrl,
          })
          : false,
        mode: "libsql",
      };
    } catch (error) {
      warnLibsqlFallbackOnce(error);
    }
  }

  return {
    storage: new InMemoryStore({ id: options.storeId }),
    vector: false,
    mode: "memory",
  };
}
