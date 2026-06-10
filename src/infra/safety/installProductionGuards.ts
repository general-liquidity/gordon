import { installFilesystemWriteGuard } from "./filesystemWriteGuardInstaller.ts";
import { installOutboundFetchGuard } from "./outboundFetchGuard.ts";

let installed = false;

/** Idempotent safety-plane bootstrap for any Gordon process entry point. */
export function installProductionGuards(): void {
  if (installed) return;
  installed = true;
  installOutboundFetchGuard();
  installFilesystemWriteGuard();
}