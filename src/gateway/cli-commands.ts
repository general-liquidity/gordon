import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import type { ParsedCLICommand } from "../cli.ts";
import { createEnvelopeMeta } from "./protocol/envelope.ts";
import { GatewayCommandTypeSchema, type GatewayCommandType, type GatewayCommandEnvelope } from "./protocol/commands.ts";
import { getOrCreateDaemonToken } from "./security/auth.ts";
import { getDefaultIpcPath, isIpcDaemonReachable, sendIpcCommand } from "./daemon/ipc.ts";
import { startGatewayDaemonProcess } from "./daemon/process.ts";

async function waitForDaemon(timeoutMs: number = 60_000): Promise<boolean> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await isIpcDaemonReachable()) return true;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return false;
}

function buildSpawnArgs(): string[] {
  const scriptPath = process.argv[1];
  if (scriptPath) {
    return ["run", scriptPath, "daemon", "run"];
  }
  return ["run", "src/index.tsx", "daemon", "run"];
}

async function sendLocalCommand(commandType: GatewayCommandType, payload: Record<string, unknown>): Promise<void> {
  const token = await getOrCreateDaemonToken();
  const envelope: GatewayCommandEnvelope = {
    meta: createEnvelopeMeta({
      sessionId: "cli",
      source: "cli",
      idempotencyKey: `cli_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    }),
    command: {
      type: commandType,
      payload,
    } as GatewayCommandEnvelope["command"],
  };
  const response = await sendIpcCommand({
    request: {
      token,
      processImmediately: true,
      envelope,
    },
  });

  if (!response.ok) {
    throw new Error(response.error?.message || "Daemon command failed.");
  }

  if (response.data) {
    console.log(JSON.stringify(response.data, null, 2));
  } else {
    console.log("OK");
  }
}

async function runDaemonCommand(action: "start" | "run" | "stop" | "status"): Promise<void> {
  if (action === "start") {
    if (await isIpcDaemonReachable()) {
      console.log("Gordon daemon is already running.");
      return;
    }

    const child = spawn(process.execPath, buildSpawnArgs(), {
      detached: true,
      stdio: "ignore",
      env: {
        ...process.env,
        GORDON_DAEMON_MODE: "1",
      },
    });
    child.unref();

    const ready = await waitForDaemon();
    if (!ready) {
      throw new Error("Timed out waiting for daemon to start.");
    }
    console.log(`Gordon daemon started on ${getDefaultIpcPath()}`);
    return;
  }

  if (action === "run") {
    const handle = await startGatewayDaemonProcess();
    console.log(`Gordon daemon running on ${handle.socketPath}`);
    console.log("Press Ctrl+C to stop.");

    let stopping = false;
    const stop = async (): Promise<void> => {
      if (stopping) return;
      stopping = true;
      await handle.stop();
      process.exit(0);
    };

    process.on("SIGINT", () => {
      stop().catch((err) => {
        console.error("Failed to stop daemon:", err);
        process.exit(1);
      });
    });
    process.on("SIGTERM", () => {
      stop().catch((err) => {
        console.error("Failed to stop daemon:", err);
        process.exit(1);
      });
    });

    await new Promise<void>(() => {
      // Keep process alive while daemon services run.
    });
  }

  if (action === "status") {
    const reachable = await isIpcDaemonReachable();
    if (!reachable) {
      console.log("Gordon daemon is not running.");
      return;
    }
    console.log(`Gordon daemon is running on ${getDefaultIpcPath()}`);
    try {
      await sendLocalCommand("scheduler.list_tasks", {});
    } catch (error) {
      console.warn("Daemon reachable but status query failed:", error);
    }
    return;
  }

  if (!(await isIpcDaemonReachable())) {
    console.log("Gordon daemon is not running.");
    return;
  }

  await sendLocalCommand("daemon.shutdown", { reason: "CLI stop command" });
  console.log("Shutdown command sent to daemon.");
}

async function runScheduleCommand(
  action: "add" | "remove" | "list",
  args: string[],
): Promise<void> {
  if (!(await isIpcDaemonReachable())) {
    throw new Error("Daemon is not running. Start it first with `gordon daemon start`.");
  }

  if (action === "list") {
    await sendLocalCommand("scheduler.list_tasks", {});
    return;
  }

  if (action === "remove") {
    const taskId = args[0];
    if (!taskId) {
      throw new Error("Usage: gordon schedule remove <taskId>");
    }
    await sendLocalCommand("scheduler.delete_task", { taskId });
    return;
  }

  const [taskId, cronExpr, commandType, payloadJson] = args;
  if (!taskId || !cronExpr || !commandType) {
    throw new Error(
      "Usage: gordon schedule add <taskId> <cronExpr> <commandType> [payloadJson]\n" +
        "Example: gordon schedule add scan4h '@every 4h' scan.run '{\"topN\":50}'",
    );
  }

  let payload: Record<string, unknown> = {};
  if (payloadJson) {
    payload = JSON.parse(payloadJson) as Record<string, unknown>;
  }

  const parsedType = GatewayCommandTypeSchema.safeParse(commandType);
  if (!parsedType.success) {
    throw new Error(`Invalid commandType: ${commandType}`);
  }

  await sendLocalCommand("scheduler.create_task", {
    taskId,
    cron: cronExpr,
    commandType: parsedType.data,
    payload,
    enabled: true,
  });
}

async function runInitCommand(args: string[]): Promise<void> {
  const target = resolve(args[0] || "gordon-agent");
  if (existsSync(target)) {
    throw new Error(`Target directory already exists: ${target}`);
  }

  await mkdir(target, { recursive: true });
  await mkdir(join(target, "src"), { recursive: true });

  const pkg = {
    name: "gordon-agent",
    private: true,
    type: "module",
    scripts: {
      start: "bun run src/index.ts",
    },
    dependencies: {
      "@general-liquidity/gordon-cli": "latest",
    },
  };

  const source = `console.log("Gordon Agent Project Ready");
console.log("Next steps:");
console.log("1. Ensure gordon daemon is running");
console.log("2. Connect to local IPC and send typed gateway commands");
`;

  await writeFile(join(target, "package.json"), JSON.stringify(pkg, null, 2), "utf-8");
  await writeFile(join(target, "src", "index.ts"), source, "utf-8");

  console.log(`Initialized Gordon agent project at ${target}`);
}

export async function runCLICommand(command: ParsedCLICommand): Promise<void> {
  if (command.name === "daemon") {
    await runDaemonCommand(command.action);
    return;
  }

  if (command.name === "schedule") {
    await runScheduleCommand(command.action, command.args);
    return;
  }

  if (command.name === "init") {
    await runInitCommand(command.args);
    return;
  }
}
