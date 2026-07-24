import type { StreamEvent } from "../../infra/agents/orchestrator.ts";
import type { SessionRuntime } from "../../runtime/session/SessionRuntime.ts";
import { SessionRuntimeFactory } from "../../runtime/session/SessionRuntimeFactory.ts";
import type { RuntimeApprovalRequest, RuntimeApprovalRule } from "../../runtime/contracts/types.ts";
import type { GordonRuntimeToolAccessResult } from "../../infra/agents/types.ts";
import { quickPermissionCheck } from "../../infra/permissions/racing.ts";
import type { PermissionRule } from "../../infra/permissions/rules.ts";
import { getConversationBudget } from "../../infra/context/budgeting/conversationBudget.ts";
import { normalizeChatMessage, type ChatMessage } from "../../app/chat/chatTypes.ts";
import { buildPendingApprovalMessages } from "../../app/chat/chatFlow.ts";
import {
  createTaskTree,
  recordTaskTreeAgentSwitch,
  recordTaskTreeToolStart,
  recordTaskTreeToolEnd,
  completeTaskTree,
  failTaskTree,
  type TaskTreeState,
} from "../../app/tasks/taskTree.ts";
import {
  parseSlashCommand,
  commandToPrompt,
  SLASH_COMMANDS,
  formatPaginatedCommandHelp,
  type SlashCommand,
} from "../../app/slash/slashCommands.ts";
import { loadConfig, saveConfig } from "../../infra/storage/config/config.ts";
import { resolveFlag } from "../../infra/config/flagResolver.ts";
import { loadEnvFile } from "../../infra/storage/config/env.ts";
import { GatewayContextResolver } from "../../gateway/runtime/context.ts";
import {
  registerContextInvalidator,
  refreshRuntimeCredentials,
} from "../../infra/runtime/credentialRefresh.ts";
import { defaultMessageQueue } from "../../infra/runtime/messageQueue.ts";
import { portfolioContextBuilder } from "../../core/risk-kernel/portfolio-context.ts";
export { refreshRuntimeCredentials } from "../../infra/runtime/credentialRefresh.ts";
import { collectDoctorReport, formatDoctorReport } from "../../app/setup/setup-runtime.ts";
import type { Message } from "../components/messages/MessageBubble.tsx";
import type { ProgressNode } from "../components/status/AgentProgress.tsx";
import type { ApprovalRequest } from "../components/dialogs/ApprovalDialog.tsx";
import { getRuntimeApprovalShortId } from "../../app/runtime/runtimeApprovalId.ts";
import { subscribeToEvents } from "./eventSubscriptions.js";
import type { Action, TuiNotification } from "../state/types.js";
import { appendNotificationCapped } from "../state/notificationRetention.ts";
import { noteRiskKernelFailure, resetRiskKernelHealth } from "./riskKernelHealth.ts";
import { fetchApprovalRiskDetails, buildCounterOfferDenialReason } from "./approvalRiskDetails.ts";
import { recordTurn, resetTurnSummaries, formatTurnsView } from "./turnSummaries.ts";
import { createStreamFlusher } from "./streamFlusher.ts";
import { completeFirstRunningCall, stringifyToolResult } from "./toolCallTracking.ts";
import { markInteraction } from "../diagnostics/performanceMonitor.ts";

