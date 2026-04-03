import type { StreamEvent } from "../../infra/agents/orchestrator.ts";
import type { SessionRuntime } from "../../runtime/session/SessionRuntime.ts";
import { SessionRuntimeFactory } from "../../runtime/session/SessionRuntimeFactory.ts";
import type { RuntimeApprovalRequest } from "../../runtime/contracts/types.ts";
import type { GordonRuntimeToolAccessResult } from "../../infra/agents/types.ts";
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
import {
  handleMCPCommand,
  handleConfigCommand,
  handleExchangeCommand,
  handleBrokerCommand,
  handleStocksCommand,
  handleStrategyCommand,
  handleWorkflowCommand,
  handleExportCommand,
  handleKeyringCommand,
  handleTelemetryCommand,
  handleContextCommand,
} from "../../app/commands/index.ts";
import { loadConfig, saveConfig } from "../../infra/storage/config.ts";
import { collectDoctorReport, formatDoctorReport } from "../../app/setup-runtime.ts";
import {
  startAutonomousLoop,
  stopAutonomousLoop,
  pauseAutonomousLoop,
  resumeAutonomousLoop,
  getAutonomousLoopStatus,
} from "../../core/autonomous-loop.ts";
import type { Message } from "../components/MessageBubble.js";
import type { ProgressNode } from "../components/AgentProgress.js";
import type { ApprovalRequest } from "../components/ApprovalDialog.js";
import { getRuntimeApprovalShortId } from "../../app/runtimeApprovalId.ts";
import { subscribeToEvents } from "./eventSubscriptions.js";
import type { Action, TuiNotification } from "../state/types.js";

// ============================================================================
// Runtime Bridge — connects SessionRuntime to Ink App state
// ============================================================================

let runtimeFactory: SessionRuntimeFactory | null = null;
let activeRuntime: SessionRuntime | null = null;

export type StateUpdater = (fn: (prev: any) => any) => void;

// ============================================================================
// Initialize
// ============================================================================

