/**
 * Client Entitlement Read
 *
 * Pure plan-tier ranking + comparison. The heartbeat response carries an
 * optional `plan` string (added server-side); the client caches it and reads
 * it via getActivePlan() in index.ts. This module holds the tier ordering and
 * the isPlanAtLeast() comparison seam.
 *
 * This is a READ + SEAM only. It deliberately does NOT gate any tool. The
 * operator wires plan checks where they want cold-tier vs pro differentiation
 * by calling isPlanAtLeast("pro") at the call site — one line away, but off by
 * default so nothing silently changes behavior for existing licenses.
 */

/** Known tiers, lowest to highest. Unknown server values rank as base tier. */
export const PLAN_TIERS = ["free", "starter", "pro", "enterprise"] as const;
export type PlanTier = (typeof PLAN_TIERS)[number];

/** Tier assumed when no plan has been reported yet (offline first run, or a
 *  server that does not send `plan`). Keeps behavior identical to today. */
export const DEFAULT_PLAN: PlanTier = "free";

/**
 * Rank of a plan string. Case-insensitive; unknown / empty values rank 0 (base
 * tier) so an unrecognized server value never accidentally unlocks anything.
 */
export function planRank(plan: string | null | undefined): number {
  if (!plan) return 0;
  const idx = (PLAN_TIERS as readonly string[]).indexOf(plan.trim().toLowerCase());
  return idx < 0 ? 0 : idx;
}

/** Ordering over plan strings: -1 if a < b, 0 if equal rank, 1 if a > b. */
export function comparePlans(a: string | null | undefined, b: string | null | undefined): number {
  const ra = planRank(a);
  const rb = planRank(b);
  if (ra === rb) return 0;
  return ra < rb ? -1 : 1;
}

/** True when `plan` meets or exceeds the required `tier`. */
export function planAtLeast(plan: string | null | undefined, tier: string): boolean {
  return planRank(plan) >= planRank(tier);
}
