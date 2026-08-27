import {
  listTrippedSwitches,
  MIN_KILL_SWITCH_RESET_RATIONALE_CHARS,
  resetAllKillSwitches,
  resetKillSwitch,
  tripKillSwitch,
  type KillSwitchKey,
  type KillSwitchScope,
} from "../../infra/safety/killSwitches.ts";
import { getProactiveEngine } from "../../infra/proactive/index.ts";
import { archiveAndResetHaltState } from "../../infra/safety/durableHaltState.ts";
import { auditLog } from "../../infra/platform/audit/audit-log.ts";

export interface KillSwitchCommandResult {
  success: boolean;
  message: string;
}

const VALID_SCOPES: readonly KillSwitchScope[] = [
  "strategy",
  "trader",
  "account",
  "client",
  "instrument",
  "venue",
  "gateway",
  "firm",
];

function isScope(value: string | undefined): value is KillSwitchScope {
  return VALID_SCOPES.includes(value as KillSwitchScope);
}

function keyLabel(key: KillSwitchKey): string {
  return key.id ? `${key.scope}:${key.id}` : key.scope;
}

function usage(): string {
  return [
    "Usage:",
    "  /killswitch list",
    "  /killswitch trip firm <reason>",
    "  /killswitch trip venue <id> <reason>",
    "  /killswitch reset firm <rationale>",
    "  /killswitch reset venue <id> <rationale>",
    "  /killswitch reset-all <rationale>",
    "  /killswitch archive-halt-state <rationale>",
    `Scopes: ${VALID_SCOPES.join(", ")}`,
  ].join("\n");
}

function parseKey(
  scopeRaw: string | undefined,
  idRaw: string | undefined,
): { key?: KillSwitchKey; restOffset: number; error?: string } {
  if (!isScope(scopeRaw)) {
    return { restOffset: 0, error: `Unknown scope '${scopeRaw ?? ""}'.\n${usage()}` };
  }
  if (scopeRaw === "firm") {
    return { key: { scope: "firm" }, restOffset: 2 };
  }
  if (!idRaw) {
    return { restOffset: 0, error: `Scope '${scopeRaw}' requires an id.\n${usage()}` };
  }
  return { key: { scope: scopeRaw, id: idRaw }, restOffset: 3 };
}

async function fireKillSwitchCard(title: string, body: string, key?: KillSwitchKey): Promise<void> {
  try {
    await getProactiveEngine().fireCandidate({
      category: "risk_warning",
      title,
      body,
      action: "/killswitch list",
      confidence: 1,
      triggers: {
        source: "manual",
        eventType: "kill_switch",
        metadata: key ? { scope: key.scope, id: key.id } : undefined,
      },
      observationSummary: body,
    });
  } catch {
    // Command output is the primary surface; proactive card is best-effort.
  }
}

export async function handleKillSwitchCommand(args: string): Promise<KillSwitchCommandResult> {
  const parts = args.trim().split(/\s+/).filter(Boolean);
  const subcommand = parts[0]?.toLowerCase() ?? "list";

  if (subcommand === "help") {
    return { success: true, message: usage() };
  }

  if (subcommand === "list" || subcommand === "status") {
    const trips = listTrippedSwitches();
    if (trips.length === 0) {
      return { success: true, message: "No kill switches are tripped." };
    }
    const lines = trips.map(
      (trip) =>
        `- ${keyLabel(trip.key)} tripped ${new Date(trip.trippedAt).toISOString()}: ${trip.reason}`,
    );
    return { success: true, message: `Tripped kill switches:\n${lines.join("\n")}` };
  }

  if (subcommand === "reset-all") {
    const rationale = parts.slice(1).join(" ").trim();
    if (rationale.length < MIN_KILL_SWITCH_RESET_RATIONALE_CHARS) {
      return {
        success: false,
        message: `Reset rationale is required (min ${MIN_KILL_SWITCH_RESET_RATIONALE_CHARS} chars) — it is recorded in the audit log.\n${usage()}`,
      };
    }
    resetAllKillSwitches(rationale);
    await fireKillSwitchCard(
      "All kill switches reset",
      "Operator reset every kill switch. Execution gates are clear unless another switch is tripped.",
    );
    return { success: true, message: "All kill switches reset." };
  }

  if (subcommand === "archive-halt-state") {
    const rationale = parts.slice(1).join(" ").trim();
    const reset = archiveAndResetHaltState(rationale);
    if (!reset.ok) {
      auditLog.failure(
        "operator",
        "HALT_STATE_RESET",
        { rationale },
        reset.error ?? "reset refused",
      );
      return { success: false, message: reset.error ?? "Halt-state recovery refused." };
    }
    auditLog.success("operator", "HALT_STATE_RESET", {
      rationale,
      archivePath: reset.archivePath,
    });
    return {
      success: true,
      message: `Authenticated halt state archived${reset.archivePath ? ` at ${reset.archivePath}` : ""} and reset.`,
    };
  }

  if (subcommand === "trip") {
    const parsed = parseKey(parts[1], parts[2]);
    if (!parsed.key) {
      return { success: false, message: parsed.error ?? usage() };
    }
    const reason = parts.slice(parsed.restOffset).join(" ").trim();
    if (reason.length < 3) {
      return { success: false, message: `Trip reason is required.\n${usage()}` };
    }
    tripKillSwitch(parsed.key, reason);
    const label = keyLabel(parsed.key);
    const message = `Kill switch tripped: ${label} - ${reason}`;
    await fireKillSwitchCard("Kill switch tripped", message, parsed.key);
    return { success: true, message };
  }

  if (subcommand === "reset") {
    const parsed = parseKey(parts[1], parts[2]);
    if (!parsed.key) {
      return { success: false, message: parsed.error ?? usage() };
    }
    const rationale = parts.slice(parsed.restOffset).join(" ").trim();
    if (rationale.length < MIN_KILL_SWITCH_RESET_RATIONALE_CHARS) {
      return {
        success: false,
        message: `Reset rationale is required (min ${MIN_KILL_SWITCH_RESET_RATIONALE_CHARS} chars) — it is recorded in the audit log.\n${usage()}`,
      };
    }
    const existed = resetKillSwitch(parsed.key, rationale);
    const label = keyLabel(parsed.key);
    const message = existed
      ? `Kill switch reset: ${label}`
      : `Kill switch was not tripped: ${label}`;
    await fireKillSwitchCard("Kill switch reset", message, parsed.key);
    return { success: true, message };
  }

  return { success: false, message: `Unknown killswitch subcommand '${subcommand}'.\n${usage()}` };
}
