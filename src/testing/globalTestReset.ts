/**
 * Global test preload — resets process-global trade/gate singletons before
 * EACH test so no test inherits dirty state regardless of file order.
 *
 * The default-on trade-halt gates read process-scoped singletons. Under a
 * single-process `bun test` run, a test that executes a plan leaves an
 * "active" entry (WIP registry) or a tripped halt (cost budget, kill switch,
 * constitution halt) behind; a later money-path test then trips that gate and
 * fails. Which tests collide is order-dependent, so CI (Linux order) fails
 * different tests than a local run. Resetting the runtime state before every
 * test removes the whole flaky class at once.
 *
 * This is TEST-ISOLATION only: it clears per-session runtime state that should
 * always start empty. It does NOT change any gate default, threshold, or
 * logic. All gates stay default-ON in production.
 *
 * Wired via bunfig.toml `[test].preload`. A `beforeEach` registered in a
 * preload applies to every test file; it runs before each file's own
 * `beforeEach`, so files that build their own gate state remain unaffected.
 */

import { beforeEach } from "bun:test";

import { resetSessionWipRegistryForTesting } from "../infra/safety/wipSessionRegistry.ts";
import { reloadConstitutionHaltState } from "../infra/safety/defense/tradingConstitution.ts";
import { resetAllKillSwitches } from "../infra/safety/killSwitches.ts";
import {
  setCostBudget,
  resetCostBudgetState,
  resetCostTracker,
} from "../infra/platform/costTracker.ts";

beforeEach(() => {
  // WIP-limit registry — the hard blocker on execute_plan. Clears active plans.
  resetSessionWipRegistryForTesting();

  // Cost budget + daily roll-up + halt flag + tracker singleton.
  setCostBudget(null);
  resetCostBudgetState();
  resetCostTracker();

  // Kill switches. In-memory-only under `bun test` (statePath() is null unless
  // KILL_SWITCH_STATE_PATH_ENV is set); when a persistence path IS set this
  // is a no-op without a rationale, so persistence tests are not clobbered.
  resetAllKillSwitches();

  // Trading-constitution halt. Under `bun test` (no path override) this
  // reloads to a clean, non-halted in-memory state without touching disk.
  reloadConstitutionHaltState();
});
