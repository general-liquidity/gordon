import { installFilesystemWriteGuard } from "./filesystemWriteGuardInstaller.ts";
import { installOutboundFetchGuard } from "./outboundFetchGuard.ts";
import {
  FILESYSTEM_WRITE_GUARD_FLAG_ENV,
  FILESYSTEM_WRITE_GUARD_MODE_ENV,
} from "./filesystemWriteGuard.ts";
import {
  NETWORK_ALLOWLIST_FLAG_ENV,
  NETWORK_ALLOWLIST_MODE_ENV,
} from "./networkAllowlist.ts";

export const PRODUCTION_FLAG_ENV = "GORDON_PRODUCTION";

let installed = false;

function applyProductionEnvDefaults(env: NodeJS.ProcessEnv = process.env): void {
  const production =
    env[PRODUCTION_FLAG_ENV] === "1" || env[PRODUCTION_FLAG_ENV] === "true";
  if (!production) return;

  if (!env[NETWORK_ALLOWLIST_FLAG_ENV]) {
    env[NETWORK_ALLOWLIST_FLAG_ENV] = "1";
  }
  if (!env[NETWORK_ALLOWLIST_MODE_ENV]) {
    env[NETWORK_ALLOWLIST_MODE_ENV] = "block";
  }
  if (!env[FILESYSTEM_WRITE_GUARD_FLAG_ENV]) {
    env[FILESYSTEM_WRITE_GUARD_FLAG_ENV] = "1";
  }
  if (!env[FILESYSTEM_WRITE_GUARD_MODE_ENV]) {
    env[FILESYSTEM_WRITE_GUARD_MODE_ENV] = "block";
  }
}

/** Idempotent safety-plane bootstrap for any Gordon process entry point. */
export function installProductionGuards(): void {
  if (installed) return;
  installed = true;
  applyProductionEnvDefaults();
  installOutboundFetchGuard();
  installFilesystemWriteGuard();
}