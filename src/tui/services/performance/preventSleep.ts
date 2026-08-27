// ============================================================================
// Prevent Sleep — Keeps machine awake during active trading
//
// macOS:   spawns `caffeinate -i`. Auto-restarts every 4 min.
// Linux:   spawns `systemd-inhibit` if available; falls back to no-op.
// Windows: uses PowerShell to set ES_SYSTEM_REQUIRED via SetThreadExecutionState.
// All paths are reference-counted and clean up on shutdown.
// ============================================================================

import { spawn, type ChildProcess } from "node:child_process";

let inhibitorProcess: ChildProcess | null = null;
let refCount = 0;
let restartInterval: ReturnType<typeof setInterval> | null = null;

function spawnInhibitor(): void {
  try {
    if (process.platform === "darwin") {
      inhibitorProcess = spawn("caffeinate", ["-i"], { stdio: "ignore", detached: true });
    } else if (process.platform === "linux") {
      // systemd-inhibit is part of systemd; falls back to no-op if absent.
      // The --who flag identifies us in the inhibitor list (loginctl list-inhibitors).
      inhibitorProcess = spawn(
        "systemd-inhibit",
        [
          "--what=idle:sleep",
          "--who=gordon",
          "--why=active-trading",
          "--mode=block",
          "sleep",
          "infinity",
        ],
        { stdio: "ignore", detached: true },
      );
      // If systemd-inhibit isn't installed, the spawn itself succeeds but
      // the process emits an error event. Treat that as a soft failure.
      inhibitorProcess.on("error", () => {
        inhibitorProcess = null;
      });
    } else if (process.platform === "win32") {
      // PowerShell call to SetThreadExecutionState via P/Invoke. Runs in a
      // detached PowerShell that holds the flag until killed.
      const psScript = `
        Add-Type -MemberDefinition '
          [DllImport("kernel32.dll", CharSet=CharSet.Auto, SetLastError=true)]
          public static extern uint SetThreadExecutionState(uint esFlags);
        ' -Name 'PowerSetting' -Namespace 'Win32' -PassThru | Out-Null
        # ES_CONTINUOUS | ES_SYSTEM_REQUIRED
        [Win32.PowerSetting]::SetThreadExecutionState(0x80000000 -bor 0x00000001) | Out-Null
        while ($true) { Start-Sleep -Seconds 60 }
      `;
      inhibitorProcess = spawn(
        "powershell.exe",
        ["-NoProfile", "-NonInteractive", "-Command", psScript],
        { stdio: "ignore", detached: true, windowsHide: true },
      );
      inhibitorProcess.on("error", () => {
        inhibitorProcess = null;
      });
    }
    if (inhibitorProcess) {
      inhibitorProcess.unref();
      inhibitorProcess.on("exit", () => {
        inhibitorProcess = null;
      });
    }
  } catch {
    inhibitorProcess = null;
  }
}

function killInhibitor(): void {
  if (inhibitorProcess) {
    try {
      inhibitorProcess.kill();
    } catch {
      // already dead
    }
    inhibitorProcess = null;
  }
}

export function startPreventSleep(): void {
  refCount++;
  if (refCount === 1) {
    spawnInhibitor();
    // Auto-restart every 4 minutes (before caffeinate's 5-min default
    // timeout). systemd-inhibit and the Windows PowerShell loop don't
    // need this but the restart is harmless.
    restartInterval = setInterval(
      () => {
        killInhibitor();
        spawnInhibitor();
      },
      4 * 60 * 1000,
    );
  }
}

export function stopPreventSleep(): void {
  refCount = Math.max(0, refCount - 1);
  if (refCount === 0) {
    killInhibitor();
    if (restartInterval) {
      clearInterval(restartInterval);
      restartInterval = null;
    }
  }
}

// Cleanup on exit
process.on("exit", killInhibitor);
