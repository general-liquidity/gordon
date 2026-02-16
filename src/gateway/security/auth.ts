import { randomBytes, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createModuleLogger } from "../../infra/logger/index.ts";
import { GORDON_DIR } from "../../infra/storage/paths.ts";
import type { GatewayCommandType } from "../protocol/commands.ts";

const logger = createModuleLogger("gateway-auth");
const DAEMON_AUTH_FILE = join(GORDON_DIR, "daemon-auth.json");

export type GatewayCapability =
  | "chat:write"
  | "scan:run"
  | "monitor:run"
  | "system:arm"
  | "scheduler:write"
  | "scheduler:read"
  | "runtime:health"
  | "reconcile:run"
  | "plugin:reload"
  | "daemon:manage";

export interface GatewayPrincipal {
  id: string;
  type: "local-daemon" | "local-cli";
  capabilities: Set<GatewayCapability>;
}

interface DaemonAuthState {
  token: string;
  createdAt: string;
}

function defaultCapabilities(): Set<GatewayCapability> {
  return new Set<GatewayCapability>([
    "chat:write",
    "scan:run",
    "monitor:run",
    "system:arm",
    "scheduler:write",
    "scheduler:read",
    "runtime:health",
    "reconcile:run",
    "plugin:reload",
    "daemon:manage",
  ]);
}

async function ensureGordonDir(): Promise<void> {
  await mkdir(GORDON_DIR, { recursive: true });
}

function generateToken(): string {
  return randomBytes(32).toString("hex");
}

export async function getOrCreateDaemonToken(): Promise<string> {
  await ensureGordonDir();
  try {
    const raw = await readFile(DAEMON_AUTH_FILE, "utf-8");
    const parsed = JSON.parse(raw) as DaemonAuthState;
    if (parsed.token && typeof parsed.token === "string") {
      return parsed.token;
    }
  } catch {
    // Create new token below
  }

  const token = generateToken();
  const payload: DaemonAuthState = {
    token,
    createdAt: new Date().toISOString(),
  };
  await writeFile(DAEMON_AUTH_FILE, JSON.stringify(payload, null, 2), "utf-8");
  logger.info("Created local daemon auth token", { path: DAEMON_AUTH_FILE });
  return token;
}

export async function resolvePrincipalFromToken(token?: string): Promise<GatewayPrincipal | null> {
  if (!token) return null;
  const expected = await getOrCreateDaemonToken();

  const lhs = Buffer.from(token);
  const rhs = Buffer.from(expected);
  if (lhs.length !== rhs.length) return null;
  if (!timingSafeEqual(lhs, rhs)) return null;

  return {
    id: "local-daemon-client",
    type: "local-cli",
    capabilities: defaultCapabilities(),
  };
}

export function requiredCapabilityForCommand(type: GatewayCommandType): GatewayCapability {
  switch (type) {
    case "chat.send_message":
      return "chat:write";
    case "scan.run":
      return "scan:run";
    case "monitor.run_cycle":
      return "monitor:run";
    case "system.arm":
    case "system.disarm":
      return "system:arm";
    case "scheduler.create_task":
    case "scheduler.delete_task":
      return "scheduler:write";
    case "scheduler.list_tasks":
      return "scheduler:read";
    case "runtime.health_check":
      return "runtime:health";
    case "reconcile.run":
      return "reconcile:run";
    case "plugin.reload":
      return "plugin:reload";
    case "daemon.shutdown":
      return "daemon:manage";
    default:
      return "chat:write";
  }
}

export function principalHasCapability(
  principal: GatewayPrincipal | null,
  capability: GatewayCapability,
): boolean {
  if (!principal) return false;
  return principal.capabilities.has(capability);
}

