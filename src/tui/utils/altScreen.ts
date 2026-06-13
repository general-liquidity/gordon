import { detectTerminalCapability } from "../ink-custom/syncTerminal.ts";

const ALT_ENTER = "\x1b[?1049h\x1b[H\x1b[2J";
const ALT_LEAVE = "\x1b[?1049l";

let entered = false;
let activeOut: NodeJS.WriteStream | null = null;
let exitHookRegistered = false;

export function enterAltScreen(out: NodeJS.WriteStream = process.stdout): boolean {
  if (entered) return true;
  if (!out.isTTY) return false;
  if (!detectTerminalCapability().hasAlternateScreen) return false;

  out.write(ALT_ENTER);
  entered = true;
  activeOut = out;
  registerExitHook();
  return true;
}

export function leaveAltScreen(out: NodeJS.WriteStream = process.stdout): void {
  if (!entered) return;
  const target = activeOut ?? out;
  target.write(ALT_LEAVE);
  entered = false;
  activeOut = null;
}

function registerExitHook(): void {
  if (exitHookRegistered) return;
  exitHookRegistered = true;
  process.once("exit", () => {
    if (entered && activeOut) {
      activeOut.write(ALT_LEAVE);
      entered = false;
      activeOut = null;
    }
  });
}
