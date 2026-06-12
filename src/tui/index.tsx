import React from "react";
import { render } from "./ink-custom";
import { App } from "./App.js";
import { loadLabsFlagsIntoEnv } from "./ink-custom/loadLabsFlags.js";
import { renderBanner } from "./boot/banner.ts";
import { collectBootStaticInfo, renderBootStaticRows } from "./boot/bootComposition.ts";
import { acquireInstanceLock, InstanceLockCollisionError } from "../infra/storage/instanceLock.ts";
import { setInkInstance } from "./utils/inkInstance.ts";
import { resolveScreenMode } from "./screenMode.ts";
import { enterAltScreen, forceLeaveAltScreen } from "./utils/altScreen.ts";

export async function startGordonTUI(): Promise<void> {
  loadLabsFlagsIntoEnv();

  const lock = process.stdout.isTTY ? acquireTuiLockOrExit() : null;
  if (lock) process.once("exit", () => lock.release());

  const screenMode = resolveScreenMode();
  if (screenMode === "fullscreen") {
    // Fullscreen screen model: banner/session/preflight render in-app as the
    // scroll-origin of the chat viewport (FullscreenHeader as the first
    // VirtualMessageList entry), so nothing is printed pre-Ink. Enter the alt
    // screen before Ink renders; restoration is covered on every exit path —
    // the explicit forceLeaveAltScreen after waitUntilExit (normal unmount)
    // plus the process "exit" hook registered inside enterAltScreen (fires
    // for process.exit from gracefulShutdown on SIGINT/SIGTERM/SIGHUP and
    // from the uncaughtException handler in src/index.tsx).
    enterAltScreen();
  } else if (process.stdout.isTTY) {
    process.stdout.write("\x1b[2J\x1b[H");
    const columns = process.stdout.columns ?? 120;
    const info = collectBootStaticInfo();
    process.stdout.write(
      [
        ...renderBanner({ columns, version: info.version }),
        "",
        ...renderBootStaticRows(info, columns),
        "",
      ].join("\n") + "\n",
    );
  }

  const instance = render(<App />, {
    incrementalRendering: true,
    maxFps: 60,
  });
  setInkInstance(instance);
  await instance.waitUntilExit();

  // Normal unmount: restore the main screen buffer before the process winds
  // down so the user's terminal is never left on the alt screen.
  if (screenMode === "fullscreen") forceLeaveAltScreen();

  await new Promise<void>(() => {});
}

function acquireTuiLockOrExit(): ReturnType<typeof acquireInstanceLock> {
  try {
    return acquireInstanceLock("tui");
  } catch (error) {
    if (error instanceof InstanceLockCollisionError) {
      process.stderr.write(
        `Gordon is already running${error.pid ? ` (pid ${error.pid})` : ""}.\n` +
        `Lock: ${error.path}\n` +
        "Set GORDON_ALLOW_MULTI_INSTANCE=1 to override.\n",
      );
      process.exit(1);
    }
    throw error;
  }
}
