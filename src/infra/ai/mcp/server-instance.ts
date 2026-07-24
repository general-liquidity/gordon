/**
 * MCP Server Instance
 * Implementation of local MCP server process management
 */

import { spawn, type ChildProcess } from 'child_process';
import type {
  MCPServerManifest,
  MCPServerInstance,
  MCPServerStatus,
} from './types';
import { credentialManager } from './credentials';
import { wrapSandboxed } from '../../safety/subprocessSandbox.ts';

// ============================================================================
// Local Server Instance
// ============================================================================

/**
 * Local MCP server instance - manages a server running as a child process
 *
 * Communicates with the server via JSON-RPC over stdio.
 * Future enhancements:
 * - WebSocket transport
 * - HTTP transport
 * - Server-sent events
 */
export class LocalMCPServerInstance implements MCPServerInstance {
  manifest: MCPServerManifest;
  status: MCPServerStatus = 'stopped';
  error?: string;
  startedAt?: number;

  private process: ChildProcess | null = null;
  private requestId = 0;
  private pendingRequests = new Map<
    number,
    {
      resolve: (value: unknown) => void;
      reject: (error: Error) => void;
      timeout: ReturnType<typeof setTimeout>;
    }
  >();
  private messageBuffer = '';
  private readonly requestTimeout = 30000; // 30 seconds

  constructor(manifest: MCPServerManifest) {
    this.manifest = manifest;
  }

  /**
   * Start the server process
   */
  async start(): Promise<void> {
    if (this.status === 'running') {
      return;
    }

    if (!this.manifest.command) {
      throw new Error(
        `Server "${this.manifest.id}" has no command configured`
      );
    }

    this.status = 'starting';
    this.error = undefined;

    try {
      // Build environment with credentials
      const env = this.buildEnvironment();

      // Spawn the server process. shell:true is only needed on Windows
      // when the manifest.command is a shim (.cmd / .bat) — direct
      // executables (.exe, raw binaries) should NOT use shell to avoid
      // command-injection on whitespace and to keep the process tree clean.
      const cmdLower = this.manifest.command.toLowerCase();
      const isShim = cmdLower.endsWith(".cmd") || cmdLower.endsWith(".bat") || cmdLower.endsWith(".ps1");
      const looksLikeShimAlias = /^(npm|npx|bun|bunx|pnpm|yarn|node|deno)$/i.test(this.manifest.command);
      const needsShell = process.platform === "win32" && (isShim || looksLikeShimAlias);

      // Opt-in subprocess sandbox (no-op by default). When the operator sets
      // GORDON_SANDBOX_SUBPROCESS and a host sandbox tool (bwrap/sandbox-exec)
      // is available, this rewrites command/args to confine the child:
      // read-only filesystem except a temp work dir. Network is ALLOWED here —
      // most MCP servers call vendor APIs; flipping allowNetwork to false would
      // break every network MCP server. Filesystem is the primary confinement.
      // Disabled or unavailable → passthrough, byte-identical to the spawn above.
      const sandboxed = wrapSandboxed(this.manifest.command, this.manifest.args || [], {
        allowNetwork: true,
      });

      this.process = spawn(sandboxed.command, sandboxed.args, {
        env,
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: needsShell,
      });

      // Set up message handling
      this.setupMessageHandling();

      // Wait for initialization
      await this.waitForInitialization();

      this.status = 'running';
      this.startedAt = Date.now();
    } catch (err) {
      this.status = 'error';
      this.error = err instanceof Error ? err.message : String(err);
      await this.cleanup();
      throw err;
    }
  }

  /**
   * Stop the server process
   */
  async stop(): Promise<void> {
    if (this.status === 'stopped') {
      return;
    }

    await this.cleanup();
    this.status = 'stopped';
    this.startedAt = undefined;
  }

  /**
   * Call a tool on the server
   * @param toolName - Name of the tool to call
   * @param params - Parameters to pass to the tool
   * @returns Tool execution result
   */
  async callTool(toolName: string, params: unknown): Promise<unknown> {
    if (this.status !== 'running') {
      throw new Error(
        `Server "${this.manifest.id}" is not running (status: ${this.status})`
      );
    }

    // Validate tool exists
    const tool = this.manifest.tools.find((t) => t.name === toolName);
    if (!tool) {
      throw new Error(
        `Tool "${toolName}" not found on server "${this.manifest.id}"`
      );
    }

    // Send JSON-RPC request
    return this.sendRequest('tools/call', {
      name: toolName,
      arguments: params,
    });
  }

  /**
   * Build environment variables for the server process
   */
  private buildEnvironment(): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = { ...process.env };

    // Add manifest-defined environment variables
    if (this.manifest.env) {
      Object.assign(env, this.manifest.env);
    }

    // Add credentials to environment if needed
    const { authentication } = this.manifest;
    if (authentication.type === 'api_key' && authentication.envVar) {
      const apiKey = credentialManager.getWithFallback(
        this.manifest.id,
        'apiKey',
        authentication.envVar
      );
      if (apiKey) {
        env[authentication.envVar] = apiKey;
      }
    }

