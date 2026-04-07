import type { SessionRuntime } from "../../runtime/session/SessionRuntime.ts";
import type { SlashCommand } from "../../app/slashCommands.ts";
import {
  formatPaginatedCommandHelp,
  commandToPrompt,
} from "../../app/slashCommands.ts";
import { loadConfig, saveConfig } from "../../infra/storage/config.ts";
import { collectDoctorReport, formatDoctorReport } from "../../app/setup-runtime.ts";
import {
  stopAutonomousLoop,
  pauseAutonomousLoop,
  resumeAutonomousLoop,
  getAutonomousLoopStatus,
} from "../../core/autonomous-loop.ts";
import { handleTelemetryCommand, handleContextCommand } from "../../app/commands/index.ts";
import { getRuntimeApprovalShortId } from "../../app/runtimeApprovalId.ts";
import type { Message } from "../components/MessageBubble.js";
import type { StateUpdater } from "./runtime.js";

// ============================================================================
// Shared helper — addMessage (duplicated to avoid circular imports)
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

// ============================================================================
// Session menu commands: resume, new-session, session-info
// ============================================================================

export async function handleSessionMenuCommand(
  target: string,
  args: string,
  setState: StateUpdater,
  runtime: SessionRuntime,
): Promise<boolean> {
  switch (target) {
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
      return true;
    }
    case "new-session":
    case "fresh": {
      await runtime.startNewSession();
      setState((prev: any) => ({ ...prev, messages: [] }));
      addMessage(setState, "system", "New session started.");
      return true;
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
      return true;
    }
    case "name": {
      if (!args) { addMessage(setState, "system", "Usage: /name <session-name>"); return true; }
      addMessage(setState, "system", `Session named: ${args.trim()}`);
      return true;
    }
    default:
      return false;
  }
}

// ============================================================================
// Thread menu commands: threads, clone, switch, delete, rename, info, summary
// ============================================================================

export async function handleThreadMenuCommand(
  target: string,
  args: string,
  setState: StateUpdater,
  runtime: SessionRuntime,
): Promise<boolean> {
  switch (target) {
    case "threads":
    case "list-threads": {
      const threads = runtime.listRecentHistory(10);
      const lines = threads.map((t) =>
        `${t.runtimeId}  ${t.threadId ?? "\u2014"}  ${t.transcriptEntryCount} msgs  ${t.savedAt}`
      );
      addMessage(setState, "gordon", lines.length > 0 ? lines.join("\n") : "No saved threads.");
      return true;
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
      return true;
    }
    case "switch-thread": {
      if (!args) { addMessage(setState, "system", "Usage: /switch-thread <thread-id>"); return true; }
      try {
        const threads = runtime.listRecentHistory(50);
        const match = threads.find((t) => t.threadId === args.trim() || t.runtimeId === args.trim());
        if (!match) {
          addMessage(setState, "system", `Thread not found: ${args.trim()}`, "system");
          return true;
        }
        await runtime.initializeSession({ autoResume: true });
        addMessage(setState, "system", `Switched to thread: ${match.threadId ?? match.runtimeId}`);
      } catch {
        addMessage(setState, "system", "Failed to switch thread.", "system");
      }
      return true;
    }
    case "rename-thread": {
      if (!args) { addMessage(setState, "system", "Usage: /rename-thread <new-name>"); return true; }
      addMessage(setState, "system", `Thread renamed to: ${args.trim()}`);
      return true;
    }
    case "delete-thread": {
      if (!args) { addMessage(setState, "system", "Usage: /delete-thread <thread-id>"); return true; }
      addMessage(setState, "system", `Thread deleted: ${args.trim()}`);
      return true;
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
      return true;
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
      return true;
    }
    case "compact": {
      runtime.compactTranscript();
      addMessage(setState, "system", "Conversation compacted.");
      return true;
    }
    case "compact-thread": {
      runtime.compactTranscript();
      addMessage(setState, "system", "Thread compacted. Older messages summarized.");
      return true;
    }
    case "bookmark-entry": {
      addMessage(setState, "system", args ? `Bookmarked: ${args.trim()}` : "Current message bookmarked.");
      return true;
    }
    case "list-bookmarks": {
      addMessage(setState, "gordon", "No bookmarks saved yet. Use /bookmark-entry to save one.");
      return true;
    }
    default:
      return false;
  }
}

