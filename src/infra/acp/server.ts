/**
 * Agent Client Protocol (ACP) server adapter.
 *
 * Lets Gordon appear in Zed's Agent Panel, Athas's External Agents panel,
 * and any other ACP host (50+ agents currently registered at
 * https://agentclientprotocol.com/get-started/registry).
 *
 * Architecture (per https://agentclientprotocol.com/get-started/architecture):
 *
 *   - The editor (Zed/Athas) spawns this process as a SUBPROCESS
 *   - Communication is JSON-RPC 2.0 over stdio (stdin/stdout reserved
 *     for protocol; stderr is free for diagnostic logging)
 *   - Editor is the CLIENT; Gordon is the AGENT (server)
 *   - The protocol is bidirectional — agent can call back to the client
 *     for filesystem access, terminal operations, permission requests
 *
 * What Gordon implements:
 *
 *   Required Agent methods (per @agentclientprotocol/sdk):
 *     - initialize         capability + version negotiation
 *     - authenticate       no-op (Gordon uses env-based provider keys)
 *     - newSession         create a fresh session
 *     - prompt             stream the response to the user's message
 *
 *   Optional Agent methods:
 *     - setSessionMode     not implemented in v1
 *     - cancel             best-effort abort via AbortController
 *
 *   Notifications Gordon emits during a prompt turn:
 *     - session/update agent_message_chunk    streamed LLM text deltas
 *     - (v2) tool_call + tool_call_update      when wired to processMessageStream
 *
 * Capabilities Gordon declares to the client:
 *
 *   - loadSession: false (v1: in-memory only, no persistence)
 *   - promptCapabilities.image: false (v1: text-only)
 *   - promptCapabilities.audio: false
 *   - promptCapabilities.embeddedContext: true (Gordon happily consumes
 *     file context the editor embeds in the prompt)
 *   - mcpCapabilities.http: true (Gordon can consume MCP-over-HTTP if
 *     the editor forwards configured MCP servers per ACP spec)
 *   - mcpCapabilities.sse: true
 *
 * Composes with the existing safety stack:
 *
 *   - withResultSanitizer (commit 51b9d0f6) strips injection patterns
 *     from any text content emitted through Gordon's tools — applies
 *     because the underlying LLM client still routes through Gordon's
 *     wrappers.
 *   - The ACP protocol's own permission flow (session/request_permission)
 *     would map to Gordon's riskClassifier + trustTrajectory in a future
 *     iteration when tool calls are bridged.
 *
 * V1 scope:
 *
 *   - Speaks ACP correctly (initialize / newSession / prompt / cancel)
 *   - Streams LLM text via session/update agent_message_chunk
 *   - Returns end_turn on completion, cancelled on abort
 *
 * V2 (deferred):
 *
 *   - Wire to processMessageStream from orchestrator.ts (the full
 *     multi-agent loop with tools, handoffs, permission gates)
 *   - Map Gordon's tool calls to ACP tool_call notifications
 *   - Map Gordon's safety stack to session/request_permission
 *   - Session persistence (loadSession capability)
 *   - Image/embedded-context handling
 */

import {
  AgentSideConnection,
  ndJsonStream,
  PROTOCOL_VERSION,
  type Agent,
  type InitializeRequest,
  type InitializeResponse,
  type AuthenticateRequest,
  type AuthenticateResponse,
  type NewSessionRequest,
  type NewSessionResponse,
  type PromptRequest,
  type PromptResponse,
  type CancelNotification,
  type SetSessionModeRequest,
  type SetSessionModeResponse,
  type LoadSessionRequest,
  type LoadSessionResponse,
} from "@agentclientprotocol/sdk";
import { Readable, Writable } from "node:stream";
import { processMessageStream } from "../agents/orchestrator.ts";
import { getAcpGordonContext } from "./context.ts";
import { StreamTranslator } from "./stream-translator.ts";
import {
  appendSessionTurn,
  loadSessionTurns,
  sessionExists,
} from "./sessions.ts";
import {
  captureSessionMcpServers,
  dropSessionMcpServers,
} from "./mcp-bridge.ts";
import {
  resetSessionUsage,
  dropSessionUsage,
  emitUsageUpdate,
} from "./usage-tracker.ts";
import {
  extractMultimodalPrompt,
  type MultimodalAttachment,
} from "./content-translator.ts";
import { installAcpPermissionHook } from "./permission-hook.ts";
import { probeBudgetHalt, budgetSignalToStopReason } from "./token-budget.ts";
import {
  createAcpMcpClient,
  closeAcpMcpClient,
  getAcpMcpClient,
} from "./mcp-spinup.ts";
import { getSessionMcpServers } from "./mcp-bridge.ts";
import { renderInlineTextPrompt, resolveVisionPath } from "./llm-vision.ts";

