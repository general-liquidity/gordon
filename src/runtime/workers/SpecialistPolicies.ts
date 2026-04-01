import type { RuntimePermissionScope } from "../contracts/types.ts";
import { WorkerRegistry } from "./WorkerRegistry.ts";

export interface SpecialistPolicy {
  worker: string;
  allowedHandoffs: string[];
  defaultScopes: RuntimePermissionScope[];
}

export function getSpecialistPolicy(worker: string, registry: WorkerRegistry = new WorkerRegistry()): SpecialistPolicy | null {
  const definition = registry.get(worker);
  if (!definition) {
    return null;
  }

  return {
    worker: definition.name,
    allowedHandoffs: [...definition.handoffTargets],
    defaultScopes: [...definition.defaultScopes],
  };
}
