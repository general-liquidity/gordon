import net from "node:net";
import { unlink } from "node:fs/promises";
import { createModuleLogger } from "../../infra/logger/index.ts";
import { GORDON_DIR } from "../../infra/storage/paths.ts";
import type { GatewayRuntime } from "../runtime/gateway-runtime.ts";
import type { GatewayCommandEnvelope } from "../protocol/commands.ts";

const logger = createModuleLogger("gateway-ipc");

export interface GatewayIPCRequest {
  token?: string;
  envelope: GatewayCommandEnvelope;
  processImmediately?: boolean;
}

export interface GatewayIPCResponse {
  ok: boolean;
  correlationId: string;
  queueId?: number;
  data?: unknown;
  error?: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
    retryable?: boolean;
  };
}

export function getDefaultIpcPath(): string {
  if (process.platform === "win32") {
    return "\\\\.\\pipe\\gordon-daemon";
  }
  return `${GORDON_DIR}/daemon.sock`;
}

export async function startGatewayIpcServer(input: {
  runtime: GatewayRuntime;
  socketPath?: string;
}): Promise<{
  socketPath: string;
  close: () => Promise<void>;
}> {
  const socketPath = input.socketPath ?? getDefaultIpcPath();
  if (process.platform !== "win32") {
    try {
      await unlink(socketPath);
    } catch {
      // Ignore missing socket
    }
  }

  const server = net.createServer((socket) => {
    socket.setEncoding("utf8");
    let buffer = "";

    socket.on("data", async (chunk: string) => {
      buffer += chunk;
      while (true) {
        const idx = buffer.indexOf("\n");
        if (idx === -1) break;
        const line = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 1);
        if (!line) continue;

        let request: GatewayIPCRequest;
        try {
          request = JSON.parse(line) as GatewayIPCRequest;
        } catch {
          const response: GatewayIPCResponse = {
            ok: false,
            correlationId: "n/a",
            error: {
              code: "VALIDATION_ERROR",
              message: "Invalid JSON request.",
            },
          };
          socket.write(`${JSON.stringify(response)}\n`);
          continue;
        }

        try {
          const result = await input.runtime.submitCommand(request.envelope, {
            token: request.token,
            processImmediately: request.processImmediately ?? true,
          });
          socket.write(`${JSON.stringify(result)}\n`);
        } catch (error) {
          const response: GatewayIPCResponse = {
            ok: false,
            correlationId: request.envelope?.meta?.correlationId ?? "n/a",
            error: {
              code: "INTERNAL_ERROR",
              message: error instanceof Error ? error.message : String(error),
            },
          };
          socket.write(`${JSON.stringify(response)}\n`);
        }
      }
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(socketPath, () => {
      server.off("error", reject);
      resolve();
    });
  });

  logger.info("Gateway IPC server started", { socketPath });

  return {
    socketPath,
    close: async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
      if (process.platform !== "win32") {
        try {
          await unlink(socketPath);
        } catch {
          // Ignore cleanup errors
        }
      }
      logger.info("Gateway IPC server stopped", { socketPath });
    },
  };
}

export async function sendIpcCommand(input: {
  request: GatewayIPCRequest;
  socketPath?: string;
  timeoutMs?: number;
}): Promise<GatewayIPCResponse> {
  const socketPath = input.socketPath ?? getDefaultIpcPath();
  const timeoutMs = input.timeoutMs ?? 10_000;

  return new Promise<GatewayIPCResponse>((resolve, reject) => {
    const client = net.createConnection(socketPath);
    client.setEncoding("utf8");
    client.setTimeout(timeoutMs);

    let buffer = "";
    client.on("connect", () => {
      client.write(`${JSON.stringify(input.request)}\n`);
    });
    client.on("data", (chunk: string) => {
      buffer += chunk;
      const idx = buffer.indexOf("\n");
      if (idx === -1) return;
      const line = buffer.slice(0, idx).trim();
      client.end();
      try {
        resolve(JSON.parse(line) as GatewayIPCResponse);
      } catch (error) {
        reject(error);
      }
    });
    client.on("timeout", () => {
      client.destroy();
      reject(new Error("IPC request timed out."));
    });
    client.on("error", reject);
  });
}

export async function isIpcDaemonReachable(socketPath?: string): Promise<boolean> {
  const path = socketPath ?? getDefaultIpcPath();
  return new Promise<boolean>((resolve) => {
    const client = net.createConnection(path);
    client.on("connect", () => {
      client.end();
      resolve(true);
    });
    client.on("error", () => resolve(false));
  });
}