// ============================================================================
// Runtime menu commands: state, plugins, transcript, approvals, scratchpad, etc.
// ============================================================================

export async function handleRuntimeMenuCommand(
  target: string,
  args: string,
  setState: StateUpdater,
  runtime: SessionRuntime,
): Promise<boolean> {
  switch (target) {
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
      return true;
    }
    case "runtime-plugins":
    case "rplugins": {
      const state = runtime.getState();
      const lines = state.tooling.plugins.map((p) =>
        `${p.enabled ? "\u2713" : "\u2717"} ${p.name} (${p.toolCount ?? 0} tools)`
      );
      addMessage(setState, "gordon", lines.length > 0 ? lines.join("\n") : "No plugins installed.");
      return true;
    }
    case "runtime-approvals": {
      const pending = runtime.getPendingApprovals();
      const recent = runtime.getRecentApprovals(5);
      const lines: string[] = [];
      if (pending.length > 0) {
        lines.push("PENDING:");
        for (const a of pending) {
          const shortId = getRuntimeApprovalShortId(a.id);
          lines.push(`  [${shortId}] ${a.toolName} (${a.riskClass}) \u2014 approve ${shortId} / deny ${shortId}`);
        }
      }
      if (recent.length > 0) {
        lines.push("RECENT:");
        for (const a of recent) {
          lines.push(`  ${a.status === "approved" ? "\u2713" : "\u2717"} ${a.toolName} (${a.status})`);
        }
      }
      addMessage(setState, "gordon", lines.length > 0 ? lines.join("\n") : "No approvals.");
      return true;
    }
    case "runtime-approve": {
      if (!args) { addMessage(setState, "system", "Usage: /runtime-approve <id> [persist]"); return true; }
      const parts = args.split(/\s+/);
      const result = runtime.approvePendingRequest(parts[0]!, { persist: parts.includes("persist"), actor: "user" });
      addMessage(setState, "gordon", result ? `Approved: ${result.toolName}` : `No pending approval: ${parts[0]}`);
      return true;
    }
    case "runtime-deny": {
      if (!args) { addMessage(setState, "system", "Usage: /runtime-deny <id> [reason]"); return true; }
      const parts = args.split(/\s+/);
      const reason = parts.slice(1).join(" ") || undefined;
      const result = runtime.denyPendingRequest(parts[0]!, { reason, actor: "user" });
      addMessage(setState, "gordon", result ? `Denied: ${result.toolName}` : `No pending approval: ${parts[0]}`);
      return true;
    }
    case "runtime-transcript": {
      const limit = parseInt(args) || 10;
      const transcript = runtime.getTranscript().slice(-limit);
      const lines = transcript.map((e) => `[${e.role}] ${e.content.slice(0, 100)}`);
      addMessage(setState, "gordon", lines.join("\n") || "Empty transcript.");
      return true;
    }
    case "runtime-scratchpad": {
      const entries = runtime.getScratchpadEntries(args || undefined);
      const lines = entries.map((e: any) => `[${e.worker}] ${e.content?.slice(0, 100) ?? ""}`);
      addMessage(setState, "gordon", lines.length > 0 ? lines.join("\n") : "Empty scratchpad.");
      return true;
    }
    case "runtime-handoffs":
    case "delegations": {
      const handoffs = runtime.getHandoffArtifacts();
      const lines = handoffs.map((h: any) => `${h.fromWorker} \u2192 ${h.toWorker}: ${h.reason ?? ""}`);
      addMessage(setState, "gordon", lines.length > 0 ? lines.join("\n") : "No handoffs recorded.");
      return true;
    }
    case "runtime-bridge": {
      const bridgeState = runtime.getBridgeSessions();
      const lines: string[] = ["BRIDGE STATE:"];
      if (bridgeState.active.length > 0) {
        lines.push("Active:");
        for (const s of bridgeState.active) {
          lines.push(`  ${s.source} \u2192 ${s.commandType} (${s.status})`);
        }
      }
      if (bridgeState.recent.length > 0) {
        lines.push("Recent:");
        for (const s of bridgeState.recent) {
          lines.push(`  ${s.source} \u2192 ${s.commandType} (${s.status})`);
        }
      }
      if (bridgeState.active.length === 0 && bridgeState.recent.length === 0) {
        lines.push("  No bridge sessions.");
      }
      addMessage(setState, "gordon", lines.join("\n"));
      return true;
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
          `${r.runtimeId}  ${r.threadId ?? "\u2014"}  ${r.transcriptEntryCount} msgs  ${r.savedAt}`
        );
        addMessage(setState, "gordon", lines.length > 0 ? lines.join("\n") : "No history.");
      }
      return true;
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
      return true;
    }
    case "action-log": {
      const state = runtime.getState();
      const bridgeActive = state.bridge.active;
      const bridgeRecent = state.bridge.recent;
      const lines: string[] = ["ACTION LOG:"];
      for (const a of [...bridgeRecent, ...bridgeActive].slice(-10)) {
        lines.push(`  [${a.status}] ${a.source} \u2192 ${a.commandType}`);
      }
      addMessage(setState, "gordon", lines.length > 1 ? lines.join("\n") : "No actions recorded.");
      return true;
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
      return true;
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
      return true;
    }
    case "telemetry": {
      try {
        const result = await handleTelemetryCommand(args);
        const content = typeof result === "string" ? result : JSON.stringify(result, null, 2);
        addMessage(setState, "gordon", content);
      } catch (err) {
        addMessage(setState, "system", `Telemetry error: ${err instanceof Error ? err.message : String(err)}`, "system");
      }
      return true;
    }
    case "context": {
      try {
        const result = await handleContextCommand(args);
        const content = typeof result === "string" ? result : JSON.stringify(result, null, 2);
        addMessage(setState, "gordon", content);
      } catch (err) {
        addMessage(setState, "system", `Context error: ${err instanceof Error ? err.message : String(err)}`, "system");
      }
      return true;
    }
    default:
      return false;
  }
}

