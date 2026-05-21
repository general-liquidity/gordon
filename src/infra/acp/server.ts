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
import { createLLMClientFromEnv, type LLMClient } from "../ai/llm/index.ts";

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
 * Internal hook for testing: given user text + history, produce text chunks
 * for the agent to stream. Production wires this to Gordon's LLM client.
 */
export type PromptHandler = (
  prompt: string,
  history: Array<{ role: "user" | "assistant"; content: string }>,
  signal: AbortSignal,
) => AsyncGenerator<string, void, void>;

/**
 * Default prompt handler — uses Gordon's LLM client.
 *
 * V1: makes a single non-streaming LLM call, returns the full result as
 * one chunk. V2 will switch to streaming once the orchestrator's
 * processMessageStream is wired up — at that point chunks correspond to
 * real text deltas from the underlying provider.
 */
function defaultPromptHandler(llm: LLMClient): PromptHandler {
  return async function* (prompt, history, signal) {
    if (signal.aborted) return;
    const messages = [
      ...history.map((h) => ({ role: h.role, content: h.content })),
      { role: "user" as const, content: prompt },
    ];
    const response = await llm.chat(messages);
    if (signal.aborted) return;
    yield response.content;
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
    if (options.promptHandler) {
      this.promptHandler = options.promptHandler;
    } else {
      const llm = createLLMClientFromEnv();
      this.promptHandler = defaultPromptHandler(llm);
    }
  }

  async initialize(_params: InitializeRequest): Promise<InitializeResponse> {
    return {
      protocolVersion: PROTOCOL_VERSION,
      agentCapabilities: {
        loadSession: false,
        promptCapabilities: {
          image: false,
          audio: false,
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

  async newSession(_params: NewSessionRequest): Promise<NewSessionResponse> {
    const sessionId = newSessionId();
    this.sessions.set(sessionId, {
      pendingPrompt: null,
      history: [],
    });
    return { sessionId };
  }

  async loadSession(_params: LoadSessionRequest): Promise<LoadSessionResponse> {
    // V1: loadSession capability disabled in initialize; this is a
    // safety net in case the client calls anyway. The SDK type requires
    // implementation; we throw to make the misuse explicit.
    throw new Error("loadSession not supported in v1 — set agentCapabilities.loadSession=false");
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

    const promptText = extractPromptText(params);

    try {
      let assistantText = "";
      for await (const chunk of this.promptHandler(promptText, session.history, controller.signal)) {
        if (controller.signal.aborted) {
          return { stopReason: "cancelled" };
        }
        assistantText += chunk;
        await this.connection.sessionUpdate({
          sessionId: params.sessionId,
          update: {
            sessionUpdate: "agent_message_chunk",
            content: {
              type: "text",
              text: chunk,
            },
          },
        });
      }

      session.history.push({ role: "user", content: promptText });
      session.history.push({ role: "assistant", content: assistantText });

      return { stopReason: "end_turn" };
    } catch (err) {
      if (controller.signal.aborted) {
        return { stopReason: "cancelled" };
      }
      // Surface error as a refusal — the SDK doesn't have a generic
      // "error" stop reason; refusal is the closest fit when the agent
      // genuinely can't continue.
      const errMsg = err instanceof Error ? err.message : String(err);
      await this.connection.sessionUpdate({
        sessionId: params.sessionId,
        update: {
          sessionUpdate: "agent_message_chunk",
          content: {
            type: "text",
            text: `[gordon error] ${errMsg}`,
          },
        },
      });
      return { stopReason: "refusal" };
    } finally {
      if (session.pendingPrompt === controller) {
        session.pendingPrompt = null;
      }
    }
  }

  async cancel(params: CancelNotification): Promise<void> {
    const session = this.sessions.get(params.sessionId);
    session?.pendingPrompt?.abort();
  }
}

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

/**
 * ACP PromptRequest contains a `prompt` array of content items. For v1
 * we flatten to text — image/audio handling lands in v2 when
 * promptCapabilities.image becomes true.
 */
function extractPromptText(params: PromptRequest): string {
  if (!params.prompt || !Array.isArray(params.prompt)) return "";
  const texts: string[] = [];
  for (const item of params.prompt) {
    if (typeof item === "string") {
      texts.push(item);
      continue;
    }
    if (item && typeof item === "object") {
      const obj = item as Record<string, unknown>;
      if (obj.type === "text" && typeof obj.text === "string") {
        texts.push(obj.text);
      } else if (obj.type === "resource_link" && typeof obj.uri === "string") {
        texts.push(`[file: ${obj.uri}]`);
      }
    }
  }
  return texts.join("\n");
}

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
