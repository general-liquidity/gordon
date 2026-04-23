import type { StreamEvent } from "../../infra/agents/orchestrator.ts";
import type { SessionRuntime } from "../../runtime/session/SessionRuntime.ts";
import { SessionRuntimeFactory } from "../../runtime/session/SessionRuntimeFactory.ts";
import type { RuntimeApprovalRequest } from "../../runtime/contracts/types.ts";
import type { GordonRuntimeToolAccessResult } from "../../infra/agents/types.ts";
import { quickPermissionCheck } from "../../infra/permissions/racing.ts";
import { getConversationBudget } from "../../infra/context/conversationBudget.ts";
import { normalizeChatMessage, type ChatMessage } from "../../app/chatTypes.ts";
import { buildPendingApprovalMessages } from "../../app/chatFlow.ts";
import {
  createTaskTree,
  recordTaskTreeAgentSwitch,
  recordTaskTreeToolStart,
  recordTaskTreeToolEnd,
  completeTaskTree,
  failTaskTree,
  type TaskTreeState,
} from "../../app/taskTree.ts";
import {
  parseSlashCommand,
  commandToPrompt,
  SLASH_COMMANDS,
  formatPaginatedCommandHelp,
  type SlashCommand,
} from "../../app/slashCommands.ts";
import { loadConfig, saveConfig } from "../../infra/storage/config.ts";
import { loadEnvFile } from "../../infra/storage/env.ts";
import { GatewayContextResolver } from "../../gateway/runtime/context.ts";
import {
  registerContextInvalidator,
  refreshRuntimeCredentials,
} from "../../infra/runtime/credentialRefresh.ts";
export { refreshRuntimeCredentials } from "../../infra/runtime/credentialRefresh.ts";
import { collectDoctorReport, formatDoctorReport } from "../../app/setup-runtime.ts";
import type { Message } from "../components/MessageBubble.js";
import type { ProgressNode } from "../components/AgentProgress.js";
import type { ApprovalRequest } from "../components/ApprovalDialog.js";
import { getRuntimeApprovalShortId } from "../../app/runtimeApprovalId.ts";
import { subscribeToEvents } from "./eventSubscriptions.js";
import type { Action, TuiNotification } from "../state/types.js";

// ── Extracted handlers ──
import {
  handleSessionMenuCommand,
  handleThreadMenuCommand,
  handleRuntimeMenuCommand,
  handleWorkspaceMenuCommand,
  handleUIMenuCommand,
  handleSystemMenuCommand,
  handleAutonomousMenuCommand,
} from "./menuHandlers.js";
import { routeToolCommand } from "./toolHandlers.js";

// ============================================================================
// Runtime Bridge — connects SessionRuntime to Ink App state
// ============================================================================

let runtimeFactory: SessionRuntimeFactory | null = null;
let activeRuntime: SessionRuntime | null = null;
/**
 * Shared context resolver — builds exchange, broker, binance, LLM, rails,
 * and portfolio clients from config + env. Used by every GordonContext
 * request in the TUI path so tools see the same live clients the daemon
 * would. Previously the TUI returned a stub context with no exchange,
 * which broke every venue-dependent tool ("Binance connected: no" even
 * with valid keys).
 *
 * invalidate() is exported separately so exchange/broker commands and the
 * setup wizard can force a fresh resolve after mutating config.
 */
const tuiContextResolver = new GatewayContextResolver();

// Register this resolver's invalidator so refreshRuntimeCredentials (which
// lives in infra/runtime to avoid a TUI ↔ app circular import) can fire it.
registerContextInvalidator(() => tuiContextResolver.invalidate());

export function invalidateTuiContext(): void {
  tuiContextResolver.invalidate();
}

export type StateUpdater = (fn: (prev: any) => any) => void;

// ============================================================================
// Initialize
// ============================================================================