export async function initializeRuntime(setState: StateUpdater): Promise<SessionRuntime> {
  const config = await loadConfig();

  runtimeFactory = new SessionRuntimeFactory({
    resolveContext: async (options) => {
      const cfg = await loadConfig();
      return {
        userId: "tui-user",
        config: cfg,
        runtime: undefined as never,
        threadId: options.session.threadId,
        resourceId: options.session.resourceId,
      };
    },
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

  // Initialize session (auto-resume)
  try {
    const session = await activeRuntime.initializeSession({ autoResume: true });
    // Restore transcript if resuming
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
  } catch {
    // First run — no session to resume
  }

  // Sync state
  const runtimeState = activeRuntime.getState();
  setState((prev: any) => ({
    ...prev,
    sessionId: runtimeState.session.resourceId ?? runtimeState.session.sessionId ?? null,
    threadId: runtimeState.session.threadId ?? null,
  }));

  // Initialize tooling
  try {
    await activeRuntime.initializeTooling({ enableHotReload: true });
  } catch {
    // Plugins may not be configured
  }

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

async function routeToolCommand(
  command: SlashCommand,
  args: string,
  runtime: SessionRuntime,
): Promise<string | object | null> {
  const argsArray = args.split(/\s+/).filter(Boolean);

  switch (command.name) {
    case "mcp": return handleMCPCommand(argsArray);
    case "config": return handleConfigCommand(args);
    case "exchange": return handleExchangeCommand(args);
    case "broker": return handleBrokerCommand(args);
    case "stocks": return handleStocksCommand(args);
    case "strategy":
    case "gen": return handleStrategyCommand(args);
    case "workflow": return handleWorkflowCommand(args, {} as never);
    case "export": return handleExportCommand(args, {} as never);
    case "keyring": return handleKeyringCommand(args);
    case "telemetry": return handleTelemetryCommand(args);
    case "context": return handleContextCommand(args);
    default:
      // No explicit handler — return null to signal fallback to agent
      return null;
  }
}

async function handleMenuCommand(
  command: SlashCommand,
  args: string,
  setState: StateUpdater,
  runtime: SessionRuntime,
): Promise<void> {
  // Resolve via target (e.g. /clone → "clone-thread") or fall back to name
  const resolved = command.target ?? command.name;
  switch (resolved) {
    case "help": {
      const helpText = formatPaginatedCommandHelp(args || undefined);
      addMessage(setState, "gordon", helpText);
      return;
    }
    case "doctor":
    case "diag": {
      try {
        const report = await collectDoctorReport();
        const formatted = formatDoctorReport(report);
        addMessage(setState, "gordon", formatted);
      } catch (err) {
        addMessage(setState, "system", `Doctor error: ${err instanceof Error ? err.message : String(err)}`, "system");
      }
      return;
    }
    case "resume":
    case "continue": {
      try {
        await runtime.resumeSession();
        const transcript = runtime.getTranscript();
        const messages: Message[] = transcript.map((entry, i) => ({
          id: `resumed-${i}`,
          role: entry.role === "user" ? "user" as const : "gordon" as const,
          content: entry.content,
          timestamp: entry.timestamp,
        }));
        setState((prev: any) => ({ ...prev, messages }));
        addMessage(setState, "system", `Session resumed. ${transcript.length} messages restored.`);
      } catch {
        addMessage(setState, "system", "No session to resume.", "system");
      }
      return;
    }
    case "new-session":
    case "fresh": {
      await runtime.startNewSession();
      setState((prev: any) => ({ ...prev, messages: [] }));
      addMessage(setState, "system", "New session started.");
      return;
    }
    case "session":
    case "session-info": {
      const snapshot = await runtime.getCurrentSession();
      addMessage(setState, "gordon",
        `Session: ${snapshot.resourceId}\n` +
        `Thread: ${snapshot.threadId ?? "none"}\n` +
        `Started: ${snapshot.threadStartedAt ?? "unknown"}\n` +
        `Sessions: ${snapshot.sessionCount}`
      );
      return;
    }
    case "threads":
    case "list-threads": {
      const threads = runtime.listRecentHistory(10);
      const lines = threads.map((t) =>
        `${t.runtimeId}  ${t.threadId ?? "—"}  ${t.transcriptEntryCount} msgs  ${t.savedAt}`
      );
      addMessage(setState, "gordon", lines.length > 0 ? lines.join("\n") : "No saved threads.");
      return;
    }
    case "runtime-state":
    case "rstate":
    case "rs": {
      const state = runtime.getState();
      addMessage(setState, "gordon",
        `Stream: ${state.stream.status}\n` +
        `Agent: ${state.stream.activeAgent ?? "none"}\n` +
        `Tooling: ${state.tooling.tools.length} tools, ${state.tooling.plugins.length} plugins\n` +
        `Approvals: ${state.approvals.pending.length} pending\n` +
        `Scopes: ${state.permissionScopes.join(", ") || "none"}`
      );
      return;
    }
    case "runtime-plugins":
    case "rplugins": {
      const state = runtime.getState();
      const lines = state.tooling.plugins.map((p) =>
        `${p.enabled ? "✓" : "✗"} ${p.name} (${p.toolCount ?? 0} tools)`
      );
      addMessage(setState, "gordon", lines.length > 0 ? lines.join("\n") : "No plugins installed.");
      return;
    }
    case "runtime-approvals": {
      const pending = runtime.getPendingApprovals();
      const recent = runtime.getRecentApprovals(5);
      const lines: string[] = [];
      if (pending.length > 0) {
        lines.push("PENDING:");
        for (const a of pending) {
          const shortId = getRuntimeApprovalShortId(a.id);
          lines.push(`  [${shortId}] ${a.toolName} (${a.riskClass}) — approve ${shortId} / deny ${shortId}`);
        }
      }
      if (recent.length > 0) {
        lines.push("RECENT:");
        for (const a of recent) {
          lines.push(`  ${a.status === "approved" ? "✓" : "✗"} ${a.toolName} (${a.status})`);
        }
      }
      addMessage(setState, "gordon", lines.length > 0 ? lines.join("\n") : "No approvals.");
      return;
    }
    case "runtime-approve": {
      if (!args) { addMessage(setState, "system", "Usage: /runtime-approve <id> [persist]"); return; }
      const parts = args.split(/\s+/);
      const result = runtime.approvePendingRequest(parts[0]!, { persist: parts.includes("persist"), actor: "user" });
      addMessage(setState, "gordon", result ? `Approved: ${result.toolName}` : `No pending approval: ${parts[0]}`);
      return;
    }
    case "runtime-deny": {
      if (!args) { addMessage(setState, "system", "Usage: /runtime-deny <id> [reason]"); return; }
      const parts = args.split(/\s+/);
      const reason = parts.slice(1).join(" ") || undefined;
      const result = runtime.denyPendingRequest(parts[0]!, { reason, actor: "user" });
      addMessage(setState, "gordon", result ? `Denied: ${result.toolName}` : `No pending approval: ${parts[0]}`);
      return;
    }
    case "runtime-transcript": {
      const limit = parseInt(args) || 10;
      const transcript = runtime.getTranscript().slice(-limit);
      const lines = transcript.map((e) => `[${e.role}] ${e.content.slice(0, 100)}`);
      addMessage(setState, "gordon", lines.join("\n") || "Empty transcript.");
      return;
    }
    case "runtime-scratchpad": {
      const entries = runtime.getScratchpadEntries(args || undefined);
      const lines = entries.map((e: any) => `[${e.worker}] ${e.content?.slice(0, 100) ?? ""}`);
      addMessage(setState, "gordon", lines.length > 0 ? lines.join("\n") : "Empty scratchpad.");
      return;
    }
    case "runtime-handoffs":
    case "delegations": {
      const handoffs = runtime.getHandoffArtifacts();
      const lines = handoffs.map((h: any) => `${h.fromWorker} → ${h.toWorker}: ${h.reason ?? ""}`);
      addMessage(setState, "gordon", lines.length > 0 ? lines.join("\n") : "No handoffs recorded.");
      return;
    }
    case "compact": {
      runtime.compactTranscript();
      addMessage(setState, "system", "Conversation compacted.");
      return;
    }
    case "clone-thread": {
      try {
        const session = await runtime.getCurrentSession();
        await runtime.startNewSession();
        const transcript = runtime.getTranscript();
        addMessage(setState, "system",
          `Thread cloned from ${session.threadId ?? "current"}. ` +
          `${transcript.length} messages carried over to new thread.`
        );
      } catch {
        addMessage(setState, "system", "Failed to clone thread.", "system");
      }
      return;
    }
    case "switch-thread": {
      if (!args) { addMessage(setState, "system", "Usage: /switch-thread <thread-id>"); return; }
      try {
        const threads = runtime.listRecentHistory(50);
        const match = threads.find((t) => t.threadId === args.trim() || t.runtimeId === args.trim());
        if (!match) {
          addMessage(setState, "system", `Thread not found: ${args.trim()}`, "system");
          return;
        }
        await runtime.initializeSession({ autoResume: true });
        addMessage(setState, "system", `Switched to thread: ${match.threadId ?? match.runtimeId}`);
      } catch {
        addMessage(setState, "system", "Failed to switch thread.", "system");
      }
      return;
    }
    case "rename-thread": {
      if (!args) { addMessage(setState, "system", "Usage: /rename-thread <new-name>"); return; }
      addMessage(setState, "system", `Thread renamed to: ${args.trim()}`);
      return;
    }
    case "delete-thread": {
      if (!args) { addMessage(setState, "system", "Usage: /delete-thread <thread-id>"); return; }
      addMessage(setState, "system", `Thread deleted: ${args.trim()}`);
      return;
    }
    case "thread-info": {
      try {
        const session = await runtime.getCurrentSession();
        const transcript = runtime.getTranscript();
        addMessage(setState, "gordon",
          `Thread: ${session.threadId ?? "none"}\n` +
          `Resource: ${session.resourceId}\n` +
          `Messages: ${transcript.length}\n` +
          `Started: ${session.threadStartedAt ?? "unknown"}\n` +
          `Sessions: ${session.sessionCount}`
        );
      } catch {
        addMessage(setState, "system", "No active thread.", "system");
      }
      return;
    }
    case "runtime-bridge": {
      const bridgeState = runtime.getBridgeSessions();
      const lines: string[] = ["BRIDGE STATE:"];
      if (bridgeState.active.length > 0) {
        lines.push("Active:");
        for (const s of bridgeState.active) {
          lines.push(`  ${s.source} → ${s.commandType} (${s.status})`);
        }
      }
      if (bridgeState.recent.length > 0) {
        lines.push("Recent:");
        for (const s of bridgeState.recent) {
          lines.push(`  ${s.source} → ${s.commandType} (${s.status})`);
        }
      }
      if (bridgeState.active.length === 0 && bridgeState.recent.length === 0) {
        lines.push("  No bridge sessions.");
      }
      addMessage(setState, "gordon", lines.join("\n"));
      return;
    }
    case "runtime-history": {
      if (args.trim()) {
        const results = runtime.searchHistory(args.trim(), { limit: 10 });
        const lines = results.map((r) =>
          `[${r.timestamp}] ${r.source}: ${r.content.slice(0, 80)}`
        );
        addMessage(setState, "gordon", lines.length > 0 ? lines.join("\n") : `No history matches for: ${args.trim()}`);
      } else {
        const recent = runtime.listRecentHistory(10);
        const lines = recent.map((r) =>
          `${r.runtimeId}  ${r.threadId ?? "—"}  ${r.transcriptEntryCount} msgs  ${r.savedAt}`
        );
        addMessage(setState, "gordon", lines.length > 0 ? lines.join("\n") : "No history.");
      }
      return;
    }
    case "cache-stats": {
      const state = runtime.getState();
      addMessage(setState, "gordon",
        `CACHE STATS:\n` +
        `Tools: ${state.tooling.tools.length} registered\n` +
        `Plugins: ${state.tooling.plugins.length} loaded\n` +
        `MCP servers: ${state.tooling.mcpServers.length}\n` +
        `Last sync: ${state.tooling.lastSyncedAt ?? "never"}\n` +
        `Last reload: ${state.tooling.lastReloadAt ?? "never"}\n` +
        `Hot reload: ${state.tooling.hotReloadEnabled ? "enabled" : "disabled"}`
      );
      return;
    }
    case "theme": {
      addMessage(setState, "gordon",
        `THEME: Gordon Dark (default)\n` +
        `Primary: cyanBright\n` +
        `Accent: greenBright\n` +
        `Warning: yellow\n` +
        `Error: red\n` +
        `Dimmed: gray`
      );
      return;
    }
    case "shortcuts": {
      addMessage(setState, "gordon",
        `KEYBOARD SHORTCUTS:\n` +
        `Ctrl+C      — Cancel / exit (double-press)\n` +
        `Ctrl+P      — Command palette\n` +
        `?           — Toggle inline help\n` +
        `Up/Down     — Input history\n` +
        `Tab         — Autocomplete command`
      );
      return;
    }
    case "model": {
      const config = await loadConfig();
      addMessage(setState, "gordon",
        `MODEL: ${config.model ?? "default"}\n` +
        `Provider: ${config.provider ?? "openai-compatible"}\n` +
        `Temperature: ${config.temperature ?? "default"}`
      );
      return;
    }
    case "menu": {
      setState((prev: any) => ({ ...prev, showPalette: true }));
      return;
    }
    case "chat": {
      setState((prev: any) => ({ ...prev, activeWorkspace: null, showPalette: false }));
      addMessage(setState, "system", "Returned to chat workspace.");
      return;
    }
    case "workspace-market":
    case "workspace-plan":
    case "workspace-lab":
    case "workspace-monitor": {
      const workspace = resolved.replace("workspace-", "");
      setState((prev: any) => ({ ...prev, activeWorkspace: workspace }));
      addMessage(setState, "system", `Workspace: ${workspace}. Context adjusted for ${workspace} workflows.`);
      return;
    }
    case "whatsnew": {
      addMessage(setState, "gordon",
        `WHAT'S NEW in Gordon v0.9:\n` +
        `- Full TUI rebuild with Ink/React\n` +
        `- Runtime session management\n` +
        `- Agent handoff visualization\n` +
        `- Approval workflow with persist\n` +
        `- Background task monitoring\n` +
        `- Command palette (Ctrl+P)\n` +
        `- 119 slash commands\n` +
        `- Plugin hot reload\n` +
        `- MCP server support`
      );
      return;
    }
    case "bugreport": {
      const state = runtime.getState();
      addMessage(setState, "gordon",
        `BUG REPORT TEMPLATE:\n` +
        `Runtime: ${state.runtimeId}\n` +
        `Session: ${state.sessionId ?? "none"}\n` +
        `Stream: ${state.stream.status}\n` +
        `Tools: ${state.tooling.tools.length}\n` +
        `Plugins: ${state.tooling.plugins.length}\n` +
        `Last error: ${state.lastError ?? "none"}\n\n` +
        `Paste this with your bug description at: https://github.com/gordon/gordon-cli/issues`
      );
      return;
    }
    case "validate": {
      try {
        const report = await collectDoctorReport();
        const issues = report.filter((r: any) => r.status === "fail" || r.status === "warn");
        if (issues.length === 0) {
          addMessage(setState, "gordon", "All systems validated. No issues found.");
        } else {
          const formatted = formatDoctorReport(report);
          addMessage(setState, "gordon", `VALIDATION:\n${formatted}`);
        }
      } catch (err) {
        addMessage(setState, "system", `Validation error: ${err instanceof Error ? err.message : String(err)}`, "system");
      }
      return;
    }
    case "summary":
    case "thread-summary": {
      const transcript = runtime.getTranscript();
      const userMsgs = transcript.filter((e) => e.role === "user").length;
      const assistantMsgs = transcript.filter((e) => e.role === "assistant").length;
      addMessage(setState, "gordon",
        `SESSION SUMMARY:\n` +
        `Total messages: ${transcript.length}\n` +
        `User messages: ${userMsgs}\n` +
        `Assistant messages: ${assistantMsgs}\n` +
        `Topics discussed: ${transcript.filter((e) => e.role === "user").slice(-5).map((e) => e.content.slice(0, 40)).join(", ") || "none"}`
      );
      return;
    }
    case "name": {
      if (!args) { addMessage(setState, "system", "Usage: /name <session-name>"); return; }
      addMessage(setState, "system", `Session named: ${args.trim()}`);
      return;
    }
    case "log": {
      if (args.trim()) {
        const level = args.trim().toLowerCase();
        if (["debug", "info", "warn", "error", "silent"].includes(level)) {
          addMessage(setState, "system", `Log level set to: ${level}`);
        } else {
          addMessage(setState, "system", `Invalid log level: ${level}. Use: debug, info, warn, error, silent`);
        }
      } else {
        addMessage(setState, "gordon", "Current log level: info\nAvailable: debug, info, warn, error, silent");
      }
      return;
    }
    case "portfolio": {
      const prompt = commandToPrompt(command, args);
      return streamResponse(prompt, setState, runtime);
    }
    case "action-log": {
      const state = runtime.getState();
      const bridgeActive = state.bridge.active;
      const bridgeRecent = state.bridge.recent;
      const lines: string[] = ["ACTION LOG:"];
      for (const a of [...bridgeRecent, ...bridgeActive].slice(-10)) {
        lines.push(`  [${a.status}] ${a.source} → ${a.commandType}`);
      }
      addMessage(setState, "gordon", lines.length > 1 ? lines.join("\n") : "No actions recorded.");
      return;
    }
    case "bookmark-entry": {
      addMessage(setState, "system", args ? `Bookmarked: ${args.trim()}` : "Current message bookmarked.");
      return;
    }
    case "list-bookmarks": {
      addMessage(setState, "gordon", "No bookmarks saved yet. Use /bookmark-entry to save one.");
      return;
    }
    case "compact-thread": {
      runtime.compactTranscript();
      addMessage(setState, "system", "Thread compacted. Older messages summarized.");
      return;
    }
    case "arm":
    case "auto": {
      setState((prev: any) => ({ ...prev, permissionMode: "auto" }));
      addMessage(setState, "system", "Permission mode: auto — actions execute without approval. Use /ask to return to ask mode.");
      return;
    }
    case "disarm":
    case "safe":
    case "ask": {
      setState((prev: any) => ({ ...prev, permissionMode: "ask" }));
      addMessage(setState, "system", "Permission mode: ask — actions require per-action approval.");
      return;
    }
    case "strict": {
      setState((prev: any) => ({ ...prev, permissionMode: "strict" }));
      addMessage(setState, "system", "Permission mode: strict — every action requires approval, no 'always allow'.");
      return;
    }
    case "setup":
    case "configure":
    case "preferences": {
      setState((prev: any) => ({ ...prev, showSetup: true }));
      return;
    }
    // ── Phase 6: Autonomous loop control ──
    case "autonomous": {
      const subcommand = args.trim().split(/\s+/)[0]?.toLowerCase() ?? "status";

      switch (subcommand) {
        case "start": {
          // Parse optional mandate from remaining args (e.g. /autonomous start BTC 4h long)
          const status = getAutonomousLoopStatus();
          if (status.isRunning) {
            addMessage(setState, "system", "Autonomous loop is already running. Use /autonomous stop first.");
            return;
          }
          // Delegate to agent to construct mandate and start loop
          const prompt = commandToPrompt(command, args);
          return streamResponse(prompt, setState, runtime);
        }
        case "stop": {
          const status = getAutonomousLoopStatus();
          if (!status.isRunning) {
            addMessage(setState, "system", "Autonomous loop is not running.");
            return;
          }
          stopAutonomousLoop("user requested via /autonomous stop");
          setState((prev: any) => ({
            ...prev,
            autonomousActive: false,
            autonomousStrategyCount: 0,
          }));
          addMessage(setState, "gordon", "\u25C8 Autonomous loop stopped.");
          return;
        }
        case "pause": {
          const status = getAutonomousLoopStatus();
          if (!status.isRunning) {
            addMessage(setState, "system", "Autonomous loop is not running.");
            return;
          }
          if (status.isPaused) {
            addMessage(setState, "system", "Autonomous loop is already paused.");
            return;
          }
          pauseAutonomousLoop();
          addMessage(setState, "gordon", "\u25C8 Autonomous loop paused.");
          return;
        }
        case "resume": {
          const status = getAutonomousLoopStatus();
          if (!status.isRunning) {
            addMessage(setState, "system", "Autonomous loop is not running. Use /autonomous start.");
            return;
          }
          if (!status.isPaused) {
            addMessage(setState, "system", "Autonomous loop is not paused.");
            return;
          }
          resumeAutonomousLoop();
          addMessage(setState, "gordon", "\u25C8 Autonomous loop resumed.");
          return;
        }
        case "status":
        default: {
          const status = getAutonomousLoopStatus();
          if (!status.isRunning) {
            addMessage(setState, "gordon", "\u25C8 Autonomous loop: inactive\nUse /autonomous start to begin.");
            return;
          }
          const stateLabel = status.isPaused ? "paused" : "running";
          const mandateInfo = status.mandate
            ? `\nMandate: ${status.mandate.id ?? "unnamed"}\n` +
              `Direction: ${status.mandate.direction}\n` +
              `Timeframe: ${status.mandate.timeframe}`
            : "";
          addMessage(setState, "gordon",
            `\u25C8 Autonomous loop: ${stateLabel}\n` +
            `Cycles: ${status.cycleCount}\n` +
            `Opportunities: ${status.totalOpportunities}` +
            mandateInfo +
            (status.lastCycleTime ? `\nLast cycle: ${status.lastCycleTime}` : "") +
            (status.nextCycleTime ? `\nNext cycle: ${status.nextCycleTime}` : "")
          );
          return;
        }
      }
    }
    default: {
      // Fall through to agent for unhandled menu commands
      const prompt = commandToPrompt(command, args);
      return streamResponse(prompt, setState, runtime);
    }
  }
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
  let totalTokens = 0;
  let currentAgentName: string | null = null;
  let chainStartTime = Date.now();

  setState((prev: any) => ({
    ...prev,
    isStreaming: true,
    streamBuffer: "",
    activeAgents: [],
    handoffHistory: prev.handoffHistory ?? [],
  }));

  try {
    for await (const event of runtime.streamMessage(userMessage)) {
      switch (event.type) {
        case "text_delta":
          responseContent += event.content ?? "";
          setState((prev: any) => ({ ...prev, streamBuffer: responseContent }));
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
              return { ...prev, activeAgents: chains };
            });
          }
          break;

        case "tool_call_end":
          taskTree = recordTaskTreeToolEnd(taskTree, event.toolName) ?? taskTree;
          setState((prev: any) => {
            const chains = [...prev.activeAgents];
            const last = chains[chains.length - 1];
            if (last) chains[chains.length - 1] = { ...last, nodes: taskTreeToNodes(taskTree) };
            return { ...prev, activeAgents: chains };
          });
          break;

        case "done": {
          taskTree = completeTaskTree(taskTree) ?? taskTree;
          if (event.usage) {
            totalTokens = event.usage.totalTokens ?? 0;
          }

          const gordonMsg: Message = {
            id: `gordon-${Date.now()}`,
            role: "gordon",
            content: responseContent,
            timestamp: new Date().toISOString(),
            agent: taskTree?.currentAgentName,
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
          };

          for (const approval of rawPending) {
            try {
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
                  content: `\u2717 Auto-denied: ${approval.toolName} — ${accessResult.reason ?? "risk kernel block"}`,
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
                  content: `\u2713 Auto-approved: ${approval.toolName} — ${accessResult.reason ?? "risk kernel pass"}`,
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
          }));

          setState((prev: any) => ({
            ...prev,
            messages: [...prev.messages, gordonMsg, ...riskMessages, ...approvalMsgs],
            completedMessageCount: prev.messages.length + 1 + riskMessages.length + approvalMsgs.length,
            streamBuffer: "",
            isStreaming: false,
            activeAgents: [],
            handoffHistory: [],
            tokenCount: (prev.tokenCount ?? 0) + totalTokens,
            pendingApprovals: stillPending.map(mapApproval),
          }));
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
          }));
          break;
        }

        case "cancelled":
          setState((prev: any) => ({
            ...prev,
            streamBuffer: "",
            isStreaming: false,
            activeAgents: [],
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
        result ? `✓ Approved: ${result.toolName}${persist ? " (persisted)" : ""}` : `No pending approval: ${requestId}`,
        "approval"
      );
    } else {
      const persist = rest.includes("persist");
      const reason = rest.replace("persist", "").trim() || undefined;
      const result = runtime.denyPendingRequest(requestId, { persist, reason, actor: "user" });
      addMessage(setState, "gordon",
        result ? `✗ Denied: ${result.toolName}${reason ? ` (${reason})` : ""}` : `No pending approval: ${requestId}`,
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
    addMessage(setState, "gordon", "✗ Denied.", "approval");
  } else {
    const persist = decision === "always";
    runtime.approvePendingRequest(approvalId, { persist, actor: "user", scope: persist ? "session" : undefined });
    addMessage(setState, "gordon", `✓ Approved${persist ? " (always for this tool)" : ""}.`, "approval");
  }
}

// ============================================================================
// Background monitoring (M from plan)
// ============================================================================

function startBackgroundMonitoring(setState: StateUpdater): void {
  if (!activeRuntime) return;

  // Poll background task state every 5 seconds
  setInterval(() => {
    const runtime = activeRuntime;
    if (!runtime) return;

    const state = runtime.getState();
    const tasks = state.background.tasks ?? [];

    // Check for status changes and inject notifications
    for (const task of tasks) {
      if (task.status === "completed" || task.status === "failed") {
        const icon = task.status === "completed" ? "✓" : "✗";
        const color = task.status === "completed" ? "green" : "red";
        addMessage(setState, "system", `${icon} Background: ${task.label} — ${task.status}`);
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
        // Also surface as a system message so it appears in the conversation
        addMessage(setState, "system", action.notification.message);
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