    return env;
  }

  /**
   * Set up message handling for the process
   */
  private setupMessageHandling(): void {
    if (!this.process) return;

    // Handle stdout (JSON-RPC messages)
    this.process.stdout?.on('data', (data: Buffer) => {
      this.messageBuffer += data.toString();
      this.processMessageBuffer();
    });

    // Handle stderr (logging)
    this.process.stderr?.on('data', (data: Buffer) => {
      // Log stderr output for debugging
      const message = data.toString().trim();
      if (message) {
        console.debug(`[MCP:${this.manifest.id}] ${message}`);
      }
    });

    // Handle process exit
    this.process.on('exit', (code, signal) => {
      if (this.status === 'running') {
        this.status = 'error';
        this.error = `Process exited unexpectedly (code: ${code}, signal: ${signal})`;
      }
      this.rejectAllPending(new Error(this.error || 'Process exited'));
    });

    // Handle process errors
    this.process.on('error', (err) => {
      this.status = 'error';
      this.error = err.message;
      this.rejectAllPending(err);
    });
  }

  /**
   * Process buffered messages
   */
  private processMessageBuffer(): void {
    // Split by newlines and process complete messages
    const lines = this.messageBuffer.split('\n');
    this.messageBuffer = lines.pop() || ''; // Keep incomplete line in buffer

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      try {
        const message = JSON.parse(trimmed);
        this.handleMessage(message);
      } catch {
        // Not a valid JSON message, ignore
        console.debug(`[MCP:${this.manifest.id}] Non-JSON: ${trimmed}`);
      }
    }
  }

  /**
   * Handle an incoming JSON-RPC message
   */
  private handleMessage(message: unknown): void {
    if (!message || typeof message !== 'object') return;

    const msg = message as Record<string, unknown>;

    // Handle response
    if ('id' in msg && 'result' in msg) {
      const pending = this.pendingRequests.get(msg.id as number);
      if (pending) {
        clearTimeout(pending.timeout);
        this.pendingRequests.delete(msg.id as number);
        pending.resolve(msg.result);
      }
      return;
    }

    // Handle error response
    if ('id' in msg && 'error' in msg) {
      const pending = this.pendingRequests.get(msg.id as number);
      if (pending) {
        clearTimeout(pending.timeout);
        this.pendingRequests.delete(msg.id as number);
        const error = msg.error as { message?: string };
        pending.reject(new Error(error?.message || 'Unknown error'));
      }
      return;
    }

    // Handle notifications (no id)
    // Future: emit events for notifications
  }

  /**
   * Send a JSON-RPC request and wait for response
   */
  private sendRequest(method: string, params: unknown): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (!this.process?.stdin) {
        reject(new Error('Process stdin not available'));
        return;
      }

      const id = ++this.requestId;
      const request = {
        jsonrpc: '2.0',
        id,
        method,
        params,
      };

      // Set up timeout
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`Request timeout: ${method}`));
      }, this.requestTimeout);

      // Store pending request
      this.pendingRequests.set(id, { resolve, reject, timeout });

      // Send request
      try {
        this.process.stdin.write(JSON.stringify(request) + '\n');
      } catch (err) {
        clearTimeout(timeout);
        this.pendingRequests.delete(id);
        reject(err);
      }
    });
  }

  /**
   * Wait for the server to initialize
   */
  private async waitForInitialization(): Promise<void> {
    // Send initialize request per MCP protocol
    const result = await this.sendRequest('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: {
        name: 'gordon',
        version: '0.5.0',
      },
    });

    // Send initialized notification
    if (this.process?.stdin) {
      const notification = {
        jsonrpc: '2.0',
        method: 'notifications/initialized',
      };
      this.process.stdin.write(JSON.stringify(notification) + '\n');
    }

    return result as void;
  }

  /**
   * Reject all pending requests
   */
  private rejectAllPending(error: Error): void {
    for (const [id, pending] of this.pendingRequests) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.pendingRequests.clear();
  }

  /**
   * Clean up the process
   */
  private async cleanup(): Promise<void> {
    this.rejectAllPending(new Error('Server stopped'));

    if (this.process) {
      // Try graceful shutdown first
      this.process.stdin?.end();

      // Give it a moment to exit gracefully
      await new Promise<void>((resolve) => {
        const timeout = setTimeout(() => {
          // Force kill if still running
          this.process?.kill('SIGKILL');
          resolve();
        }, 5000);

        this.process?.on('exit', () => {
          clearTimeout(timeout);
          resolve();
        });
      });

      this.process = null;
    }
  }
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create a new MCP server instance
 * @param manifest - Server manifest
 * @returns Server instance (not yet started)
 */
export function createServerInstance(
  manifest: MCPServerManifest
): MCPServerInstance {
  return new LocalMCPServerInstance(manifest);
}