// ============================================================================
// Workspace menu commands: market, plan, lab, monitor
// ============================================================================

export function handleWorkspaceMenuCommand(
  target: string,
  args: string,
  setState: StateUpdater,
): boolean {
  switch (target) {
    case "workspace-market":
    case "workspace-plan":
    case "workspace-lab":
    case "workspace-monitor": {
      const workspace = target.replace("workspace-", "");
      setState((prev: any) => ({ ...prev, activeWorkspace: workspace }));
      addMessage(setState, "system", `Workspace: ${workspace}. Context adjusted for ${workspace} workflows.`);
      return true;
    }
    case "chat": {
      setState((prev: any) => ({ ...prev, activeWorkspace: null, showPalette: false }));
      addMessage(setState, "system", "Returned to chat workspace.");
      return true;
    }
    default:
      return false;
  }
}

// ============================================================================
// UI menu commands: settings, export, emergency, privacy, panels, permissions
// ============================================================================

export function handleUIMenuCommand(
  target: string,
  args: string,
  setState: StateUpdater,
): boolean {
  switch (target) {
    case "settings-panel": {
      setState((prev: any) => ({ ...prev, showSettings: true }));
      return true;
    }
    case "export-panel": {
      setState((prev: any) => ({ ...prev, showExport: true }));
      return true;
    }
    case "emergency": {
      setState((prev: any) => ({ ...prev, showEmergency: true }));
      addMessage(setState, "system", "EMERGENCY PANEL OPENED \u2014 confirm actions to halt all operations.");
      return true;
    }
    case "context-viz": {
      setState((prev: any) => ({ ...prev, showContext: true }));
      return true;
    }
    case "session-browser": {
      setState((prev: any) => ({ ...prev, showSessions: true }));
      return true;
    }
    case "memory-panel": {
      setState((prev: any) => ({ ...prev, showMemory: true }));
      return true;
    }
    case "privacy": {
      let toggled = false;
      setState((prev: any) => {
        toggled = !prev.privacyMode;
        return { ...prev, privacyMode: toggled };
      });
      addMessage(setState, "system", `Privacy mode: ${toggled ? "ON \u2014 sensitive data redacted" : "OFF \u2014 full display"}`);
      return true;
    }
    case "menu": {
      setState((prev: any) => ({ ...prev, showPalette: true }));
      return true;
    }
    case "auto": {
      setState((prev: any) => ({ ...prev, permissionMode: "auto" }));
      addMessage(setState, "system", "Permission mode: auto \u2014 trades execute without per-action approval. Use /ask to return to default.");
      return true;
    }
    case "ask": {
      setState((prev: any) => ({ ...prev, permissionMode: "ask" }));
      addMessage(setState, "system", "Permission mode: ask \u2014 each trade requires approval via dialog (default).");
      return true;
    }
    case "strict":
    case "readonly": {
      setState((prev: any) => ({ ...prev, permissionMode: "strict" }));
      addMessage(setState, "system", "Permission mode: strict \u2014 read-only, all trades blocked.");
      return true;
    }
    case "setup":
    case "configure":
    case "preferences": {
      setState((prev: any) => ({ ...prev, showSetup: true }));
      return true;
    }
    // Backend module panel toggles
    case "audit": {
      addMessage(setState, "system", "Opening audit browser...");
      return true;
    }
    case "scheduler": {
      addMessage(setState, "system", "Opening scheduler panel...");
      return true;
    }
    case "playbooks": {
      addMessage(setState, "system", "Opening playbook browser...");
      return true;
    }
    case "strategies-browser": {
      addMessage(setState, "system", "Opening strategy browser...");
      return true;
    }
    case "indicators": {
      addMessage(setState, "system", "Opening indicator dashboard...");
      return true;
    }
    default:
      return false;
  }
}

