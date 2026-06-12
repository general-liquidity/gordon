import React from "react";
import { render } from "./ink-custom";
import { App } from "./App.js";
import { loadLabsFlagsIntoEnv } from "./ink-custom/loadLabsFlags.js";
import { renderBanner } from "./boot/banner.ts";
import { collectBootStaticInfo, renderBootStaticRows } from "./boot/bootComposition.ts";
import { acquireInstanceLock, InstanceLockCollisionError } from "../infra/storage/instanceLock.ts";
import { setInkInstance } from "./utils/inkInstance.ts";

export async function startGordonTUI(): Promise<void> {
  loadLabsFlagsIntoEnv();

  const lock = process.stdout.isTTY ? acquireTuiLockOrExit() : null;
  if (lock) process.once("exit", () => lock.release());

  if (process.stdout.isTTY) {
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