// ---------------------------------------------------------------------------
// Session state
// ---------------------------------------------------------------------------

interface SessionState {
  /** Abort controller for the currently-running prompt, if any. */
  pendingPrompt: AbortController | null;
  /** Conversation history — accumulated across prompts in the same session. */
  history: Array<{ role: "user" | "assistant"; content: string }>;
}

// ---------------------------------------------------------------------------
// Gordon-side prompt processing
// ---------------------------------------------------------------------------

/**
 * Result of a prompt turn from the handler's perspective. Holds the
 * stop reason + the assistant text that should be persisted to session
 * history. Notifications are sent by the handler directly via the
 * AgentSideConnection passed in.
 */
export interface PromptHandlerResult {
  stopReason: "end_turn" | "cancelled" | "refusal";
  assistantText: string;
  /** Optional token delta for the turn — emitted as usage_update when present. */
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens?: number;
    costUsd?: number;
  };
}

/**
 * Handler for a single prompt turn. Implementations call
 * `connection.sessionUpdate(...)` for each notification they want to
 * emit, and return the stop reason + accumulated assistant text.
 *
 * Production wires this to `processMessageStream` + `StreamTranslator`
 * (defaultPromptHandler below). Tests inject simpler handlers that
 * exercise specific protocol paths without spinning up the orchestrator.
 */
export type PromptHandler = (args: {
  sessionId: string;
  prompt: string;
  /** Non-text attachments (image/audio/resource) from the multimodal prompt. */
  attachments?: MultimodalAttachment[];
  history: Array<{ role: "user" | "assistant"; content: string }>;
  signal: AbortSignal;
  connection: AgentSideConnection;
}) => Promise<PromptHandlerResult>;

/**
 * Default production prompt handler.
 *
 * Routes through Gordon's full multi-agent orchestrator
 * (processMessageStream) so the ACP-spawned Gordon gets:
 *   - executor + researcher agent handoffs
 *   - tool calls with permission flow
 *   - thinking phase
 *   - cost tracking
 *   - all middleware (compaction, guardrails, etc.)
 *
 * Each StreamEvent translates to one or more ACP notifications via
 * StreamTranslator. Terminal events (done / cancelled / error) end the
 * loop with the matching stop reason.
 */
function defaultPromptHandler(): PromptHandler {
  return async function defaultHandler({
    sessionId,
    prompt,
    history: _history,
    signal,
    connection,
  }): Promise<PromptHandlerResult> {
    const context = await getAcpGordonContext();
    // Use the ACP sessionId as the Mastra threadId so conversations
    // resume correctly when loadSession is honored.
    const threadId = `acp-${sessionId}`;
    const resourceId = `acp-${sessionId}`;
    const translator = new StreamTranslator();
    let assistantText = "";
    let stopReason: PromptHandlerResult["stopReason"] = "end_turn";

    try {
      for await (const event of processMessageStream(prompt, context, threadId, resourceId, { signal })) {
        if (signal.aborted) {
          stopReason = "cancelled";
          break;
        }
        const translated = translator.translate(event);
        for (const update of translated.updates) {
          await connection.sessionUpdate({
            sessionId,
            update: update as Parameters<typeof connection.sessionUpdate>[0]["update"],
          });
        }
        if (translated.textForHistory) assistantText += translated.textForHistory;
        if (translated.stop) {
          stopReason = translated.stop;
          break;
        }
      }
    } catch (err) {
      if (signal.aborted) {
        stopReason = "cancelled";
      } else {
        const msg = err instanceof Error ? err.message : String(err);
        await connection.sessionUpdate({
          sessionId,
          update: {
            sessionUpdate: "agent_message_chunk",
            content: { type: "text", text: `[gordon error] ${msg}` },
          },
        });
        stopReason = "refusal";
      }
    }

    return { stopReason, assistantText };
  };
}