export async function initializeRuntime(setState: StateUpdater): Promise<SessionRuntime> {
  // Load ~/.gordon/.env into process.env BEFORE anything reads provider state.
  // Without this, providerRegistry.getAvailableProviders() sees empty env on
  // every restart and the first-run setup wizard re-opens even though the
  // user already saved their keys. The GatewayContextResolver also calls
  // loadEnvFile() lazily, but the TUI's first-run gate runs before any
  // resolve() call, so we must prime process.env here.
  try {
    await loadEnvFile();
  } catch {
    // Non-fatal — the wizard will still open on genuinely empty installs.
  }

  const config = await loadConfig();

  runtimeFactory = new SessionRuntimeFactory({
    resolveContext: (async (options: { session: { threadId: string; resourceId: string } }) => {
      // Use the shared GatewayContextResolver so the TUI gets the same
      // live exchange / broker / binance / LLM / rails clients the daemon
      // path does. Without this, context.exchange is always undefined and
      // every venue-dependent tool silently returns "not connected".
      const base = await tuiContextResolver.resolve(options.session.threadId ?? "tui");
      return {
        ...base,
        userId: "tui-user",
        threadId: options.session.threadId,
        resourceId: options.session.resourceId,
      };
    }) as any,
  });

  const runtimeId = `tui-${Date.now()}`;
  activeRuntime = runtimeFactory.get(runtimeId, { sessionId: "tui" });

  // Subscribe to state changes
  activeRuntime.subscribe((state) => {
    // Map pending approvals to TUI format
    const pendingApprovals: ApprovalRequest[] = state.approvals.pending.map(mapApproval);

    setState((prev: any) => ({
      ...prev,
      permissionMode: prev.permissionMode, // preserve user's choice
      sessionId: state.session.sessionId ?? prev.sessionId,
      threadId: state.session.threadId ?? prev.threadId,
      pendingApprovals,
      backgroundTasks: state.background.tasks ?? [],
    }));
  });

  // Parallel initialization — session + tooling run concurrently (Claude Code pattern)
  const sessionPromise = activeRuntime.initializeSession({ autoResume: true }).catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg && !msg.includes("ENOENT") && !msg.includes("not found")) {
      addMessage(setState, "system", `Session resume failed: ${msg}`, "system");
    }
    return null;
  });

  const toolingPromise = activeRuntime.initializeTooling({ enableHotReload: true }).catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    addMessage(setState, "system", `Plugin init warning: ${msg}`, "system");
  });

  const [session] = await Promise.all([sessionPromise, toolingPromise]);

  // Restore transcript if resuming
  if (session) {
    const transcript = activeRuntime.getTranscript();
    if (transcript.length > 0) {
      const messages: Message[] = transcript.map((entry, i) => ({
        id: `restored-${i}`,
        role: entry.role === "user" ? "user" as const
          : entry.role === "assistant" ? "gordon" as const
          : "system" as const,
        content: entry.content,
        timestamp: entry.timestamp,
      }));
      setState((prev: any) => ({
        ...prev,
        messages,
        sessionId: session.resourceId ?? session.threadId ?? null,
        threadId: session.threadId ?? null,
      }));
    }
  }

  // Sync state
  const runtimeState = activeRuntime.getState();
  setState((prev: any) => ({
    ...prev,
    sessionId: runtimeState.session.resourceId ?? runtimeState.session.sessionId ?? null,
    threadId: runtimeState.session.threadId ?? null,
  }));

  // Start background monitoring
  startBackgroundMonitoring(setState);

  // Wire event subscriptions (Phase 4) — translates EventBus events into TUI state
  const dispatch = createDispatchAdapter(setState);
  subscribeToEvents(dispatch);

  return activeRuntime;
}

export function getRuntime(): SessionRuntime | null {
  return activeRuntime;
}

// ============================================================================
// Handle user input — dispatch commands or stream agent response
// ============================================================================

export async function handleInput(
  input: string,
  setState: StateUpdater,
): Promise<void> {
  const runtime = activeRuntime;
  if (!runtime) return;

  // Approval shorthand
  if (input.startsWith("approve ") || input.startsWith("deny ")) {
    return handleApproval(input, setState, runtime);
  }

  // Slash command
  if (input.startsWith("/")) {
    return handleSlashCommand(input, setState, runtime);
  }

  // Natural language → stream agent response
  return streamResponse(input, setState, runtime);
}

// ============================================================================
// Slash Command Dispatch (A + D from plan)
// ============================================================================

