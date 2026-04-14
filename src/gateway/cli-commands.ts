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
import {
  applyBootstrap,
  collectDoctorReport,
  doctorReportToJson,
  formatDoctorReport,
  parseBootstrapArgs,
} from "../app/setup-runtime.ts";
import { parseSetupWizardSection } from "../app/setup-flow.ts";

export interface CLICommandResult {
  exit: boolean;
  code?: number;
}

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

    // Detached spawn semantics differ between Windows and POSIX:
    //   POSIX: detached:true makes the child a process group leader so
    //          Ctrl+C in the parent doesn't kill it.
    //   Windows: detached:true on Windows requires windowsHide:true to
    //          actually run hidden — otherwise a console window flashes.
    const isWindows = process.platform === "win32";
    const child = spawn(process.execPath, buildSpawnArgs(), {
      detached: true,
      stdio: "ignore",
      windowsHide: isWindows,
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
  const name = args[0] || "gordon-agent";
  const target = resolve(name);
  if (existsSync(target)) {
    throw new Error(`Target directory already exists: ${target}`);
  }

  // Parse flags
  let template: "agent" | "strategy" = "agent";
  let pm: "bun" | "npm" = "bun";
  for (let i = 1; i < args.length; i++) {
    if (args[i] === "--template" && args[i + 1]) {
      const val = args[i + 1];
      if (val === "agent" || val === "strategy") template = val;
      i++;
    }
    if (args[i] === "--pm" && args[i + 1]) {
      const val = args[i + 1];
      if (val === "bun" || val === "npm") pm = val;
      i++;
    }
  }

  const { scaffoldProject } = await import("../sdk/scaffold.ts");
  const created = await scaffoldProject(target, { name, template, packageManager: pm });

  console.log(`\nInitialized Gordon ${template} project at ${target}\n`);
  console.log("Created files:");
  for (const file of created) {
    console.log(`  ${file}`);
  }
  console.log(`\nNext steps:`);
  console.log(`  cd ${name}`);
  console.log(`  ${pm === "bun" ? "bun" : "npm"} install`);
  console.log(`  cp .env.example .env  # add your daemon auth token`);
  console.log(`  gordon daemon start   # ensure daemon is running`);
  console.log(`  ${pm === "bun" ? "bun run" : "npx tsx"} src/index.ts`);
}

export async function runCLICommand(command: ParsedCLICommand): Promise<CLICommandResult> {
  if (command.name === "daemon") {
    await runDaemonCommand(command.action);
    return { exit: true };
  }

  if (command.name === "schedule") {
    await runScheduleCommand(command.action, command.args);
    return { exit: true };
  }

  if (command.name === "init") {
    await runInitCommand(command.args);
    return { exit: true };
  }

  if (command.name === "doctor") {
    const report = await collectDoctorReport();
    if (command.args.includes("--json")) {
      console.log(JSON.stringify(doctorReportToJson(report), null, 2));
    } else {
      console.log(formatDoctorReport(report));
    }
    return { exit: true };
  }

  if (command.name === "configure") {
    const requested = command.args[0]?.toLowerCase();
    if (requested === "quickstart") {
      process.env.GORDON_START_VIEW = "quickstart";
      process.env.GORDON_SETUP_MODE = "quickstart";
      delete process.env.GORDON_SETUP_SECTION;
      return { exit: false };
    }

    const section = parseSetupWizardSection(requested);
    process.env.GORDON_START_VIEW = "setup";
    process.env.GORDON_SETUP_MODE = section ? "configure" : "advanced";
    if (section) {
      process.env.GORDON_SETUP_SECTION = section;
    } else {
      delete process.env.GORDON_SETUP_SECTION;
    }
    return { exit: false };
  }

  if (command.name === "bootstrap") {
    const options = parseBootstrapArgs(command.args);
    const result = await applyBootstrap(options);
    if (options.json) {
      console.log(JSON.stringify({
        summary: result.summary,
        savedEnvKeys: result.savedEnvKeys,
        keyringStoredKeys: result.keyringStoredKeys,
        doctor: result.doctor ? doctorReportToJson(result.doctor) : null,
      }, null, 2));
    } else {
      console.log(result.summary.join("\n"));
      if (result.doctor) {
        console.log("");
        console.log(formatDoctorReport(result.doctor));
      }
    }
    return { exit: true };
  }

  return { exit: true };
}
