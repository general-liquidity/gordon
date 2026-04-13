/**
 * Telemetry Cardinality Gates
 *
 * Claude Code pattern: env-var-driven gates that control which high-
 * cardinality fields get included in metric attributes. Without these,
 * metrics with version+session+account_id all included can balloon the
 * cardinality of any time-series store and break dashboards.
 *
 * Defaults err on the side of low cardinality. Operators can opt back in
 * via env when they need richer slicing.
 *
 * Env vars (all use "1"/"true" to enable, "0"/"false" to disable):
 *
 *   GORDON_METRICS_INCLUDE_SESSION_ID    default: true
 *   GORDON_METRICS_INCLUDE_VERSION       default: false
 *   GORDON_METRICS_INCLUDE_ACCOUNT_UUID  default: true
 *   GORDON_METRICS_INCLUDE_BUN_VERSION   default: false
 *   GORDON_METRICS_INCLUDE_OS_DETAIL     default: false (drop arch+platform)
 *   GORDON_METRICS_INCLUDE_TERMINAL      default: false
 */

export type CardinalityKey =
  | "session_id"
  | "version"
  | "account_uuid"
  | "bun_version"
  | "os_detail"
  | "terminal";

const ENV_VAR_MAP: Record<CardinalityKey, string> = {
  session_id: "GORDON_METRICS_INCLUDE_SESSION_ID",
  version: "GORDON_METRICS_INCLUDE_VERSION",
  account_uuid: "GORDON_METRICS_INCLUDE_ACCOUNT_UUID",
  bun_version: "GORDON_METRICS_INCLUDE_BUN_VERSION",
  os_detail: "GORDON_METRICS_INCLUDE_OS_DETAIL",
  terminal: "GORDON_METRICS_INCLUDE_TERMINAL",
};

const DEFAULTS: Record<CardinalityKey, boolean> = {
  session_id: true,
  version: false,
  account_uuid: true,
  bun_version: false,
  os_detail: false,
  terminal: false,
};

function parseEnvBool(raw: string | undefined): boolean | null {
  if (raw == null) return null;
  const v = raw.trim().toLowerCase();
  if (v === "1" || v === "true" || v === "yes" || v === "on") return true;
  if (v === "0" || v === "false" || v === "no" || v === "off") return false;
  return null;
}

/** Should the given high-cardinality attribute be included in metrics? */
export function cardinalityIncludes(key: CardinalityKey): boolean {
  const envKey = ENV_VAR_MAP[key];
  const parsed = parseEnvBool(process.env[envKey]);
  if (parsed != null) return parsed;
  return DEFAULTS[key];
}

/**
 * Filter an attribute object down to only the fields the cardinality
 * gates allow. Stable lower-cardinality fields are passed through; high-
 * cardinality ones are stripped if disabled.
 *
 * @param raw    Original attribute bag (may contain anything)
 * @param policy Map from attribute key to cardinality key (which gate
 *               controls it). Unmapped keys pass through unchanged.
 */
export function applyCardinalityGates<T extends Record<string, unknown>>(
  raw: T,
  policy: Partial<Record<keyof T, CardinalityKey>>,
): Partial<T> {
  const out: Partial<T> = {};
  for (const [k, v] of Object.entries(raw)) {
    const card = policy[k as keyof T];
    if (card && !cardinalityIncludes(card)) continue;
    (out as Record<string, unknown>)[k] = v;
  }
  return out;
}

/** Stats for /telemetry status — show which gates are on. */
export function describeCardinality(): Record<CardinalityKey, boolean> {
  return Object.fromEntries(
    (Object.keys(DEFAULTS) as CardinalityKey[]).map((k) => [k, cardinalityIncludes(k)]),
  ) as Record<CardinalityKey, boolean>;
}
