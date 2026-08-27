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
 *     - setSessionMode     default / observe / plan / paper, persisted per session
 *     - cancel             best-effort abort via AbortController
 *     - closeSession       cancel work and release MCP, usage, and context state
 *
 *   Notifications Gordon emits during a prompt turn:
 *     - session/update agent_message_chunk    streamed LLM text deltas
 *     - tool_call + tool_call_update            translated from processMessageStream
 *
 * Capabilities Gordon declares to the client:
 *
 *   - loadSession: true (append-only JSONL history and mode records)
 *   - promptCapabilities.image: true
 *   - promptCapabilities.audio: true (translated to a bounded descriptor on
 *     the default inline path)
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
 *   - ACP permission requests map onto Gordon's PermissionEngine through a
 *     prompt-scoped hook; safety-critical tools remain fail-closed.
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
  type CloseSessionRequest,
  type CloseSessionResponse,
  type SessionMode,
} from "@agentclientprotocol/sdk";
import { Readable, Writable } from "node:stream";
import { processMessageStream } from "../agents/orchestrator.ts";
import { getAcpGordonContext, getAcpPermissionEngine, resetAcpGordonContext } from "./context.ts";
import { StreamTranslator } from "./stream-translator.ts";
import {
  appendSessionTurns,
  loadSessionTurns,
  sessionExists,
  SESSION_ID_PATTERN,
  appendSessionMode,
  loadSessionMode,
} from "./sessions.ts";
import { captureSessionMcpServers, dropSessionMcpServers } from "./mcp-bridge.ts";
import { resetSessionUsage, dropSessionUsage, emitUsageUpdate } from "./usage-tracker.ts";
import { extractMultimodalPrompt, type MultimodalAttachment } from "./content-translator.ts";
import { installAcpPermissionHook } from "./permission-hook.ts";
import { probeBudgetHalt, budgetSignalToStopReason } from "./token-budget.ts";
import { createAcpMcpClient, closeAcpMcpClient, listAcpMcpToolsets } from "./mcp-spinup.ts";
import { getSessionMcpServers } from "./mcp-bridge.ts";
import { renderInlineTextPrompt, resolveVisionPath } from "./llm-vision.ts";
import { runHooks } from "../hooks/engine.ts";

export const ACP_SESSION_MODES = [
  { id: "default", name: "Default", description: "Use Gordon's configured permission mode." },
  {
    id: "observe",
    name: "Observe",
    description: "Read-only analysis; execution tools remain unavailable.",
  },
  {
    id: "plan",
    name: "Plan",
    description: "Build and review plans without dispatching live execution.",
  },
  { id: "paper", name: "Paper", description: "Route trading workflows through paper mode only." },
] as const satisfies readonly SessionMode[];

export type AcpSessionModeId = (typeof ACP_SESSION_MODES)[number]["id"];

function isAcpSessionModeId(value: string): value is AcpSessionModeId {
  return ACP_SESSION_MODES.some((mode) => mode.id === value);
}

function modeState(currentModeId: AcpSessionModeId) {
  return { currentModeId, availableModes: [...ACP_SESSION_MODES] };
}

// ---------------------------------------------------------------------------
// Session state
// ---------------------------------------------------------------------------