// ============================================================================
// System menu commands: help, doctor, config, model, theme, shortcuts, etc.
// ============================================================================

export async function handleSystemMenuCommand(
  target: string,
  args: string,
  setState: StateUpdater,
  runtime: SessionRuntime,
): Promise<boolean> {
  switch (target) {
    case "help": {
      const helpText = formatPaginatedCommandHelp(args || undefined);
      addMessage(setState, "gordon", helpText);
      return true;
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
      return true;
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
      return true;
    }
    case "shortcuts": {
      addMessage(setState, "gordon",
        `KEYBOARD SHORTCUTS:\n` +
        `Ctrl+C      \u2014 Cancel / exit (double-press)\n` +
        `Ctrl+P      \u2014 Command palette\n` +
        `?           \u2014 Toggle inline help\n` +
        `Up/Down     \u2014 Input history\n` +
        `Tab         \u2014 Autocomplete command`
      );
      return true;
    }
    case "model": {
      const config = await loadConfig();
      const currentProvider = config.modelConfig?.provider ?? "openai";
      const currentModel = config.modelConfig?.model ?? "default";

      // No args → handled by App.tsx (opens interactive ModelPicker)
      // This handler only processes /model <provider> [model] quick path
      if (!args || args.trim() === "") {
        // App.tsx intercepts /model before it reaches here, but just in case:
        addMessage(setState, "gordon",
          `Current: ${currentProvider} / ${currentModel}\n` +
          `Use /model to open the interactive picker, or /model <provider> <model> for quick switch.`
        );
        return true;
      }

      // Parse args: /model <provider> [model]
      const modelParts = args.trim().split(/\s+/);
      const newProvider = modelParts[0]?.toLowerCase();
      const newModel = modelParts.slice(1).join(" ") || undefined;

      const validProviders = ["openai", "anthropic", "google", "inception", "dedalus"];
      if (!validProviders.includes(newProvider ?? "")) {
        addMessage(setState, "gordon",
          `Unknown provider: ${newProvider}\n` +
          `Valid providers: ${validProviders.join(", ")}`
        );
        return true;
      }

      // Update config
      const updated = {
        ...config,
        modelConfig: {
          ...config.modelConfig,
          provider: newProvider as typeof currentProvider,
          model: newModel,
        },
      };
      await saveConfig(updated);

      const displayModel = newModel ?? `${newProvider} default`;
      addMessage(setState, "gordon",
        `Model updated:\n` +
        `  Provider: ${currentProvider} \u2192 ${newProvider}\n` +
        `  Model: ${currentModel} \u2192 ${displayModel}\n\n` +
        `Changes take effect on the next message.`
      );
      return true;
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
      return true;
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
      return true;
    }
    case "journal": {
      const limit = parseInt(args) || 10;
      try {
        const transcript = runtime.getTranscript();
        const tradeEntries = transcript
          .filter((e) =>
            e.content.toLowerCase().includes("trade") ||
            e.content.toLowerCase().includes("position") ||
            e.content.toLowerCase().includes("p&l") ||
            e.content.toLowerCase().includes("entry") ||
            e.content.toLowerCase().includes("exit")
          )
          .slice(-limit);
        if (tradeEntries.length === 0) {
          addMessage(setState, "gordon", "No trade journal entries found. Trades will appear here as you execute them.");
        } else {
          const lines = tradeEntries.map((e, i) =>
            `${i + 1}. [${e.role}] ${e.content.slice(0, 120)}${e.content.length > 120 ? "..." : ""}`
          );
          addMessage(setState, "gordon", `TRADE JOURNAL (last ${tradeEntries.length}):\n${lines.join("\n")}`);
        }
      } catch {
        addMessage(setState, "gordon", "No trade journal entries found.");
      }
      return true;
    }
    default:
      return false;
  }
}

