/**
 * Start the real gateway daemon in validation-only mode, authenticate over its
 * real IPC transport, run a health command, stop it and prove the endpoint is
 * gone. No model or venue is resolved in this mode.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CHILD_FLAG = "GORDON_DAEMON_VALIDATION_CHILD";
const ROOT_ENV = "GORDON_DAEMON_VALIDATION_ROOT";

async function runValidationChild(root: string): Promise<void> {
  const socketPath =
    process.platform === "win32"
      ? `\\\\.\\pipe\\gordon-daemon-validation-${process.pid}-${Date.now()}`
      : join(root, "daemon.sock");

  // These must be set before importing any Gordon module because GORDON_DIR
  // is resolved at module initialization.
  process.env.GORDON_HOME = root;
  process.env.GORDON_EXTERNAL_HOOK_RUNNER = "0";
  process.env.GORDON_PERMISSION_MODE = "strict";
  process.env.GORDON_RISK_MODE = "paper";
  process.env.GORDON_EVAL_SANDBOX = "1";

  let daemon: Awaited<
    ReturnType<typeof import("../../../src/gateway/daemon/process.ts")["startGatewayDaemonProcess"]>
  > | null = null;

  try {
    const [
      { startGatewayDaemonProcess },
      { sendIpcCommand, isIpcDaemonReachable },
      protocol,
      { getSchedulerTask, upsertSchedulerTask },
    ] = await Promise.all([
      import("../../../src/gateway/daemon/process.ts"),
      import("../../../src/gateway/daemon/ipc.ts"),
      import("../../../src/gateway/protocol/index.ts"),
      import("../../../src/gateway/store/scheduler-store.ts"),
    ]);

    upsertSchedulerTask({
      taskId: "__validation_must_not_run",
      cronExpr: "@every 30s",
      commandType: "daemon.shutdown",
      payload: {},
      enabled: true,
      nextRunAt: new Date(0).toISOString(),
    });

    daemon = await startGatewayDaemonProcess({ validationOnly: true, socketPath });
    if (!(await isIpcDaemonReachable(socketPath))) {
      throw new Error("Daemon IPC endpoint was not reachable after startup");
    }

    const response = await sendIpcCommand({
      socketPath,
      timeoutMs: 10_000,
      request: {
        token: daemon.authToken,
        processImmediately: true,
        envelope: {
          meta: protocol.createEnvelopeMeta({
            sessionId: "daemon-validation",
            source: "cli",
          }),
          command: { type: "runtime.health_check", payload: { aggressive: false } },
        },
      },
    });
    if (!response.ok) {
      throw new Error(
        `Daemon health command failed: ${response.error?.message ?? "unknown error"}`,
      );
    }
    const healthTask = getSchedulerTask("__health_check");
    const hostileTask = getSchedulerTask("__validation_must_not_run");
    if (!healthTask?.lastRunAt || hostileTask?.lastRunAt) {
      throw new Error("Validation scheduler did not isolate the health task from persisted work");
    }

    await daemon.stop();
    daemon = null;
    if (await isIpcDaemonReachable(socketPath)) {
      throw new Error("Daemon IPC endpoint remained reachable after stop");
    }

    console.log(
      JSON.stringify({
        status: "pass",
        validationOnly: true,
        modelInference: false,
        venueResolved: false,
        orderDispatch: false,
        healthOk: true,
        schedulerHealthRan: true,
        persistedTaskSuppressed: true,
        stoppedCleanly: true,
      }),
    );
  } finally {
    if (daemon) await daemon.stop().catch(() => undefined);
  }
}

async function runParent(): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), "gordon-daemon-validation-"));
  try {
    const child = Bun.spawn([process.execPath, import.meta.path], {
      cwd: process.cwd(),
      env: { ...process.env, [CHILD_FLAG]: "1", [ROOT_ENV]: root },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [exitCode, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    if (stdout) process.stdout.write(stdout);
    if (stderr) process.stderr.write(stderr);
    if (exitCode !== 0) throw new Error(`Daemon validation child exited ${exitCode}`);
  } finally {
    // SQLite handles belong to the child. Deleting from the parent after the
    // child exits avoids Windows' mandatory-locking race during teardown.
    rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}

if (process.env[CHILD_FLAG] === "1") {
  const root = process.env[ROOT_ENV];
  if (!root) throw new Error(`${ROOT_ENV} is required in validation child mode`);
  await runValidationChild(root);
} else {
  await runParent();
}