// ── Extracted handlers ──
import {
  handleSessionMenuCommand,
  handleThreadMenuCommand,
  handleGoalMenuCommand,
  handleSprintStatusMenuCommand,
  handleWipStatusMenuCommand,
  handleShadowDivergenceMenuCommand,
  handleFeatureListMenuCommand,
  handleHumanInputMenuCommand,
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
// In-flight agent turn's abort controller — set when a stream starts, cleared
// when it ends. Esc-to-stop calls abortActiveTurn() to cancel it.
let activeStreamController: AbortController | null = null;
/**
 * Shared context resolver — builds exchange, broker, LLM, rails,
 * and portfolio clients from config + env. Used by every GordonContext
 * request in the TUI path so tools see the same live clients the daemon
 * would. Previously the TUI returned a stub context with no exchange,
 * which broke every venue-dependent tool ("exchange connected: no" even
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
  equityCache = null;
}

let equityCache: { value: number | null; at: number } | null = null;

export async function getTuiAccountEquity(): Promise<number | null> {
  const now = Date.now();
  if (equityCache && now - equityCache.at < 60_000) return equityCache.value;
  try {
    const ctx = await tuiContextResolver.resolve("tui");
    const direct = Number((ctx as any).portfolioValue);
    let value: number | null = Number.isFinite(direct) && direct > 0 ? direct : null;
    if (value === null && (ctx as any).exchange) {
      value = (await portfolioContextBuilder.buildFromExchange((ctx as any).exchange)).totalEquity;
    }
    if (value === null && (ctx as any).broker) {
      value = (await portfolioContextBuilder.buildFromBroker((ctx as any).broker)).totalEquity;
    }
    equityCache = { value: value && value > 0 ? value : null, at: now };
    return equityCache.value;
  } catch {
    equityCache = { value: null, at: now };
    return null;
  }
}

export type StateUpdater = (fn: (prev: any) => any) => void;

/**
 * Project the PermissionEngine's RuntimeApprovalRule[] onto the racing
 * module's PermissionRule[] shape so quickPermissionCheck can short-circuit
 * on previously-approved/denied rules. Conservative by design: any rule the
 * projection cannot express exactly is dropped, so the approval falls
 * through to the risk-kernel + dialog path instead of fast-deciding wrong.
 */
export function approvalRulesToQuickCheckRules(
  rules: RuntimeApprovalRule[],
  approvalScope: RuntimeApprovalRequest["permissionScope"],
  now: number = Date.now(),
): PermissionRule[] {
  const specificity = (rule: RuntimeApprovalRule): number =>
    rule.toolName ? 2 : rule.toolNamePattern ? 1 : 0;
  return rules
    .filter((rule) => {
      if (rule.expiresAt && new Date(rule.expiresAt).getTime() <= now) return false;
      if (rule.permissionScope && rule.permissionScope !== approvalScope) return false;
      // Engine semantics require BOTH to match when both are set — not
      // expressible as a single toolPattern, so defer to the kernel path.
      if (rule.toolName && rule.toolNamePattern) return false;
      return true;
    })
    // Mirror PermissionEngine tie-breaking: exact toolName beats pattern
    // beats catch-all; within a tier the most recent rule wins.
    .sort((a, b) => {
      const bySpecificity = specificity(b) - specificity(a);
      if (bySpecificity !== 0) return bySpecificity;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    })
    .map((rule, index) => ({
      id: rule.id,
      source: "session" as const,
      toolPattern: rule.toolName ?? rule.toolNamePattern ?? "*",
      behavior: rule.decision,
      priority: index,
      reason: `Previously ${rule.decision === "allow" ? "approved" : "denied"} (${rule.scope} rule by ${rule.createdBy})`,
    }));
}

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

  // ── Optional background services (ALL default-OFF; gated behind env flags) ──
  // Each service is wrapped in try/catch so a failing background service
  // never breaks TUI boot. Skipped services (marketPulse, debateMode) have
  // no lifecycle — they are pure utilities invoked on-demand elsewhere.
  try {
    // GORDON_AUTODREAM_ENABLED — default-on periodic memory consolidation (24h
    // gated internally). Operators force-off via GORDON_AUTODREAM_ENABLED=0.
    // Read via resolveFlag so settings.json + /flags can toggle it (env still wins).
    if (resolveFlag("GORDON_AUTODREAM_ENABLED") !== "0" && resolveFlag("GORDON_AUTODREAM_ENABLED") !== "false") {
      const { AutoDreamManager } = await import("../services/workflow/autoDream.ts");
      const dream = new AutoDreamManager();
      void dream.checkAndConsolidate(0, null).catch(() => {});
    }
  } catch (err) {
    console.error("[runtime] autoDream init failed:", err instanceof Error ? err.message : err);
  }
  try {
    // GORDON_REFLECTION_ENABLED — default-on; warm post-trade reflection store
    // from disk. Operators force-off via GORDON_REFLECTION_ENABLED=0.
    // Read via resolveFlag so settings.json + /flags can toggle it (env still wins).
    if (resolveFlag("GORDON_REFLECTION_ENABLED") !== "0" && resolveFlag("GORDON_REFLECTION_ENABLED") !== "false") {
      const { getReflectionStore } = await import("../services/workflow/tradeReflection.ts");
      getReflectionStore();
    }
  } catch (err) {
    console.error("[runtime] tradeReflection init failed:", err instanceof Error ? err.message : err);
  }
  try {
    // GORDON_DENIAL_MEMORY_ENABLED=true — warm denial-audit memory from disk
    if (resolveFlag("GORDON_DENIAL_MEMORY_ENABLED") === "true") {
      const { getDenialMemory } = await import("../services/memory/denialMemory.ts");
      getDenialMemory();
    }
  } catch (err) {
    console.error("[runtime] denialMemory init failed:", err instanceof Error ? err.message : err);
  }
  // marketPulse (scanMarketPulse) and debateMode (runDebate) are pure on-demand
  // utilities with no lifecycle — no start() to wire; invoked where needed.

  runtimeFactory = new SessionRuntimeFactory({
    resolveContext: (async (options: { session: { threadId: string; resourceId: string } }) => {
      // Use the shared GatewayContextResolver so the TUI gets the same
      // live exchange / broker / LLM / rails clients the daemon
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

  const runtimeId = `tui-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  activeRuntime = runtimeFactory.get(runtimeId, { sessionId: "tui" });

  // Subscribe to state changes
  activeRuntime.subscribe((state) => {
    setState((prev: any) => {
      const pendingApprovals: ApprovalRequest[] = state.approvals.pending.map((approval) => {
        const mapped = mapApproval(approval);
        const enriched = (prev.pendingApprovals as ApprovalRequest[] | undefined)?.find(
          (p) => p.id === mapped.id,
        );
        if (enriched?.riskReasons || enriched?.counterOffer) {
          return {
            ...mapped,
            riskReasons: enriched.riskReasons ?? mapped.riskReasons,
            counterOffer: enriched.counterOffer ?? mapped.counterOffer,
          };
        }
        return mapped;
      });

      return {
        ...prev,
        permissionMode: prev.permissionMode,
        sessionId: state.session.sessionId ?? prev.sessionId,
        threadId: state.session.threadId ?? prev.threadId,
        pendingApprovals,
        backgroundTasks: state.background.tasks ?? [],
      };
    });
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

  resetRiskKernelHealth();
  resetTurnSummaries();

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

/** Abort the in-flight agent turn (Esc-to-stop). Returns true if a turn was running. */
export function abortActiveTurn(): boolean {
  if (activeStreamController && !activeStreamController.signal.aborted) {
    activeStreamController.abort();
    return true;
  }
  return false;
}

export function performSessionReset(setState: StateUpdater): void {
  const runtime = activeRuntime;
  try {
    runtime?.denyAllPending({ reason: "Session reset by operator" });
  } catch {
    // Reset should still clear local UI even if approval denial fails.
  }
  try {
    runtime?.getTranscriptStore().replace([]);
  } catch {
    // Transcript reset is best effort for runtimes not fully initialized.
  }
  defaultMessageQueue.clear();
  resetTurnSummaries();
  setState((prev: any) => ({
    ...prev,
    __resetSession: true,
    messages: [],
    completedMessageCount: 0,
    streamBuffer: "",
    isStreaming: false,
    activeThinking: "",
    activeToolCalls: [],
    activeAgents: [],
    handoffHistory: [],
    pendingApprovals: [],
  }));
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

  // Approval shorthand — only when the second token looks like an
  // approval request id (short hex/uuid-ish or matches a pending id).
  // Without this gate, "approve this plan" would be parsed as
  // approve(requestId="this") and short-circuit the LLM path. Natural-
  // language approval intent should flow to the agent so it can call
  // approve_plan(planId, rationale) instead.
  if (input.startsWith("approve ") || input.startsWith("deny ")) {
    const parts = input.split(/\s+/);
    const candidate = parts[1] ?? "";
    if (looksLikeApprovalId(candidate, runtime)) {
      return handleApproval(input, setState, runtime);
    }
    // Fall through to agent — user meant "approve <something natural>".
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
  // TUI-local view — renders the turn-summary ring buffer; never hits the agent.
  if (input === "/turns" || input.startsWith("/turns ")) {
    addMessage(setState, "system", formatTurnsView(input.slice("/turns".length)), "system");
    return;
  }

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
  if (await handleGoalMenuCommand(resolved, args, setState)) return;
  if (await handleSprintStatusMenuCommand(resolved, args, setState)) return;
  if (await handleWipStatusMenuCommand(resolved, args, setState)) return;
  if (await handleShadowDivergenceMenuCommand(resolved, args, setState)) return;
  if (await handleFeatureListMenuCommand(resolved, args, setState)) return;
  if (await handleHumanInputMenuCommand(resolved, args, setState)) return;

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
  let totalTokens = 0;
  let inputTokens = 0;
  let currentAgentName: string | null = null;
  let chainStartTime = Date.now();
  let lastEventWasToolEnd = false;
  const streamingMsgId = `streaming-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const flushStreamingMessage = (content: string): void => {
    markInteraction("stream");
    setState((prev: any) => {
      const msgs = [...prev.messages];
      const idx = msgs.length - 1;
      if (idx >= 0 && msgs[idx]?.id === streamingMsgId) {
        msgs[idx] = { ...msgs[idx], content };
      }
      return { ...prev, streamBuffer: content, messages: msgs };
    });
  };
  const textFlusher = createStreamFlusher(flushStreamingMessage);
  const thinkingFlusher = createStreamFlusher((thinking) => {
    markInteraction("stream");
    setState((prev: any) => ({ ...prev, activeThinking: thinking }));
  });

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

  const streamController = new AbortController();
  activeStreamController = streamController;
  try {
    for await (const event of runtime.streamMessage(userMessage, { signal: streamController.signal })) {
      switch (event.type) {
        case "text_delta": {
          const chunk = event.content ?? "";
          if (chunk) {
            if (lastEventWasToolEnd && textFlusher.buffer.length > 0 && !textFlusher.buffer.endsWith("\n")) {
              textFlusher.push("\n\n");
            }
            lastEventWasToolEnd = false;
            textFlusher.push(chunk);
          }
          break;
        }

        case "step_complete":
          // Final commit — ensures message content is fully in sync after
          // the step completes (handles edge cases where last delta missed).
          textFlusher.flushNow();
          thinkingFlusher.flushNow();
          break;

        case "thinking_delta":
          thinkingFlusher.push(event.content ?? "");
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
                id: `chain-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
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
          lastEventWasToolEnd = true;
          taskTree = recordTaskTreeToolEnd(taskTree, event.toolName) ?? taskTree;
          setState((prev: any) => {
            const chains = [...prev.activeAgents];
            const last = chains[chains.length - 1];
            if (last) chains[chains.length - 1] = { ...last, nodes: taskTreeToNodes(taskTree) };
            // Update tool call status
            const updatedCalls = completeFirstRunningCall(prev.activeToolCalls ?? [], event.toolName, {
              status: event.error ? "error" : "success",
              result: stringifyToolResult(event.toolResult)?.slice(0, 2000),
              duration: Date.now() - ((prev.activeToolCalls ?? []).find((tc: any) => tc.toolName === event.toolName && tc.status === "running")?.startedAt ?? Date.now()),
            });
            return { ...prev, activeAgents: chains, activeToolCalls: updatedCalls };
          });
          break;

        case "done": {
          taskTree = completeTaskTree(taskTree) ?? taskTree;
          textFlusher.flushNow();
          thinkingFlusher.flushNow();
          if (event.usage) {
            totalTokens = event.usage.totalTokens ?? 0;
            // Tokens currently sitting in the context window — what
            // Claude Code shows in its status line. Mastra normalizes
            // usage to {promptTokens, completionTokens, totalTokens}
            // (cache breakdown is rolled into promptTokens), so the
            // input figure IS promptTokens. Fall back to inputTokens
            // for any provider that exposes it directly.
            const u = event.usage as unknown as Record<string, number | undefined>;
            inputTokens =
              u.promptTokens ??
              u.inputTokens ??
              ((u.cacheReadInputTokens ?? 0) + (u.cacheCreationInputTokens ?? 0));
          }

          // Finalize the streaming message — no new message needed (DOM continuity)
          const gordonMsg: Message = {
            id: streamingMsgId,
            role: "gordon",
            content: textFlusher.buffer,
            timestamp: new Date().toISOString(),
            agent: taskTree?.currentAgentName,
            streaming: false,
          };

          recordTurn(userMessage, textFlusher.buffer);

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
              // Fast-path before the risk kernel: the engine's live approval
              // rules short-circuit the dialog for previously-approved/denied
              // tools. Scope filtering is per-approval, hence inside the loop.
              const quickResult = quickPermissionCheck(
                approvalRulesToQuickCheckRules(runtime.listApprovalRules(), approval.permissionScope),
                approval.toolName,
                (approval as any).args,
              );
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
            } catch (err) {
              // Fall through to manual approval, but tell the operator the
              // risk kernel is down — once per session, not per approval.
              const warning = noteRiskKernelFailure(err);
              if (warning) {
                riskMessages.push({
                  id: `risk-health-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                  role: "system",
                  variant: "approval" as const,
                  content: warning,
                  timestamp: new Date().toISOString(),
                });
              }
              stillPending.push(approval);
            }
          }

          const approvalMsgs: Message[] = buildPendingApprovalMessages(stillPending).map((m) => ({
            id: `approval-${Date.now()}-${Math.random()}`,
            ...m,
          })) as Message[];

          // Thread the risk kernel's actual rejection reasons + size-adjusted
          // counter-offer into each dialog payload. Display-only — failures
          // fall back to the un-enriched approval.
          const enrichedPending: ApprovalRequest[] = await Promise.all(
            stillPending.map(async (approval) => ({
              ...mapApproval(approval),
              ...((await fetchApprovalRiskDetails(approval)) ?? {}),
            })),
          );

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

            // Completion stats are no longer surfaced as a separate
            // system message. Duration + token count are visible during
            // the stream via TradingSpinner; emitting another row after
            // completion duplicated the info on top of the bottom
            // status bar (which already shows context budget / cost /
            // session age) and made the two appear stacked when they
            // should read as one line. Cleaner: status bar is the
            // single live indicator.

            return {
            ...prev,
            // Replace streaming message + persist tool results + risk/approval
            messages: [
              ...prev.messages.map((m: any) => m.id === streamingMsgId ? gordonMsg : m),
              ...toolResultMsgs,
              ...riskMessages,
              ...approvalMsgs,
            ],
            completedMessageCount: prev.messages.length + riskMessages.length + approvalMsgs.length,
            streamBuffer: "",
            isStreaming: false,
            activeAgents: [],
            activeToolCalls: [],
            handoffHistory: [],
            tokenCount: (prev.tokenCount ?? 0) + totalTokens,
            // Current-context budget — the Claude Code parity figure.
            // Falls back to cumulative when the provider didn't report
            // input tokens explicitly.
            contextTokens: inputTokens > 0 ? inputTokens : (prev.contextTokens ?? 0) + totalTokens,
            lastTurnDurationMs: Date.now() - chainStartTime,
            lastTurnTokens: totalTokens,
            pendingApprovals: enrichedPending,
          };});
          break;
        }

        case "error": {
          const errorMsg: Message = {
            id: `error-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
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
    if (streamController.signal.aborted) {
      // User stopped the turn (Esc) — keep the partial response, mark it done.
      setState((prev: any) => ({
        ...prev,
        messages: prev.messages.map((m: any) =>
          m.id === streamingMsgId ? { ...m, content: textFlusher.buffer, streaming: false } : m,
        ),
        streamBuffer: "",
        isStreaming: false,
        activeAgents: [],
        activeToolCalls: [],
      }));
      addMessage(setState, "system", "⏹ Stopped", "system");
    } else {
      addMessage(setState, "system", `Stream error: ${err instanceof Error ? err.message : String(err)}`, "error");
      setState((prev: any) => ({
        ...prev,
        streamBuffer: "",
        isStreaming: false,
        activeAgents: [],
      }));
    }
  } finally {
    if (activeStreamController === streamController) activeStreamController = null;
    textFlusher.dispose();
    thinkingFlusher.dispose();
  }
}

// ============================================================================
// Approval handling
// ============================================================================

/** Heuristic — does `candidate` plausibly identify a pending approval?
 *  Approval ids are UUID-ish (hex with dashes) or short hex slugs. Natural
 *  language tokens like "this", "the", "my", "plan" should NOT match.
 *  Falls back to checking the live pending-approval list for an exact match. */
function looksLikeApprovalId(candidate: string, runtime: SessionRuntime): boolean {
  if (!candidate) return false;
  // Live match: any current pending approval whose id startsWith this token.
  try {
    const state = runtime.getState();
    const pending = (state as { approvals?: { pending?: Array<{ id: string }> } })
      .approvals?.pending ?? [];
    if (pending.some((p) => p.id === candidate || p.id.startsWith(candidate))) {
      return true;
    }
  } catch {
    // Ignore — fall through to shape heuristic.
  }
  // Shape heuristic: UUID (8-4-4-4-12) or hex run of >= 6 chars.
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(candidate)) {
    return true;
  }
  if (/^[0-9a-f]{6,}$/i.test(candidate)) return true;
  return false;
}

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
  decision: "always" | "once" | "deny" | "modify",
  approvalId: string,
  setState: StateUpdater,
  approval?: ApprovalRequest,
): void {
  const runtime = activeRuntime;
  if (!runtime) return;

  if (decision === "modify") {
    // Counter-offer accepted: the original (oversized) order must NOT run.
    // Fail closed \u2014 deny through the existing plumbing with a structured
    // reason so the agent resubmits at the kernel-adjusted size, which then
    // re-passes the full risk gate like any other order.
    const counterOffer = approval?.counterOffer;
    runtime.denyPendingRequest(approvalId, {
      actor: "user",
      reason: buildCounterOfferDenialReason(counterOffer),
    });
    addMessage(
      setState,
      "gordon",
      counterOffer
        ? `\u2713 Counter-offer accepted \u2014 resubmitting at ${counterOffer.adjustedQuantity} ${counterOffer.symbol}.`
        : "\u2713 Counter-offer accepted \u2014 resubmitting at the reduced size.",
      "approval",
    );
  } else if (decision === "deny") {
    runtime.denyPendingRequest(approvalId, { actor: "user" });
    addMessage(setState, "gordon", "\u2717 Denied.", "approval");
  } else {
    const persist = decision === "always";
    runtime.approvePendingRequest(approvalId, { persist, actor: "user", scope: persist ? "session" : undefined });
    addMessage(setState, "gordon", `\u2713 Approved${persist ? " (always for this tool)" : ""}.`, "approval");
  }

  // The request is resolved in the engine \u2014 drop it from the dialog queue
  // immediately instead of waiting for the next stream `done` refresh.
  setState((prev: any) => ({
    ...prev,
    pendingApprovals: (prev.pendingApprovals ?? []).filter(
      (entry: ApprovalRequest) => entry.id !== approvalId,
    ),
  }));
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
          notifications: appendNotificationCapped(prev.notifications, action.notification),
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