// ---------------------------------------------------------------------------
// GordonAcpAgent — the Agent interface implementation
// ---------------------------------------------------------------------------

export interface GordonAcpAgentOptions {
  /** Override the default prompt handler — useful for tests. */
  promptHandler?: PromptHandler;
  /** Override the connection — also for tests. */
  connection?: AgentSideConnection;
}

export class GordonAcpAgent implements Agent {
  private readonly connection: AgentSideConnection;
  private readonly promptHandler: PromptHandler;
  private readonly sessions = new Map<string, SessionState>();

  constructor(connection: AgentSideConnection, options: GordonAcpAgentOptions = {}) {
    this.connection = connection;
    this.promptHandler = options.promptHandler ?? defaultPromptHandler();
  }

  async initialize(_params: InitializeRequest): Promise<InitializeResponse> {
    // v3 surface: enable image/audio prompt items so the editor will
    // forward them — Gordon collects them via `extractMultimodalPrompt`
    // and surfaces them to handlers as `attachments`. Full vision-LLM
    // wiring is downstream of the handler signature, not the protocol
    // declaration.
    return {
      protocolVersion: PROTOCOL_VERSION,
      agentCapabilities: {
        loadSession: true,
        promptCapabilities: {
          image: true,
          audio: true,
          embeddedContext: true,
        },
        mcpCapabilities: {
          http: true,
          sse: true,
        },
      },
      authMethods: [],
    };
  }

  async authenticate(_params: AuthenticateRequest): Promise<AuthenticateResponse> {
    // Gordon authenticates via env-based provider keys (ANTHROPIC_API_KEY,
    // OPENAI_API_KEY, DEDALUS_API_KEY, etc.) — set by the operator outside
    // the ACP session. No interactive auth from the editor side.
    return {};
  }

  async newSession(params: NewSessionRequest): Promise<NewSessionResponse> {
    const sessionId = newSessionId();
    this.sessions.set(sessionId, {
      pendingPrompt: null,
      history: [],
    });
    // v3: capture editor-forwarded MCP servers + reset per-session usage
    captureSessionMcpServers(sessionId, params.mcpServers);
    resetSessionUsage(sessionId);
    // v3.5: spin up Mastra MCP client for the forwarded servers so tools
    // are discovered. Tool registration with the executor agent is v3.6
    // (requires dynamic-tool-registry support on the Mastra agent
    // wrapper). The client is held per session and torn down on close.
    const forwarded = getSessionMcpServers(sessionId);
    if (forwarded.length > 0) {
      // fire-and-forget — failure during MCP spin-up shouldn't block
      // newSession from completing; the agent still runs with native tools.
      void createAcpMcpClient(sessionId, forwarded);
    }
    return { sessionId };
  }

  async loadSession(params: LoadSessionRequest): Promise<LoadSessionResponse> {
    // V2: rehydrate session history from disk so the editor's session
    // chooser can resume conversations across process restarts.
    if (!sessionExists(params.sessionId)) {
      throw new Error(`Session ${params.sessionId} not found on disk`);
    }
    const turns = loadSessionTurns(params.sessionId);
    this.sessions.set(params.sessionId, {
      pendingPrompt: null,
      history: turns.map((t) => ({ role: t.role, content: t.content })),
    });
    // v3: capture forwarded MCP servers + reset usage on resumed session
    captureSessionMcpServers(params.sessionId, params.mcpServers);
    resetSessionUsage(params.sessionId);
    // v3.5: spin up MCP client for the (possibly different) forwarded set
    const forwarded = getSessionMcpServers(params.sessionId);
    if (forwarded.length > 0) {
      void createAcpMcpClient(params.sessionId, forwarded);
    }
    return {};
  }

