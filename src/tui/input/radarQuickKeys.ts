export interface RadarFocus {
  id: string;
  category: string;
  title: string;
}

/** Returns the slash command to submit for a radar quick key, or null. */
export function radarQuickKeyCommand(input: string, focus: RadarFocus | null): string | null {
  if (!focus) return null;

  switch (input.toLowerCase()) {
    case "a":
      return `/ack ${focus.id}`;
    case "p":
      return `/pass ${focus.id}`;
    case "d":
      return `/snooze ${focus.category} 60`;
    default:
      return null;
  }
}