async function handleSlashCommand(
  input: string,
  setState: StateUpdater,
  runtime: SessionRuntime,
): Promise<void> {
  const parsed = parseSlashCommand(input);

  if (!parsed) {
    addMessage(setState, "system", `Unknown command: ${input}. Type /help for available commands.`, "system");
    return;
  }

  const { command, args } = parsed;

  // Agent-type commands → stream through LLM
  if (command.action === "agent") {
    const prompt = commandToPrompt(command, args);
    return streamResponse(prompt, setState, runtime);
  }

  // Menu-type commands → handle locally
  if (command.action === "menu") {
    return handleMenuCommand(command, args, setState, runtime);
  }

  // Tool-type commands → route to handler, fallback to agent if no handler
  try {
    const result = await routeToolCommand(command, args, runtime);
    if (result === null) {
      // No explicit handler — fall through to agent via commandToPrompt
      const prompt = commandToPrompt(command, args);
      return streamResponse(prompt, setState, runtime);
    }
    const content = typeof result === "string" ? result : JSON.stringify(result, null, 2);
    addMessage(setState, "gordon", content);
  } catch (err) {
    addMessage(setState, "system", `Error: ${err instanceof Error ? err.message : String(err)}`, "system");
  }
}

// ============================================================================
// Menu Command Dispatch — thin dispatcher to grouped handlers
// ============================================================================

async function handleMenuCommand(
  command: SlashCommand,
  args: string,
  setState: StateUpdater,
  runtime: SessionRuntime,
): Promise<void> {
  const resolved = command.target ?? command.name;

  // Try each handler group in order; first match wins
  if (await handleSessionMenuCommand(resolved, args, setState, runtime)) return;
  if (await handleThreadMenuCommand(resolved, args, setState, runtime)) return;
  if (await handleRuntimeMenuCommand(resolved, args, setState, runtime)) return;
  if (handleWorkspaceMenuCommand(resolved, args, setState)) return;
  if (handleUIMenuCommand(resolved, args, setState)) return;
  if (await handleSystemMenuCommand(resolved, args, setState, runtime)) return;
  if (await handleAutonomousMenuCommand(resolved, args, setState, runtime, command, streamResponse)) return;

  // Portfolio — delegates to agent
  if (resolved === "portfolio") {
    const prompt = commandToPrompt(command, args);
    return streamResponse(prompt, setState, runtime);
  }

  // Fall through to agent for unhandled menu commands
  const prompt = commandToPrompt(command, args);
  return streamResponse(prompt, setState, runtime);
}

// ============================================================================
// Stream agent response (with progress tracking + token tracking)
// ============================================================================