  async setSessionMode(_params: SetSessionModeRequest): Promise<SetSessionModeResponse> {
    // V1: no mode switching. Returning empty object is the SDK's "noop"
    // contract per the agent example.
    return {};
  }

  async prompt(params: PromptRequest): Promise<PromptResponse> {
    const session = this.sessions.get(params.sessionId);
    if (!session) {
      throw new Error(`Unknown sessionId: ${params.sessionId}`);
    }

    // Abort any in-flight prompt for this session (replaced by this one)
    session.pendingPrompt?.abort();
    const controller = new AbortController();
    session.pendingPrompt = controller;

    // v3: extract multimodal content — text + image/audio/resource attachments
    const multimodal = extractMultimodalPrompt(params);
    // v3.5: vision-LLM routing — inline-text mode wraps attachments as
    // textual descriptors prepended to the prompt. content-block mode
    // (deferred to v3.6) passes attachments verbatim to vision LLMs.
    const visionPath = resolveVisionPath();
    const promptText =
      visionPath === "inline"
        ? renderInlineTextPrompt(multimodal.text, multimodal.attachments)
        : multimodal.text;
    const userTurn = { role: "user" as const, content: promptText };

    // v3.5: token-budget probe at turn entry — if the cost tracker
    // signals halt before the LLM even runs, return the appropriate
    // stop reason without consuming budget.
    const preTurnBudget = await probeBudgetHalt();
    if (preTurnBudget.halt) {
      const budgetStop = budgetSignalToStopReason(preTurnBudget);
      if (budgetStop) {
        return { stopReason: budgetStop };
      }
    }

    // v3.5: install ACP permission hook so non-safety-critical tool
    // gates surface as interactive editor prompts. Uninstalled in
    // finally to avoid leaking across sessions.
    let uninstallPermissionHook: (() => void) | null = null;
    try {
      const mod = await import("../../runtime/permissions/defaultPermissionEngine.ts");
      const engine = mod.getDefaultPermissionEngine();
      if (engine && typeof (engine as { prependHook?: unknown }).prependHook === "function") {
        uninstallPermissionHook = installAcpPermissionHook(
          engine as Parameters<typeof installAcpPermissionHook>[0],
          { sessionId: params.sessionId, connection: this.connection },
        );
      }
    } catch {
      // PermissionEngine not initialized in this process (test mode etc.) — skip
    }

    try {
      const result = await this.promptHandler({
        sessionId: params.sessionId,
        prompt: promptText,
        attachments: multimodal.attachments,
        history: session.history,
        signal: controller.signal,
        connection: this.connection,
      });

      // Persist + update in-memory only on non-cancelled completion;
      // cancelled turns are dropped so re-prompting starts fresh.
      if (result.stopReason !== "cancelled") {
        const assistantTurn = { role: "assistant" as const, content: result.assistantText };
        session.history.push(userTurn);
        session.history.push(assistantTurn);
        const ts = Date.now();
        appendSessionTurn(params.sessionId, { ...userTurn, ts });
        appendSessionTurn(params.sessionId, { ...assistantTurn, ts });
      }

      // v3: emit usage_update if the handler reported token deltas
      if (result.usage) {
        try {
          await emitUsageUpdate(this.connection, params.sessionId, result.usage);
        } catch {
          // Non-fatal — usage tracking shouldn't break the turn
        }
      }

      // v3.5: post-turn budget probe — if the cost tracker signaled
      // halt during the turn, override end_turn with max_tokens.
      if (result.stopReason === "end_turn") {
        const postTurnBudget = await probeBudgetHalt();
        if (postTurnBudget.halt) {
          const budgetStop = budgetSignalToStopReason(postTurnBudget);
          if (budgetStop) {
            return { stopReason: budgetStop };
          }
        }
      }

      return { stopReason: result.stopReason };
    } finally {
      if (session.pendingPrompt === controller) {
        session.pendingPrompt = null;
      }
      if (uninstallPermissionHook) {
        try { uninstallPermissionHook(); } catch { /* non-fatal */ }
      }
    }
  }

