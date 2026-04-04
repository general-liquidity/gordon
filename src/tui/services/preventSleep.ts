// ============================================================================
// Prevent Sleep — Keeps machine awake during active trading
//
// macOS: spawns caffeinate -i. Reference-counted start/stop.
// Auto-restarts every 4 minutes. No-op on non-macOS.
// ============================================================================

import { spawn, type ChildProcess } from "child_process";

let cafProcess: ChildProcess | null = null;
let refCount = 0;
let restartInterval: ReturnType<typeof setInterval> | null = null;

function spawnCaffeinate(): void {
  if (process.platform !== "darwin") return;
  try {
    cafProcess = spawn("caffeinate", ["-i"], { stdio: "ignore", detached: true });
    cafProcess.unref();
    cafProcess.on("exit", () => { cafProcess = null; });
  } catch {
    cafProcess = null;
  }
}

function killCaffeinate(): void {
  if (cafProcess) {
    cafProcess.kill();
    cafProcess = null;
  }
}

export function startPreventSleep(): void {
  refCount++;
  if (refCount === 1) {
    spawnCaffeinate();
    // Auto-restart every 4 minutes (before caffeinate's 5-min timeout)
    restartInterval = setInterval(() => {
      killCaffeinate();
      spawnCaffeinate();
    }, 4 * 60 * 1000);
  }
}

export function stopPreventSleep(): void {
  refCount = Math.max(0, refCount - 1);
  if (refCount === 0) {
    killCaffeinate();
    if (restartInterval) {
      clearInterval(restartInterval);
      restartInterval = null;
    }
  }
}

// Cleanup on exit
process.on("exit", killCaffeinate);