async function streamResponse(
  userMessage: string,
  setState: StateUpdater,
  runtime: SessionRuntime,
): Promise<void> {
  let taskTree = createTaskTree({ input: userMessage });
  let responseContent = "";
  let lastFlushTime = 0;
  let flushPending = false;
  let totalTokens = 0;
  let currentAgentName: string | null = null;
  let chainStartTime = Date.now();
  const streamingMsgId = `streaming-${Date.now()}`;

  setState((prev: any) => ({
    ...prev,
    isStreaming: true,
    streamBuffer: "",
    activeThinking: "",
    activeAgents: [],
    activeToolCalls: [],
    handoffHistory: prev.handoffHistory ?? [],
    // Insert streaming placeholder message into the list (DOM continuity)
    messages: [...prev.messages, {
      id: streamingMsgId,
      role: "gordon" as const,
      content: "",
      timestamp: new Date().toISOString(),
      streaming: true,
    }],
  }));

  try {
    for await (const event of runtime.streamMessage(userMessage)) {
      switch (event.type) {
        case "text_delta": {
          const chunk = event.content ?? "";
          if (chunk) {
            responseContent += chunk;
            // Debounce setState to at most one Ink redraw per 16ms frame.
            // Accumulate chunks in responseContent; a scheduled flush picks up
            // the latest value so no content is lost between commits.
            const now = Date.now();
            if (now - lastFlushTime >= 16) {
              setState((prev: any) => {
                const msgs = [...prev.messages];
                const idx = msgs.length - 1;
                if (idx >= 0 && msgs[idx]?.id === streamingMsgId) {
                  msgs[idx] = { ...msgs[idx], content: responseContent };
                }
                return { ...prev, streamBuffer: responseContent, messages: msgs };
              });
              lastFlushTime = now;
            } else if (!flushPending) {
              flushPending = true;
              setTimeout(() => {
                flushPending = false;
                lastFlushTime = Date.now();
                setState((prev: any) => {
                  const msgs = [...prev.messages];
                  const idx = msgs.length - 1;
                  if (idx >= 0 && msgs[idx]?.id === streamingMsgId) {
                    msgs[idx] = { ...msgs[idx], content: responseContent };
                  }
                  return { ...prev, streamBuffer: responseContent, messages: msgs };
                });
              }, 16 - (now - lastFlushTime));
            }
          }
          break;
        }

        case "step_complete":
          // Final commit — ensures message content is fully in sync after
          // the step completes (handles edge cases where last delta missed).
          if (responseContent.length > 0) {
            setState((prev: any) => {
              const msgs = [...prev.messages];
              const idx = msgs.length - 1;
              if (idx >= 0 && msgs[idx]?.id === streamingMsgId) {
                msgs[idx] = { ...msgs[idx], content: responseContent };
              }
              return { ...prev, streamBuffer: responseContent, messages: msgs };
            });
          }
          break;

        case "thinking_delta":
          setState((prev: any) => ({
            ...prev,
            activeThinking: (prev.activeThinking ?? "") + (event.content ?? ""),
          }));
          break;

        case "agent_switch":
          if (event.agentName) {
            const prevAgent = currentAgentName;
            currentAgentName = event.agentName;
            taskTree = recordTaskTreeAgentSwitch(taskTree, event.agentName) ?? taskTree;

            setState((prev: any) => {
              // Complete previous chain if exists
              const updatedChains = prev.activeAgents.map((c: any) =>
                c.status === "running" ? { ...c, status: "done", duration: Date.now() - c.startedAt } : c
              );
              // Add new chain
              const newChain = {
                id: `chain-${Date.now()}`,
                agentName: event.agentName,
                status: "running",
                startedAt: Date.now(),
                nodes: taskTreeToNodes(taskTree),
              };
              // Record handoff
              const newHandoffs = prevAgent ? [
                ...prev.handoffHistory,
                { from: prevAgent, to: event.agentName!, timestamp: Date.now() },
              ] : prev.handoffHistory;

              return {
                ...prev,
                activeAgents: [...updatedChains, newChain],
                handoffHistory: newHandoffs,
              };
            });
          }
          break;

        case "tool_call_start":
          if (event.toolName) {
            taskTree = recordTaskTreeToolStart(taskTree, event.toolName, event.toolArgs) ?? taskTree;
            setState((prev: any) => {
              const chains = [...prev.activeAgents];
              const last = chains[chains.length - 1];
              if (last) chains[chains.length - 1] = { ...last, nodes: taskTreeToNodes(taskTree) };
              // Track tool call for inline display
              const toolCall = {
                id: `tc-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                toolName: event.toolName!,
                args: event.toolArgs as Record<string, unknown> | undefined,
                status: "running" as const,
                startedAt: Date.now(),
              };
              return {
                ...prev,
                activeAgents: chains,
                activeToolCalls: [...(prev.activeToolCalls ?? []), toolCall],
              };
            });
          }
          break;

        case "tool_call_end":
          taskTree = recordTaskTreeToolEnd(taskTree, event.toolName) ?? taskTree;
          setState((prev: any) => {
            const chains = [...prev.activeAgents];
            const last = chains[chains.length - 1];
            if (last) chains[chains.length - 1] = { ...last, nodes: taskTreeToNodes(taskTree) };
            // Update tool call status
            const updatedCalls = (prev.activeToolCalls ?? []).map((tc: any) =>
              tc.toolName === event.toolName && tc.status === "running"
                ? {
                    ...tc,
                    status: event.error ? "error" : "success",
                    result: event.toolResult ? String(event.toolResult).slice(0, 200) : undefined,
                    duration: Date.now() - tc.startedAt,
                  }
                : tc,
            );
            return { ...prev, activeAgents: chains, activeToolCalls: updatedCalls };
          });
          break;

        case "done": {
          taskTree = completeTaskTree(taskTree) ?? taskTree;
          if (event.usage) {
            totalTokens = event.usage.totalTokens ?? 0;
          }

          // Finalize the streaming message — no new message needed (DOM continuity)
          const gordonMsg: Message = {
            id: streamingMsgId,
            role: "gordon",
            content: responseContent,
            timestamp: new Date().toISOString(),
            agent: taskTree?.currentAgentName,
            streaming: false,
          };

          // ── Phase 5: Risk kernel pre-check on pending approvals ──
          // Evaluate each pending approval through evaluateToolAccess.
          // Auto-deny blocked, auto-approve allowed, only show dialog for pending.
          const rawPending = runtime.getPendingApprovals();
          const stillPending: RuntimeApprovalRequest[] = [];
          const riskMessages: Message[] = [];

          const riskContext = {
            userId: "tui-user",
            config: await loadConfig(),
            runtime: undefined as never,
            threadId: undefined as string | undefined,
            resourceId: undefined as string | undefined,
          } as any;

          for (const approval of rawPending) {
            try {
              // Wire: quick permission check via racing module (fast-path before risk kernel)
              const quickResult = quickPermissionCheck([], approval.toolName, (approval as any).args);
              if (quickResult?.decision === "allow") {
                runtime.approvePendingRequest(approval.id, { persist: false, actor: "permission-rule" });
                riskMessages.push({
                  id: `rule-approve-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                  role: "system",
                  variant: "approval" as const,
                  content: `\u2713 Auto-approved by rule: ${approval.toolName} \u2014 ${quickResult.reason}`,
                  timestamp: new Date().toISOString(),
                });
                continue;
              }
              if (quickResult?.decision === "deny") {
                runtime.denyPendingRequest(approval.id, { reason: quickResult.reason, actor: "permission-rule" });
                riskMessages.push({
                  id: `rule-deny-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                  role: "system",
                  variant: "approval" as const,
                  content: `\u2717 Auto-denied by rule: ${approval.toolName} \u2014 ${quickResult.reason}`,
                  timestamp: new Date().toISOString(),
                });
                continue;
              }

              const accessResult = await runtime.evaluateToolAccess(
                approval.toolName,
                riskContext,
              );

              if (accessResult.status === "blocked") {
                // Auto-deny: risk kernel blocks this tool
                runtime.denyPendingRequest(approval.id, {
                  reason: accessResult.reason ?? "Blocked by risk kernel",
                  actor: "risk-kernel",
                });
                riskMessages.push({
                  id: `risk-deny-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                  role: "system",
                  variant: "approval" as const,
                  content: `\u2717 Auto-denied: ${approval.toolName} \u2014 ${accessResult.reason ?? "risk kernel block"}`,
                  timestamp: new Date().toISOString(),
                });
              } else if (accessResult.status === "allowed") {
                // Auto-approve: risk kernel allows this tool
                runtime.approvePendingRequest(approval.id, {
                  persist: false,
                  actor: "risk-kernel",
                });
                riskMessages.push({
                  id: `risk-approve-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                  role: "system",
                  variant: "approval" as const,
                  content: `\u2713 Auto-approved: ${approval.toolName} \u2014 ${accessResult.reason ?? "risk kernel pass"}`,
                  timestamp: new Date().toISOString(),
                });
              } else {
                // "pending" — needs human approval via dialog
                stillPending.push(approval);
              }
            } catch {
              // If evaluateToolAccess fails, fall through to manual approval
              stillPending.push(approval);
            }
          }

          const approvalMsgs: Message[] = buildPendingApprovalMessages(stillPending).map((m) => ({
            id: `approval-${Date.now()}-${Math.random()}`,
            ...m,
          })) as Message[];

          setState((prev: any) => {
            // Persist tool call results as messages (Claude Code: tool results stay inline)
            const calls = prev.activeToolCalls ?? [];
            const toolResultMsgs: Message[] = calls
              .filter((c: any) => c.status !== "running")
              .map((c: any) => ({
                id: `tool-result-${c.id}`,
                role: "system" as const,
                variant: "tool" as const,
                content: `\u25CF ${c.toolName}${c.args?.symbol ? ` ${c.args.symbol}` : ""}${c.duration ? ` ${c.duration < 1000 ? c.duration + "ms" : (c.duration / 1000).toFixed(1) + "s"}` : ""}${c.result ? `\n\u231F  ${c.result.slice(0, 200)}` : ""}`,
                timestamp: new Date().toISOString(),
              }));

            // Completion badge with duration + token count
            const elapsed = Date.now() - chainStartTime;
            const durStr = elapsed < 1000 ? `${elapsed}ms` : `${(elapsed / 1000).toFixed(1)}s`;
            const tokenStr = totalTokens > 0
              ? totalTokens >= 1000 ? ` \u00b7 ${(totalTokens / 1000).toFixed(1)}K tokens` : ` \u00b7 ${totalTokens} tokens`
              : "";
            const completionMsg: Message = {
              id: `completion-${Date.now()}`,
              role: "system" as const,
              content: `completed in ${durStr}${calls.length > 0 ? ` \u00b7 ${calls.length} tool${calls.length !== 1 ? "s" : ""}` : ""}${tokenStr}`,
              variant: "system" as const,
              timestamp: new Date().toISOString(),
            };

            return {
            ...prev,
            // Replace streaming message + persist tool results + completion + risk/approval
            messages: [
              ...prev.messages.map((m: any) => m.id === streamingMsgId ? gordonMsg : m),
              ...toolResultMsgs,
              completionMsg,
              ...riskMessages,
              ...approvalMsgs,
            ],
            completedMessageCount: prev.messages.length + 1 + riskMessages.length + approvalMsgs.length,
            streamBuffer: "",
            isStreaming: false,
            activeAgents: [],
            activeToolCalls: [],
            handoffHistory: [],
            tokenCount: (prev.tokenCount ?? 0) + totalTokens,
            pendingApprovals: stillPending.map(mapApproval),
          };});
          break;
        }

        case "error": {
          const errorMsg: Message = {
            id: `error-${Date.now()}`,
            role: "system",
            variant: "error" as const,
            content: `Error: ${event.error ?? "Unknown error"}`,
            timestamp: new Date().toISOString(),
          };
          setState((prev: any) => ({
            ...prev,
            messages: [...prev.messages, errorMsg],
            streamBuffer: "",
            isStreaming: false,
            activeAgents: [],
            activeToolCalls: [],
          }));
          break;
        }

        case "cancelled":
          setState((prev: any) => ({
            ...prev,
            streamBuffer: "",
            isStreaming: false,
            activeAgents: [],
            activeToolCalls: [],
          }));
          break;
      }
    }
  } catch (err) {
    addMessage(setState, "system", `Stream error: ${err instanceof Error ? err.message : String(err)}`, "error");
    setState((prev: any) => ({
      ...prev,
      streamBuffer: "",
      isStreaming: false,
      activeAgents: [],
    }));
  }
}

// ============================================================================
// Approval handling
// ============================================================================

async function handleApproval(
  input: string,
  setState: StateUpdater,
  runtime: SessionRuntime,
): Promise<void> {
  const parts = input.split(/\s+/);
  const action = parts[0] as "approve" | "deny";
  const requestId = parts[1] ?? "";
  const rest = parts.slice(2).join(" ");

  if (!requestId) {
    addMessage(setState, "system", `Usage: ${action} <id> ${action === "deny" ? "[reason]" : "[persist]"}`);
    return;
  }

  try {
    if (action === "approve") {
      const persist = rest.includes("persist");
      const result = runtime.approvePendingRequest(requestId, { persist, actor: "user" });
      addMessage(setState, "gordon",
        result ? `\u2713 Approved: ${result.toolName}${persist ? " (persisted)" : ""}` : `No pending approval: ${requestId}`,
        "approval"
      );
    } else {
      const persist = rest.includes("persist");
      const reason = rest.replace("persist", "").trim() || undefined;
      const result = runtime.denyPendingRequest(requestId, { persist, reason, actor: "user" });
      addMessage(setState, "gordon",
        result ? `\u2717 Denied: ${result.toolName}${reason ? ` (${reason})` : ""}` : `No pending approval: ${requestId}`,
        "approval"
      );
    }
  } catch (err) {
    addMessage(setState, "system", `Approval error: ${err instanceof Error ? err.message : String(err)}`, "system");
  }
}

// Handle approval from ApprovalDialog component
export function handleApprovalDecision(
  decision: "always" | "once" | "deny",
  approvalId: string,
  setState: StateUpdater,
): void {
  const runtime = activeRuntime;
  if (!runtime) return;

  if (decision === "deny") {
    runtime.denyPendingRequest(approvalId, { actor: "user" });
    addMessage(setState, "gordon", "\u2717 Denied.", "approval");
  } else {
    const persist = decision === "always";
    runtime.approvePendingRequest(approvalId, { persist, actor: "user", scope: persist ? "session" : undefined });
    addMessage(setState, "gordon", `\u2713 Approved${persist ? " (always for this tool)" : ""}.`, "approval");
  }
}

// ============================================================================
// Background monitoring (M from plan)
// ============================================================================

let _bgMonitorInterval: ReturnType<typeof setInterval> | null = null;

function startBackgroundMonitoring(setState: StateUpdater): void {
  if (!activeRuntime) return;
  // Clean up previous interval if any
  if (_bgMonitorInterval) clearInterval(_bgMonitorInterval);

  // Poll background task state every 5 seconds
  _bgMonitorInterval = setInterval(() => {
    const runtime = activeRuntime;
    if (!runtime) return;

    const state = runtime.getState();
    const tasks = state.background.tasks ?? [];

    // Check for status changes and inject notifications
    for (const task of tasks) {
      if (task.status === "completed" || task.status === "failed") {
        const icon = task.status === "completed" ? "\u2713" : "\u2717";
        const color = task.status === "completed" ? "green" : "red";
        addMessage(setState, "system", `${icon} Background: ${task.label} \u2014 ${task.status}`);
      }
    }

    setState((prev: any) => ({ ...prev, backgroundTasks: tasks }));
  }, 5000);
}

// ============================================================================
// Helpers
// ============================================================================

function addMessage(
  setState: StateUpdater,
  role: Message["role"],
  content: string,
  variant?: Message["variant"],
): void {
  const msg: Message = {
    id: `${role}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    role,
    content,
    variant,
    timestamp: new Date().toISOString(),
  };
  setState((prev: any) => ({
    ...prev,
    messages: [...prev.messages, msg],
  }));
}

function mapApproval(a: RuntimeApprovalRequest): ApprovalRequest {
  return {
    id: a.id,
    shortId: getRuntimeApprovalShortId(a.id),
    toolName: a.toolName,
    permissionScope: a.permissionScope,
    riskClass: a.riskClass,
    sideEffectLevel: a.sideEffectLevel,
    reason: a.reason,
  };
}

/**
 * Adapt a StateUpdater (functional setState) into a Dispatch function
 * that the event subscription system expects. Translates typed Actions
 * into state mutations.
 */
function createDispatchAdapter(setState: StateUpdater): (action: Action) => void {
  return (action: Action) => {
    switch (action.type) {
      case "INJECT_NOTIFICATION":
        setState((prev: any) => ({
          ...prev,
          notifications: [...(prev.notifications ?? []), action.notification],
        }));
        // Only surface critical trading events as conversation messages.
        // fill = position/trade fills, alert = price/stop/guardrail, error = failures.
        // Everything else (system, info, strategy) stays in the notification tray.
        if (["fill", "alert", "error"].includes(action.notification.variant)) {
          const variant = action.notification.variant === "error" ? "error" as const : undefined;
          addMessage(setState, "system", action.notification.message, variant);
        }
        break;
      case "DISMISS_NOTIFICATION":
        setState((prev: any) => ({
          ...prev,
          notifications: (prev.notifications ?? []).map((n: TuiNotification) =>
            n.id === action.id ? { ...n, dismissed: true } : n
          ),
        }));
        break;
      case "CLEAR_NOTIFICATIONS":
        setState((prev: any) => ({ ...prev, notifications: [] }));
        break;
      case "AGENT_SWITCH":
        setState((prev: any) => ({
          ...prev,
          handoffHistory: [
            ...(prev.handoffHistory ?? []),
            { from: action.from, to: action.to, timestamp: Date.now() },
          ],
        }));
        break;
      case "UPDATE_COST":
        setState((prev: any) => ({
          ...prev,
          cost: (prev.cost ?? 0) + action.pnl,
        }));
        break;
      case "SET_AUTONOMOUS_ACTIVE":
        setState((prev: any) => ({
          ...prev,
          autonomousActive: action.active,
          autonomousStrategyCount: action.strategyCount ?? prev.autonomousStrategyCount ?? 0,
        }));
        break;
      default:
        // Unhandled action types — no-op
        break;
    }
  };
}

function taskTreeToNodes(tree: TaskTreeState | null): ProgressNode[] {
  if (!tree) return [];
  return tree.nodes
    .filter((n) => n.parentId === tree.rootId)
    .map((n) => ({
      id: n.id,
      label: n.label,
      status: n.status === "completed" ? "done" as const
        : n.status === "running" ? "running" as const
        : n.status === "failed" ? "error" as const
        : n.status === "cancelled" ? "cancelled" as const
        : "pending" as const,
      agent: tree.currentAgentName,
      duration: n.endedAt ? n.endedAt - n.startedAt : undefined,
    }));
}
