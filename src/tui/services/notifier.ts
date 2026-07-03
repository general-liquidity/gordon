// ============================================================================
// Desktop Notification Service — Multi-channel terminal notifications
//
// Supports iTerm2, Kitty, Ghostty, and terminal bell fallback.
// Auto-detects terminal type from environment variables.
// ============================================================================

import { wrapForMultiplexer } from "../utils/osc.ts";

export type NotificationChannel = "iterm2" | "kitty" | "ghostty" | "bell";

export function detectChannel(): NotificationChannel {
  const term = process.env.TERM_PROGRAM ?? "";
  if (term.toLowerCase().includes("iterm")) return "iterm2";
  if (term.toLowerCase().includes("kitty")) return "kitty";
  if (term.toLowerCase().includes("ghostty")) return "ghostty";
  return "bell";
}

export function notify(title: string, body?: string): void {
  const channel = detectChannel();
  const message = body ? `${title}: ${body}` : title;

  switch (channel) {
    case "iterm2":
      process.stdout.write(wrapForMultiplexer(`\x1b]9;${message}\x07`));
      break;
    case "kitty":
      process.stdout.write(wrapForMultiplexer(`\x1b]99;i=1:d=0;${message}\x1b\\`));
      break;
    case "ghostty":
      process.stdout.write(wrapForMultiplexer(`\x1b]777;notify;${title};${body ?? ""}\x1b\\`));
      break;
    case "bell":
    default:
      // Raw BEL, never wrapped — tmux must see \x07 to set the window bell flag.
      process.stdout.write("\x07");
      break;
  }
}
