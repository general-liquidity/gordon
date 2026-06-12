import type { KillSwitchKey } from "../../infra/safety/killSwitches.ts";

export interface KillSwitchTrip {
  key: KillSwitchKey;
  reason: string;
  trippedAt: number;
}

export interface KillSwitchStatus {
  enabled: boolean;
  halted: boolean;
  trips: KillSwitchTrip[];
  signature: string;
  summary: string;
}

export function formatKillSwitchKey(key: KillSwitchKey): string {
  return key.id ? `${key.scope}:${key.id}` : key.scope;
}

export type KillSwitchBadgeSeverity = "off" | "armed" | "halted";

export interface KillSwitchBadge {
  text: string;
  severity: KillSwitchBadgeSeverity;
}

export function formatKillSwitchBadge(status: KillSwitchStatus): KillSwitchBadge {
  if (!status.enabled) return { text: "⛉ halt off", severity: "off" };
  if (status.trips.length === 0) return { text: "⛉ halt armed", severity: "armed" };
  // A firm-scope trip halts everything — lead with it over narrower scopes.
  const lead = status.trips.find((trip) => trip.key.scope === "firm") ?? status.trips[0]!;
  const extra = status.trips.length - 1;
  return {
    text: `⛔ HALTED: ${formatKillSwitchKey(lead.key)}${extra > 0 ? ` +${extra}` : ""}`,
    severity: "halted",
  };
}

export function buildKillSwitchStatus(input: {
  enabled: boolean;
  trips: KillSwitchTrip[];
}): KillSwitchStatus {
  const trips = [...input.trips].sort((a, b) => {
    const byScope = formatKillSwitchKey(a.key).localeCompare(formatKillSwitchKey(b.key));
    return byScope || a.trippedAt - b.trippedAt;
  });
  const signature = [
    input.enabled ? "enabled" : "disabled",
    ...trips.map((trip) => `${formatKillSwitchKey(trip.key)}:${trip.trippedAt}:${trip.reason}`),
  ].join("|");

  if (!input.enabled) {
    return {
      enabled: false,
      halted: false,
      trips,
      signature,
      summary: "kill switches disabled",
    };
  }

  if (trips.length === 0) {
    return {
      enabled: true,
      halted: false,
      trips,
      signature,
      summary: "kill switches armed",
    };
  }

  const firmTrip = trips.find((trip) => trip.key.scope === "firm");
  return {
    enabled: true,
    halted: true,
    trips,
    signature,
    summary: firmTrip
      ? `HALTED: firm - ${firmTrip.reason}`
      : `HALTED: ${trips.map((trip) => formatKillSwitchKey(trip.key)).join(", ")}`,
  };
}