interface SessionState {
  /** Abort controller for the currently-running prompt, if any. */
  pendingPrompt: AbortController | null;
  /** FIFO tail covering the running prompt and every queued replacement. */
  promptTail: Promise<void>;
  /** Newer replacements invalidate queued prompts before they enter the handler. */
  promptGeneration: number;
  /** Prevents new work from entering after closeSession begins. */
  closing: boolean;
  /** Conversation history — accumulated across prompts in the same session. */
  history: Array<{ role: "user" | "assistant"; content: string }>;
  modeId: AcpSessionModeId;
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
  modeId: AcpSessionModeId;
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
    modeId,
  }): Promise<PromptHandlerResult> {
    const baseContext = await getAcpGordonContext(false, sessionId);
    const context =
      modeId === "default"
        ? baseContext
        : {
            ...baseContext,
            config: { ...baseContext.config, permissionMode: modeId },
          };
    // Use the ACP sessionId as the Mastra threadId so conversations
    // resume correctly when loadSession is honored.
    const threadId = `acp-${sessionId}`;
    const resourceId = `acp-${sessionId}`;
    const translator = new StreamTranslator();
    const toolsets = await listAcpMcpToolsets(sessionId);
    let assistantText = "";
    let stopReason: PromptHandlerResult["stopReason"] = "end_turn";

    try {
      for await (const event of processMessageStream(prompt, context, threadId, resourceId, {
        signal,
        ...(Object.keys(toolsets).length > 0 ? { toolsets } : {}),
      })) {
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
        sessionCapabilities: { close: {} },
      },
      authMethods: [],
    };
  }

  async authenticate(_params: AuthenticateRequest): Promise<AuthenticateResponse> {
    // Gordon authenticates via env-based provider keys (ANTHROPIC_API_KEY,
    // OPENAI_API_KEY, etc.) — set by the operator outside the ACP session.
    // No interactive auth from the editor side.
    return {};
  }

  async newSession(params: NewSessionRequest): Promise<NewSessionResponse> {
    const sessionId = newSessionId();
    const start = await runHooks("SessionStart", {
      sessionId,
      threadId: `acp-${sessionId}`,
      configSnapshot: { transport: "acp", modeId: "default" },
    });
    if (start.action === "block") {
      throw new Error(start.reason ?? "ACP session start blocked by lifecycle hook.");
    }
    // Install state only after lifecycle policy accepts the session. A blocked
    // start must not leave a resumable transcript, usage bucket or MCP client.
    this.sessions.set(sessionId, {
      pendingPrompt: null,
      promptTail: Promise.resolve(),
      promptGeneration: 0,
      closing: false,
      history: [],
      modeId: "default",
    });
    captureSessionMcpServers(sessionId, params.mcpServers);
    resetSessionUsage(sessionId);
    const forwarded = getSessionMcpServers(sessionId);
    if (forwarded.length > 0) {
      try {
        // Client construction is awaited so closeSession cannot race a late
        // fire-and-forget insertion back into the per-session client map.
        const client = await createAcpMcpClient(sessionId, forwarded);
        if (!client) throw new Error("No eligible editor-forwarded MCP servers were accepted");
      } catch (error) {
        this.sessions.delete(sessionId);
        dropSessionMcpServers(sessionId);
        dropSessionUsage(sessionId);
        await closeAcpMcpClient(sessionId);
        resetAcpGordonContext(sessionId);
        throw error;
      }
    }
    if (!appendSessionMode(sessionId, "default")) {
      this.sessions.delete(sessionId);
      dropSessionMcpServers(sessionId);
      dropSessionUsage(sessionId);
      await closeAcpMcpClient(sessionId);
      resetAcpGordonContext(sessionId);
      throw new Error(`Failed to persist ACP session ${sessionId}`);
    }
    return { sessionId, modes: modeState("default") };
  }

  async loadSession(params: LoadSessionRequest): Promise<LoadSessionResponse> {
    // Reject a malformed/path-traversing sessionId BEFORE any filesystem
    // access — the id is peer-supplied and otherwise lands in a file path.
    if (typeof params.sessionId !== "string" || !SESSION_ID_PATTERN.test(params.sessionId)) {
      throw new Error(`Invalid sessionId: ${JSON.stringify(params.sessionId)}`);
    }
    // V2: rehydrate session history from disk so the editor's session
    // chooser can resume conversations across process restarts.
    if (!sessionExists(params.sessionId)) {
      throw new Error(`Session ${params.sessionId} not found on disk`);
    }
    if (this.sessions.has(params.sessionId)) {
      throw new Error(`ACP session ${params.sessionId} is already loaded`);
    }
    const turns = loadSessionTurns(params.sessionId);
    const persistedMode = loadSessionMode(params.sessionId);
    const modeId = persistedMode && isAcpSessionModeId(persistedMode) ? persistedMode : "default";
    const start = await runHooks("SessionStart", {
      sessionId: params.sessionId,
      threadId: `acp-${params.sessionId}`,
      configSnapshot: { transport: "acp", modeId, resumed: true },
    });
    if (start.action === "block") {
      throw new Error(start.reason ?? "ACP session resume blocked by lifecycle hook.");
    }
    this.sessions.set(params.sessionId, {
      pendingPrompt: null,
      promptTail: Promise.resolve(),
      promptGeneration: 0,
      closing: false,
      history: turns.map((t) => ({ role: t.role, content: t.content })),
      modeId,
    });
    captureSessionMcpServers(params.sessionId, params.mcpServers);
    resetSessionUsage(params.sessionId);
    // Replace any same-process client before installing the resumed set.
    await closeAcpMcpClient(params.sessionId);
    const forwarded = getSessionMcpServers(params.sessionId);
    if (forwarded.length > 0) {
      try {
        const client = await createAcpMcpClient(params.sessionId, forwarded);
        if (!client) throw new Error("No eligible editor-forwarded MCP servers were accepted");
      } catch (error) {
        this.sessions.delete(params.sessionId);
        dropSessionMcpServers(params.sessionId);
        dropSessionUsage(params.sessionId);
        await closeAcpMcpClient(params.sessionId);
        resetAcpGordonContext(params.sessionId);
        throw error;
      }
    }
    return { modes: modeState(modeId) };
  }

  async setSessionMode(params: SetSessionModeRequest): Promise<SetSessionModeResponse> {
    const session = this.sessions.get(params.sessionId);
    if (!session) throw new Error(`Unknown sessionId: ${params.sessionId}`);
    if (session.closing) throw new Error(`ACP session ${params.sessionId} is closing`);
    if (!isAcpSessionModeId(params.modeId))
      throw new Error(`Unsupported ACP session mode: ${params.modeId}`);
    if (!appendSessionMode(params.sessionId, params.modeId)) {
      throw new Error(`Failed to persist ACP session mode for ${params.sessionId}`);
    }
    session.modeId = params.modeId;
    // Client-initiated changes are already known to the caller, but emitting
    // the canonical update keeps every attached ACP view synchronized and is
    // also the required path when a mode changes autonomously later.
    await this.connection.sessionUpdate({
      sessionId: params.sessionId,
      update: {
        sessionUpdate: "current_mode_update",
        currentModeId: params.modeId,
      },
    });
    return {};
  }

  async prompt(params: PromptRequest): Promise<PromptResponse> {
    const session = this.sessions.get(params.sessionId);
    if (!session) {
      throw new Error(`Unknown sessionId: ${params.sessionId}`);
    }
    if (session.closing) throw new Error(`ACP session ${params.sessionId} is closing`);

    // Serialize replacements through a real FIFO. A simple "while current
    // completion" loop lets two replacements await the same predecessor and
    // then enter together. The generation check also prevents an intermediate
    // queued prompt from running when a newer replacement has already arrived.
    const generation = ++session.promptGeneration;
    const predecessor = session.promptTail;
    let releaseSlot!: () => void;
    const slot = new Promise<void>((resolve) => {
      releaseSlot = resolve;
    });
    session.promptTail = predecessor.then(() => slot);
    session.pendingPrompt?.abort();

    let controller: AbortController | null = null;

    let uninstallPermissionHook: (() => void) | null = null;
    try {
      await predecessor;
      if (this.sessions.get(params.sessionId) !== session || session.closing) {
        throw new Error(`ACP session ${params.sessionId} closed while replacing its prompt`);
      }
      if (generation !== session.promptGeneration) {
        return { stopReason: "cancelled" };
      }

      controller = new AbortController();
      session.pendingPrompt = controller;
      const multimodal = extractMultimodalPrompt(params);
      const visionPath = resolveVisionPath();
      const promptText =
        visionPath === "inline"
          ? renderInlineTextPrompt(multimodal.text, multimodal.attachments)
          : multimodal.text;
      const userTurn = { role: "user" as const, content: promptText };

      const preTurnBudget = await probeBudgetHalt();
      if (preTurnBudget.halt) {
        const budgetStop = budgetSignalToStopReason(preTurnBudget);
        if (budgetStop) return { stopReason: budgetStop };
      }

      // Hook installation is part of the ACP permission boundary. If it
      // cannot be installed, this turn must not run without that boundary.
      uninstallPermissionHook = installAcpPermissionHook(getAcpPermissionEngine(params.sessionId), {
        sessionId: params.sessionId,
        connection: this.connection,
      });

      const result = await this.promptHandler({
        sessionId: params.sessionId,
        prompt: promptText,
        attachments: multimodal.attachments,
        history: [...session.history],
        signal: controller.signal,
        connection: this.connection,
        modeId: session.modeId,
      });

      // Abort is authoritative even when a custom/provider handler ignores the
      // signal and later returns `end_turn`. Persisting that late completion
      // would resurrect a turn the editor explicitly cancelled and could leak
      // it into the replacement prompt's history.
      if (controller.signal.aborted) {
        return { stopReason: "cancelled" };
      }

      if (result.stopReason !== "cancelled") {
        const assistantTurn = { role: "assistant" as const, content: result.assistantText };
        const ts = Date.now();
        if (
          !appendSessionTurns(params.sessionId, [
            { ...userTurn, ts },
            { ...assistantTurn, ts },
          ])
        ) {
          throw new Error(`Failed to persist completed ACP turn for ${params.sessionId}`);
        }
        session.history.push(userTurn, assistantTurn);
      }

      if (result.usage) {
        try {
          await emitUsageUpdate(this.connection, params.sessionId, result.usage);
        } catch {
          // Usage telemetry does not change the completed turn's semantics.
        }
      }

      if (result.stopReason === "end_turn") {
        const postTurnBudget = await probeBudgetHalt();
        if (postTurnBudget.halt) {
          const budgetStop = budgetSignalToStopReason(postTurnBudget);
          if (budgetStop) return { stopReason: budgetStop };
        }
      }

      return { stopReason: result.stopReason };
    } finally {
      if (controller && session.pendingPrompt === controller) {
        session.pendingPrompt = null;
      }
      if (uninstallPermissionHook) {
        try {
          uninstallPermissionHook();
        } catch {
          /* removal is idempotent */
        }
      }
      releaseSlot();
    }
  }

  async cancel(params: CancelNotification): Promise<void> {
    const session = this.sessions.get(params.sessionId);
    session?.pendingPrompt?.abort();
  }

  async closeSession(params: CloseSessionRequest): Promise<CloseSessionResponse> {
    const session = this.sessions.get(params.sessionId);
    if (!session) throw new Error(`Unknown sessionId: ${params.sessionId}`);

    if (session.closing) throw new Error(`ACP session ${params.sessionId} is already closing`);
    session.closing = true;
    const stop = await runHooks("Stop", { reason: "graceful", sessionId: params.sessionId });
    if (stop.action === "block") {
      session.closing = false;
      throw new Error(stop.reason ?? "ACP session close blocked by lifecycle hook.");
    }

    // Invalidate queued replacements, abort the active one, then drain the
    // entire FIFO before deleting resources they might otherwise touch.
    session.promptGeneration += 1;
    session.pendingPrompt?.abort();
    await session.promptTail;
    this.sessions.delete(params.sessionId);
    dropSessionMcpServers(params.sessionId);
    dropSessionUsage(params.sessionId);
    await closeAcpMcpClient(params.sessionId);
    resetAcpGordonContext(params.sessionId);
    const sessionEnd = await runHooks("SessionEnd", {
      sessionId: params.sessionId,
      threadId: `acp-${params.sessionId}`,
      reason: "graceful",
      endedAt: new Date().toISOString(),
      turnCount: session.history.filter((turn) => turn.role === "user").length,
    });
    if (sessionEnd.action === "block") {
      throw new Error(
        sessionEnd.reason ??
          `ACP session ${params.sessionId} closed, but its SessionEnd hook failed`,
      );
    }
    return {};
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
export {
  createAcpMcpClient,
  getAcpMcpClient,
  closeAcpMcpClient,
  listAcpMcpTools,
  listAcpMcpToolsets,
} from "./mcp-spinup.ts";
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
 * Start a GordonAcpAgent listening on stdio. Used by the hardened Node
 * launcher (`npm run acp`). Blocks forever — the editor closes stdin to
 * terminate.
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