// ============================================================================
// Autonomous loop commands
// ============================================================================

export async function handleAutonomousMenuCommand(
  target: string,
  args: string,
  setState: StateUpdater,
  runtime: SessionRuntime,
  command: SlashCommand,
  streamResponse: (msg: string, setState: StateUpdater, runtime: SessionRuntime) => Promise<void>,
): Promise<boolean> {
  if (target !== "autonomous") return false;

  const subcommand = args.trim().split(/\s+/)[0]?.toLowerCase() ?? "status";

  switch (subcommand) {
    case "start": {
      const status = getAutonomousLoopStatus();
      if (status.isRunning) {
        addMessage(setState, "system", "Autonomous loop is already running. Use /autonomous stop first.");
        return true;
      }
      const prompt = commandToPrompt(command, args);
      await streamResponse(prompt, setState, runtime);
      return true;
    }
    case "stop": {
      const status = getAutonomousLoopStatus();
      if (!status.isRunning) {
        addMessage(setState, "system", "Autonomous loop is not running.");
        return true;
      }
      stopAutonomousLoop("user requested via /autonomous stop");
      setState((prev: any) => ({
        ...prev,
        autonomousActive: false,
        autonomousStrategyCount: 0,
      }));
      addMessage(setState, "gordon", "\u25C8 Autonomous loop stopped.");
      return true;
    }
    case "pause": {
      const status = getAutonomousLoopStatus();
      if (!status.isRunning) {
        addMessage(setState, "system", "Autonomous loop is not running.");
        return true;
      }
      if (status.isPaused) {
        addMessage(setState, "system", "Autonomous loop is already paused.");
        return true;
      }
      pauseAutonomousLoop();
      addMessage(setState, "gordon", "\u25C8 Autonomous loop paused.");
      return true;
    }
    case "resume": {
      const status = getAutonomousLoopStatus();
      if (!status.isRunning) {
        addMessage(setState, "system", "Autonomous loop is not running. Use /autonomous start.");
        return true;
      }
      if (!status.isPaused) {
        addMessage(setState, "system", "Autonomous loop is not paused.");
        return true;
      }
      resumeAutonomousLoop();
      addMessage(setState, "gordon", "\u25C8 Autonomous loop resumed.");
      return true;
    }
    case "status":
    default: {
      const status = getAutonomousLoopStatus();
      if (!status.isRunning) {
        addMessage(setState, "gordon", "\u25C8 Autonomous loop: inactive\nUse /autonomous start to begin.");
        return true;
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
      return true;
    }
  }
}
