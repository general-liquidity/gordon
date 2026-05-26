/**
 * Reminder-scheduler wiring — process-local scheduler instance plus a
 * one-call "collect + advance" helper that builders splice into the
 * autonomous-loop prompt before each turn.
 *
 * Always on. Default factories (daily-loss limit, mandate scope, open
 * positions) are pre-registered on first access — callers supply the
 * getters that read live state.
 */

import {
  ReminderScheduler,
  dailyLossLimitReminder,
  mandateScopeReminder,
  openPositionsReminder,
} from "../reminders/reminderScheduler.ts";

let scheduler: ReminderScheduler | undefined;
let registeredDefaults = false;

export interface DefaultReminderProviders {
  getDailyLossLimitUsd?: () => number;
  getMandate?: () => { id: string; venues: string[]; expiresAt?: string } | null;
  getPositionCount?: () => number;
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
 * Advance the turn counter and collect any due reminders for this turn.
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
  return s.collect();
}

/** Test helper. */
export function _resetReminderWiringForTests(): void {
  scheduler = undefined;
  registeredDefaults = false;
}
