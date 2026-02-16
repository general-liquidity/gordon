import type { GatewayCommandEnvelope } from "../gateway/protocol/commands.ts";
import { createEnvelopeMeta } from "../gateway/protocol/envelope.ts";
import { getDefaultIpcPath, sendIpcCommand } from "../gateway/daemon/ipc.ts";

export interface GordonSDKClientOptions {
  token: string;
  sessionId?: string;
  socketPath?: string;
}

export function createGatewayMeta(sessionId: string) {
  return createEnvelopeMeta({
    sessionId,
    source: "agent",
    idempotencyKey: `sdk_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
  });
}

export class GordonSDKClient {
  private readonly token: string;
  private readonly sessionId: string;
  private readonly socketPath: string;

  constructor(options: GordonSDKClientOptions) {
    this.token = options.token;
    this.sessionId = options.sessionId ?? "sdk";
    this.socketPath = options.socketPath ?? getDefaultIpcPath();
  }

  async send(command: GatewayCommandEnvelope["command"]): Promise<unknown> {
    const response = await sendIpcCommand({
      socketPath: this.socketPath,
      request: {
        token: this.token,
        processImmediately: true,
        envelope: {
          meta: createGatewayMeta(this.sessionId),
          command,
        } as GatewayCommandEnvelope,
      },
    });

    if (!response.ok) {
      throw new Error(response.error?.message || "Gateway command failed.");
    }
    return response.data;
  }
}

export function createGordonSDKClient(options: GordonSDKClientOptions): GordonSDKClient {
  return new GordonSDKClient(options);
}