  async cancel(params: CancelNotification): Promise<void> {
    const session = this.sessions.get(params.sessionId);
    session?.pendingPrompt?.abort();
  }
}

// ---------------------------------------------------------------------------
// Re-exports — v3 + v3.5 surface used by tests + downstream callers
// ---------------------------------------------------------------------------

export { requestAcpPermission, type GordonAcpPermissionVerdict } from "./permission-bridge.ts";
export { emitUsageUpdate, getSessionUsage, resetSessionUsage } from "./usage-tracker.ts";
export { captureSessionMcpServers, getSessionMcpServers } from "./mcp-bridge.ts";
export { readTextFileViaAcp, writeTextFileViaAcp } from "./fs-bridge.ts";
export { extractMultimodalPrompt, type MultimodalAttachment } from "./content-translator.ts";
// v3.5
export { installAcpPermissionHook } from "./permission-hook.ts";
export { probeBudgetHalt, budgetSignalToStopReason } from "./token-budget.ts";
export { createAcpMcpClient, getAcpMcpClient, closeAcpMcpClient, listAcpMcpTools } from "./mcp-spinup.ts";
export {
  resolveVisionPath,
  renderInlineTextPrompt,
  describeAttachment,
  toAnthropicContentBlocks,
  toOpenAIContentParts,
  VISION_PATH_ENV,
  type VisionPath,
  type AnthropicContentBlock,
  type OpenAIContentPart,
} from "./llm-vision.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Generate a fresh session id — 32 hex chars (16 bytes). Per the SDK
 * example reference implementation.
 */
function newSessionId(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// v3: extractPromptText replaced by extractMultimodalPrompt (re-exported above).
// The wrapper-and-flatten path still exists internally via the
// MultimodalPrompt.text field returned from extractMultimodalPrompt.

// ---------------------------------------------------------------------------
// Entry point — for the `gordon acp` CLI / `bun run` invocation
// ---------------------------------------------------------------------------

/**
 * Start a GordonAcpAgent listening on stdio. Used by the bin entry
 * (`bun run src/app/acp-entry.ts`). Blocks forever — the editor closes
 * stdin to terminate.
 *
 * stderr is NOT touched by the SDK (stdout is reserved for ACP frames),
 * so anything written to stderr is safe diagnostic logging the editor
 * can show separately if it wants.
 */
export function startAcpServerOnStdio(options: GordonAcpAgentOptions = {}): GordonAcpAgent {
  const inputStream = Writable.toWeb(process.stdout) as unknown as WritableStream<Uint8Array>;
  const outputStream = Readable.toWeb(process.stdin) as unknown as ReadableStream<Uint8Array>;
  // ACP convention from the SDK example: `acp.ndJsonStream(input, output)`
  // where input is what the agent WRITES (server → client) and output is
  // what the agent READS (client → server). Mirrors stream-name semantics
  // in the SDK source.
  const stream = ndJsonStream(inputStream, outputStream);
  let agentRef: GordonAcpAgent | null = null;
  new AgentSideConnection((conn) => {
    const agent = new GordonAcpAgent(conn, options);
    agentRef = agent;
    return agent;
  }, stream);
  if (!agentRef) {
    // The AgentSideConnection constructor synchronously invokes the
    // factory, so this is unreachable. The non-null assertion keeps TS
    // happy without forcing a runtime branch.
    throw new Error("ACP agent factory was not invoked");
  }
  return agentRef;
}
