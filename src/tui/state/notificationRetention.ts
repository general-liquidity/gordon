// Single source of truth for the TUI notification retention cap. Both the
// typed reducer and the bridge dispatch adapter append through this helper —
// previously the adapter path was uncapped and grew without bound over long
// sessions while the reducer capped at 50.

export const MAX_TUI_NOTIFICATIONS = 50;

export function appendNotificationCapped<T>(
  list: readonly T[] | undefined,
  item: T,
  cap: number = MAX_TUI_NOTIFICATIONS,
): T[] {
  const next = [...(list ?? []), item];
  return next.length > cap ? next.slice(-cap) : next;
}
