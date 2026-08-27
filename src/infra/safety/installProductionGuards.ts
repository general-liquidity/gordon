import { installFilesystemWriteGuard } from "./filesystemWriteGuardInstaller.ts";
import { installOutboundFetchGuard } from "./outboundFetchGuard.ts";
import { installProcessHardening } from "./processHardening.ts";
import { installExternalHooks } from "../hooks/externalHookRegistry.ts";
import {
  FILESYSTEM_WRITE_GUARD_FLAG_ENV,
  FILESYSTEM_WRITE_GUARD_MODE_ENV,
} from "./filesystemWriteGuard.ts";
import { NETWORK_ALLOWLIST_FLAG_ENV, NETWORK_ALLOWLIST_MODE_ENV } from "./networkAllowlist.ts";
import { flagEnv } from "../config/flagResolver.ts";

export const DISABLE_GUARDS_ENV = "GORDON_DISABLE_GUARDS";
export const GUARDS_MODE_ENV = "GORDON_GUARDS";

let installed = false;

/**
 * Install the safety guards (network allowlist + filesystem write guard)
 * ENABLE + BLOCK by default. Escape hatches:
 *   - GORDON_DISABLE_GUARDS=1 → skip entirely (no guards installed).
 *   - GORDON_GUARDS=warn      → install but in warn mode (log, don't block).
 *   - otherwise               → enable + block by default.
 *
 * Operator overrides are preserved: any of the per-guard FLAG/MODE envs
 * that are already explicitly set are left untouched. The block default
 * lives here in the install path only — the low-level getAllowlistMode /
 * getGuardMode helpers still default to "warn" for library-direct callers.
 */
export function applyProductionEnvDefaults(
  env: NodeJS.ProcessEnv = process.env,
  resolved: NodeJS.ProcessEnv = env === process.env ? flagEnv() : env,
): void {
  if (resolved[DISABLE_GUARDS_ENV] === "1" || resolved[DISABLE_GUARDS_ENV] === "true") {
    // Explicitly disable both guards. The isEnabled helpers default to
    // true on an unset flag, so we must set "0" — returning early would
    // leave them on in their own default (warn) mode.
    if (!env[NETWORK_ALLOWLIST_FLAG_ENV]) {
      env[NETWORK_ALLOWLIST_FLAG_ENV] = "0";
    }
    if (!env[FILESYSTEM_WRITE_GUARD_FLAG_ENV]) {
      env[FILESYSTEM_WRITE_GUARD_FLAG_ENV] = "0";
    }
    return;
  }

  const warnMode = resolved[GUARDS_MODE_ENV] === "warn";
  const mode = warnMode ? "warn" : "block";

  if (!resolved[NETWORK_ALLOWLIST_FLAG_ENV]) {
    env[NETWORK_ALLOWLIST_FLAG_ENV] = "1";
  }
  if (!resolved[NETWORK_ALLOWLIST_MODE_ENV]) {
    env[NETWORK_ALLOWLIST_MODE_ENV] = mode;
  }
  if (!resolved[FILESYSTEM_WRITE_GUARD_FLAG_ENV]) {
    env[FILESYSTEM_WRITE_GUARD_FLAG_ENV] = "1";
  }
  if (!resolved[FILESYSTEM_WRITE_GUARD_MODE_ENV]) {
    env[FILESYSTEM_WRITE_GUARD_MODE_ENV] = mode;
  }
}

/** Idempotent safety-plane bootstrap for any Gordon process entry point. */
export function installProductionGuards(): void {
  if (installed) return;
  applyProductionEnvDefaults();
  installProcessHardening();
  installOutboundFetchGuard();
  installFilesystemWriteGuard();
  installExternalHooks();
  // Mark the aggregate bootstrap complete only after every enabled guard is
  // installed. In particular, a fail-closed external-hook config error must
  // not make a later diagnostic/retry believe the whole safety plane exists.
  installed = true;
}
