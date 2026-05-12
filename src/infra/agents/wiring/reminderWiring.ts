/**
 * Reminder-scheduler wiring — process-local scheduler instance plus a
 * one-call "collect + advance" helper that builders splice into the
 * autonomous-loop prompt before each turn.
 *
 * Activation: `GORDON_REMINDERS` env flag. When off, the helper
 * returns an empty array so callers can `.concat(reminders)` cleanly
 * regardless. The scheduler itself still ticks; only the emission
 * is gated.
 *
 * Default factories (daily-loss limit, mandate scope, open positions)
 * are pre-registered on first access — callers supply the getters
 * that read live state.
 */

import {
  ReminderScheduler,
  dailyLossLimitReminder,
  mandateScopeReminder,
  openPositionsReminder,
} from "../reminders/reminderScheduler.ts";

const FLAG_ENV = "GORDON_REMINDERS";

let scheduler: ReminderScheduler | undefined;
let registeredDefaults = false;

export interface DefaultReminderProviders {
  getDailyLossLimitUsd?: () => number;
  getMandate?: () => { id: string; venues: string[]; expiresAt?: string } | null;
  getPositionCount?: () => number;
}

export function isRemindersEnabled(): boolean {
  return process.env[FLAG_ENV] === "1";
}

export function getSchedulerInstance(): ReminderScheduler {
  if (!scheduler) scheduler = new ReminderScheduler();
  return scheduler;
}

/**
 * Register the three default trading reminders with the supplied
 * state-getters. Safe to call multiple times — only fires once per
 * process. Pass `null` for any getter you don't have wired yet.
 */
export function registerDefaultReminders(providers: DefaultReminderProviders): void {
  if (registeredDefaults) return;
  const s = getSchedulerInstance();
  if (providers.getDailyLossLimitUsd) {
    s.register(dailyLossLimitReminder(providers.getDailyLossLimitUsd));
  }
  if (providers.getMandate) {
    s.register(mandateScopeReminder(providers.getMandate));
  }
  if (providers.getPositionCount) {
    s.register(openPositionsReminder(providers.getPositionCount));
  }
  registeredDefaults = true;
}

/**
 * Advance the turn counter and collect any due reminders for this
 * turn. Returns [] when flag is off so callers don't need to branch.
 *
 * Typical use in autonomous-loop:
 *   const reminders = tickAndCollectReminders();
 *   if (reminders.length > 0) {
 *     prompt = reminders.join("\n") + "\n\n" + prompt;
 *   }
 */
export function tickAndCollectReminders(): string[] {
  const s = getSchedulerInstance();
  s.advance();
  if (!isRemindersEnabled()) return [];
  return s.collect();
}

/** Test helper. */
export function _resetReminderWiringForTests(): void {
  scheduler = undefined;
  registeredDefaults = false;
}
