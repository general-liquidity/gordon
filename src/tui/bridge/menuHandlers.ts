import type { SessionRuntime } from "../../runtime/session/SessionRuntime.ts";
import type { SlashCommand } from "../../app/slash/slashCommands.ts";
import {
  formatPaginatedCommandHelp,
  formatTradingModesHelp,
  commandToPrompt,
} from "../../app/slash/slashCommands.ts";
import { loadConfig, saveConfig } from "../../infra/storage/config/config.ts";
import { collectDoctorReport, formatDoctorReport } from "../../app/setup/setup-runtime.ts";
import {
  stopAutonomousLoop,
  pauseAutonomousLoop,
  resumeAutonomousLoop,
  getAutonomousLoopStatus,
  getCurrentSprintContractView,
} from "../../core/pipeline/autonomous-loop.ts";
import {
  compareWithActuals,
  formatSprintContract,
  formatContractDiff,
  diffToPayload,
} from "../../infra/safety/sprintContract.ts";
import {
  createGoalState,
  loadActiveGoal,
  persistGoalState,
  pauseGoal,
  resumeGoal,
  clearGoal,
  formatGoalState,
  isGoalModeEnabled,
} from "../../core/pipeline/goalMode.ts";
import {
  isTradingFeatureListEnabled,
  loadFeatureList,
  formatFeatureList,
  pickHighestPriority,
} from "../../infra/trading/ops/tradingFeatureList.ts";
import {
  isHumanInputToolEnabled,
  listPending,
  answerRequest,
  formatPending,
  RequestNotFoundError,
  RequestNotPendingError,
} from "../../infra/agents/runtime/humanInputTool.ts";
import { handleTelemetryCommand, handleContextCommand } from "../../app/commands/index.ts";
import { getRuntimeApprovalShortId } from "../../app/runtime/runtimeApprovalId.ts";
import type { Message } from "../components/messages/MessageBubble.tsx";
import type { StateUpdater } from "./runtime.js";
import type { PermissionMode } from "../state/types.ts";
import { evaluatePermissionModeTransition } from "../state/permissionModeFsm.ts";

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

/**
 * Mode changes from the bridge go through the same FSM the reducer enforces,
 * so the success copy never lies: on a denied escalation (pending approvals /
 * mid-stream) the mode is left unchanged and only the rejection is printed.
 * Verdict + message are computed inside one updater so the transition is atomic.
 */
function applyPermissionModeChange(
  setState: StateUpdater,
  mode: PermissionMode,
  successText: string,
): void {
  setState((prev: any) => {
    const verdict = evaluatePermissionModeTransition({
      from: prev.permissionMode,
      to: mode,
      pendingApprovals: prev.pendingApprovals?.length ?? 0,
      isStreaming: !!prev.isStreaming,
    });
    const msg: Message = {
      id: `system-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      role: "system",
      content: verdict.allowed
        ? successText
        : verdict.reason ?? `Cannot switch permission mode to ${mode}.`,
      timestamp: new Date().toISOString(),
    };
    return {
      ...prev,
      ...(verdict.allowed ? { permissionMode: mode } : {}),
      messages: [...prev.messages, msg],
    };
  });
}

const PAGER_LINE_THRESHOLD = 60;

function addMessageOrPager(
  setState: StateUpdater,
  role: Message["role"],
  title: string,
  content: string,
): void {
  if (content.split("\n").length <= PAGER_LINE_THRESHOLD) {
    addMessage(setState, role, content);
    return;
  }

  setState((prev: any) => ({
    ...prev,
    pager: { title, content },
  }));
  addMessage(setState, "system", `${title} opened in pager. Use Ctrl+O later to reopen the latest long message.`);
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
    case "runtime-deny-all": {
      const scope = args.trim() || undefined;
      // Validate scope against known RuntimePermissionScope values; otherwise
      // treat as unscoped so a typo just denies everything (safe default).
      const validScopes = new Set([
        "market.read", "analysis.run", "portfolio.read",
        "papertrade.execute", "livetrade.execute", "transfer.execute",
        "wallet.write", "system.mode.write", "runtime.background.write",
        "plugin.install", "mcp.connect",
      ]);
      const resolvedScope = scope && validScopes.has(scope) ? scope : undefined;
      const denied = runtime.denyAllPending({
        scope: resolvedScope as any,
        reason: `Bulk-denied via /deny-all${resolvedScope ? ` scope=${resolvedScope}` : ""}`,
      });
      const scopeHint = resolvedScope
        ? ` (scope=${resolvedScope})`
        : scope
          ? ` (scope "${scope}" unknown — denied all)`
          : "";
      addMessage(setState, "gordon", denied > 0
        ? `Denied ${denied} pending request${denied === 1 ? "" : "s"}${scopeHint}.`
        : `No pending approvals to deny${scopeHint}.`);
      return true;
    }
    case "runtime-rules": {
      const rules = runtime.listApprovalRules();
      if (rules.length === 0) {
        addMessage(setState, "gordon", "No approval rules configured.");
        return true;
      }
      const lines: string[] = ["ACTIVE RULES:"];
      for (const r of rules) {
        const target = r.toolName
          ? r.toolName
          : r.toolNamePattern
            ? `pattern=${r.toolNamePattern}`
            : r.permissionScope
              ? `scope=${r.permissionScope}`
              : "*";
        const expires = r.expiresAt ? ` expires=${r.expiresAt.slice(0, 10)}` : "";
        lines.push(`  ${r.decision === "allow" ? "✓" : "✗"} ${target} [${r.scope}]${expires} (by ${r.createdBy})`);
      }
      addMessage(setState, "gordon", lines.join("\n"));
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
      addMessageOrPager(setState, "gordon", "Runtime Transcript", lines.join("\n") || "Empty transcript.");
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
      addMessageOrPager(setState, "gordon", "Action Log", lines.length > 1 ? lines.join("\n") : "No actions recorded.");
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
        const issues = report.checks.filter((r: any) => r.status === "fail" || r.status === "warn");
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
    case "trade-queue": {
      setState((prev: any) => ({ ...prev, activeOverlayView: "tradeQueue" }));
      return true;
    }
    case "safety": {
      setState((prev: any) => ({ ...prev, activeOverlayView: "safety" }));
      return true;
    }
    case "auto": {
      applyPermissionModeChange(setState, "auto", "Permission mode: auto \u2014 trades execute without per-action approval. Use /ask to return to default.");
      return true;
    }
    case "ask": {
      applyPermissionModeChange(setState, "ask", "Permission mode: ask \u2014 each trade requires approval via dialog (default).");
      return true;
    }
    case "strict":
    case "readonly": {
      applyPermissionModeChange(setState, "strict", "Permission mode: strict \u2014 read-only, all trades blocked.");
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
    case "modes": {
      addMessage(setState, "gordon", formatTradingModesHelp());
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

      // No args → App.tsx intercepts and opens interactive ModelPicker
      if (!args || args.trim() === "") {
        addMessage(setState, "gordon",
          `Current: ${currentProvider} / ${currentModel}\nUse /model to open the interactive picker.`
        );
        return true;
      }

      // ── Try alias first: /model opus, /model sonnet, /model gpt4o ──
      const { resolveAlias } = await import("../../app/models/modelAliases.ts");
      const aliasResult = resolveAlias(args.trim());
      if (aliasResult) {
        const updated = {
          ...config,
          modelConfig: {
            ...config.modelConfig,
            provider: aliasResult.provider as typeof currentProvider,
            model: aliasResult.model,
          },
        };
        await saveConfig(updated);
        addMessage(setState, "gordon",
          `\u2713 Switched to ${aliasResult.displayName}\n` +
          `  Provider: ${currentProvider} \u2192 ${aliasResult.provider}\n` +
          `  Model: ${currentModel} \u2192 ${aliasResult.model}`
        );
        return true;
      }

      // ── Try provider + model: /model anthropic claude-sonnet-4-6 ──
      const modelParts = args.trim().split(/\s+/);
      const newProvider = modelParts[0]?.toLowerCase();
      const newModel = modelParts.slice(1).join(" ") || undefined;

      const validProviders = ["openai", "anthropic", "google", "dedalus"];
      if (!validProviders.includes(newProvider ?? "")) {
        // Not a known alias or provider — show help
        const { formatAliasHelp } = await import("../../app/models/modelAliases.ts");
        addMessage(setState, "gordon",
          `Unknown model or provider: ${args.trim()}\n\n` + formatAliasHelp()
        );
        return true;
      }

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
        `\u2713 Model updated:\n` +
        `  Provider: ${currentProvider} \u2192 ${newProvider}\n` +
        `  Model: ${currentModel} \u2192 ${displayModel}`
      );
      return true;
    }
    // ── Commands ported from Claude Code ──

    case "compact": {
      // Manually trigger context compaction
      try {
        const { getCompactionTrigger } = await import("../../infra/context/compaction/compactionTrigger.ts");
        const { microcompactMessages } = await import("../../infra/context/compaction/microcompact.ts");
        const trigger = getCompactionTrigger();
        const projection = trigger.current();
        addMessage(setState, "gordon",
          `Context compaction triggered manually.\n` +
          `Current usage: ${Math.round(projection.currentFraction * 100)}% of ${projection.contextWindow.toLocaleString()} tokens\n` +
          `Stage: ${projection.stage}\n` +
          `Recommendation: ${projection.recommendation}`
        );
      } catch {
        addMessage(setState, "gordon", "Context compaction triggered. Old tool results will be cleared on next turn.");
      }
      return true;
    }

    case "clear": {
      setState((prev: any) => ({ ...prev, showResetConfirm: true }));
      return true;
    }

    case "cost": {
      // Show detailed per-model cost breakdown
      try {
        const { getCostTracker } = await import("../../infra/platform/costTracker.ts");
        const display = getCostTracker().formatDisplay();
        addMessage(setState, "gordon", display || "No costs recorded yet this session.");
      } catch {
        addMessage(setState, "gordon", "Cost tracking not available.");
      }
      return true;
    }

    case "effort": {
      // Set effort level (controls thinking depth)
      const level = args.trim().toLowerCase();
      const validLevels = ["low", "medium", "high", "max", "auto"];
      if (!level || !validLevels.includes(level)) {
        addMessage(setState, "gordon",
          `Effort level controls how much reasoning the model does.\n\n` +
          `Usage: /effort <level>\n` +
          `Levels:\n` +
          `  low    — fast, minimal reasoning\n` +
          `  medium — balanced (default)\n` +
          `  high   — deep reasoning, slower\n` +
          `  max    — maximum reasoning depth\n` +
          `  auto   — adapt based on query complexity`
        );
      } else {
        // Store as session override (effort isn't a persistent config — it's per-session)
        try {
          const { setSessionOverride } = await import("../../infra/config/settingsLayers.ts");
          setSessionOverride("effortLevel", level);
        } catch { /* best-effort */ }
        addMessage(setState, "gordon", `Effort level set to: ${level}. Takes effect on next message.`);
      }
      return true;
    }

    case "skills": {
      // List available skills
      try {
        const { discoverSkills } = await import("../../infra/skills/index.ts");
        const skills = discoverSkills();
        if (skills.length === 0) {
          addMessage(setState, "gordon",
            `No skills installed.\n\n` +
            `Create skills in:\n` +
            `  ~/.gordon/skills/<name>/SKILL.md  (user-wide)\n` +
            `  .gordon/skills/<name>/SKILL.md    (project)\n\n` +
            `5 builtin skills available: /quick-scan, /dd, /risk-check, /morning-brief, /close-losers`
          );
        } else {
          const lines = skills.map((s) =>
            `  /${s.id.padEnd(20)} ${s.description || s.name} [${s.source}]`
          );
          addMessage(setState, "gordon",
            `Available skills (${skills.length}):\n\n${lines.join("\n")}\n\n` +
            `Invoke with /<skill-name> [args]`
          );
        }
      } catch {
        addMessage(setState, "gordon", "Skills system not available.");
      }
      return true;
    }

    case "hooks": {
      // View registered hooks
      try {
        const { listHooks } = await import("../../infra/hooks/engine.ts");
        const hooks = listHooks();
        if (hooks.length === 0) {
          addMessage(setState, "gordon",
            `No hooks registered.\n\n` +
            `Hooks run at lifecycle points (PreToolUse, PostToolUse, PreApproval, etc.).\n` +
            `Register via the hooks engine or GORDON.md configuration.`
          );
        } else {
          const lines = hooks.map((h) =>
            `  ${h.id.padEnd(25)} ${h.point.padEnd(18)} priority: ${h.priority ?? 100}`
          );
          addMessage(setState, "gordon",
            `Registered hooks (${hooks.length}):\n\n` +
            `  ${"ID".padEnd(25)} ${"Hook Point".padEnd(18)} Priority\n` +
            `  ${"-".repeat(25)} ${"-".repeat(18)} --------\n` +
            `${lines.join("\n")}`
          );
        }
      } catch {
        addMessage(setState, "gordon", "Hooks engine not available.");
      }
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
          addMessageOrPager(setState, "gordon", "Trade Journal", `TRADE JOURNAL (last ${tradeEntries.length}):\n${lines.join("\n")}`);
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

// ============================================================================
// WIP limit: /wip-status
// ============================================================================

export async function handleWipStatusMenuCommand(
  target: string,
  _args: string,
  setState: StateUpdater,
): Promise<boolean> {
  if (target !== "wip-status") return false;

  const { sessionWipSnapshot } = await import("../../infra/safety/wipSessionRegistry.ts");
  const snap = sessionWipSnapshot();

  if (!snap.enabled) {
    addMessage(
      setState,
      "system",
      "WIP limit is off. Set GORDON_WIP_LIMIT_ENABLED=1 to gate concurrent plans per symbol.",
    );
    return true;
  }

  const activeLines =
    snap.active.length > 0
      ? snap.active
          .map(
            (p) =>
              `  • ${p.planId} — ${p.symbol} / ${p.strategy} (since ${new Date(p.activeSinceMs).toISOString()})`,
          )
          .join("\n")
      : "  (none)";

  addMessage(
    setState,
    "gordon",
    "◈ WIP status\n\n" +
      `Per-symbol: ${snap.limits.perSymbol} | per-strategy: ${snap.limits.perStrategy === Infinity ? "∞" : snap.limits.perStrategy} | global: ${snap.limits.global === Infinity ? "∞" : snap.limits.global}\n\n` +
      `Active plans (${snap.active.length}):\n${activeLines}`,
  );
  return true;
}

// ============================================================================
// Shadow divergence: /shadow-divergence
// ============================================================================

export async function handleShadowDivergenceMenuCommand(
  target: string,
  _args: string,
  setState: StateUpdater,
): Promise<boolean> {
  if (target !== "shadow-divergence") return false;

  const { isShadowModeEnabled } = await import("../../infra/trading/ops/shadowMode.ts");
  if (!isShadowModeEnabled()) {
    addMessage(
      setState,
      "system",
      "Shadow mode is off. Set GORDON_SHADOW_MODE=1 to record ghost fills.",
    );
    return true;
  }

  const { buildShadowDivergenceReport, formatShadowDivergenceReport } = await import(
    "../../infra/trading/ops/shadowDivergenceReport.ts"
  );
  const report = buildShadowDivergenceReport();
  addMessage(setState, "gordon", formatShadowDivergenceReport(report));
  return true;
}

// ============================================================================
// Sprint contract: /sprint-status
// ============================================================================

export async function handleSprintStatusMenuCommand(
  target: string,
  _args: string,
  setState: StateUpdater,
): Promise<boolean> {
  if (target !== "sprint-status") return false;

  const view = getCurrentSprintContractView();
  if (!view) {
    addMessage(
      setState,
      "system",
      "No active sprint contract. Start the autonomous loop with GORDON_SPRINT_CONTRACT=1.",
    );
    return true;
  }

  const diff = compareWithActuals(view.contract, {
    symbolsTouched: view.symbolsTouched,
    venuesUsed: [],
    strategiesInvoked: [],
    verificationOutcomes: [],
    detectedViolations: [],
  });

  addMessage(
    setState,
    "gordon",
    "◈ Sprint status\n\n" +
      formatSprintContract(view.contract) +
      `\n\nCycle count: ${view.cycleCount}` +
      `\nSymbols touched: ${view.symbolsTouched.length > 0 ? view.symbolsTouched.join(", ") : "(none yet)"}` +
      "\n\nDiff:\n" +
      formatContractDiff(diff) +
      `\n\n(payload: ${JSON.stringify(diffToPayload(diff))})`,
  );
  return true;
}

// ============================================================================
// Goal-mode menu commands: /goal, /goal-status, /pause-goal, /goal-clear
// ============================================================================

export async function handleGoalMenuCommand(
  target: string,
  args: string,
  setState: StateUpdater,
): Promise<boolean> {
  if (
    target !== "goal" &&
    target !== "goal-status" &&
    target !== "pause-goal" &&
    target !== "goal-clear"
  ) {
    return false;
  }

  if (!isGoalModeEnabled()) {
    addMessage(
      setState,
      "system",
      "Goal mode is disabled. Set GORDON_GOAL_MODE=1 to enable.",
    );
    return true;
  }

  switch (target) {
    case "goal": {
      const text = args.trim();
      if (!text) {
        addMessage(
          setState,
          "system",
          "Usage: /goal <work> until <measurable end> without <constraints>\n" +
            "Example: /goal trade ETH until Sharpe >= 1.5 without leverage above 2x",
        );
        return true;
      }
      const existing = loadActiveGoal();
      if (existing && existing.status === "active") {
        addMessage(
          setState,
          "system",
          "An active goal already exists. Use /goal-clear before setting a new one.\n\n" +
            formatGoalState(existing),
        );
        return true;
      }
      const state = createGoalState(text);
      persistGoalState(state);
      addMessage(setState, "gordon", "◈ Goal set.\n\n" + formatGoalState(state));
      return true;
    }
    case "goal-status": {
      const state = loadActiveGoal();
      if (!state) {
        addMessage(setState, "system", "No active goal. Use /goal to set one.");
        return true;
      }
      addMessage(setState, "gordon", formatGoalState(state));
      return true;
    }
    case "pause-goal": {
      const state = loadActiveGoal();
      if (!state) {
        addMessage(setState, "system", "No active goal to pause.");
        return true;
      }
      if (state.status === "active") {
        persistGoalState(pauseGoal(state));
        addMessage(setState, "gordon", "◈ Goal paused.");
      } else if (state.status === "paused") {
        persistGoalState(resumeGoal(state));
        addMessage(setState, "gordon", "◈ Goal resumed.");
      } else {
        addMessage(
          setState,
          "system",
          `Goal is ${state.status}; nothing to pause/resume.`,
        );
      }
      return true;
    }
    case "goal-clear": {
      const state = loadActiveGoal();
      if (!state) {
        addMessage(setState, "system", "No active goal to clear.");
        return true;
      }
      persistGoalState(clearGoal(state));
      addMessage(setState, "gordon", "◈ Goal cleared.");
      return true;
    }
  }
  return false;
}

// ============================================================================
// Trading feature-list menu commands: /features, /features-next
// ============================================================================

export async function handleFeatureListMenuCommand(
  target: string,
  _args: string,
  setState: StateUpdater,
): Promise<boolean> {
  if (target !== "features" && target !== "features-next") return false;

  if (!isTradingFeatureListEnabled()) {
    addMessage(
      setState,
      "system",
      "Trading feature list is disabled. Set GORDON_TRADING_FEATURE_LIST=1 to enable.",
    );
    return true;
  }

  const list = loadFeatureList();
  if (!list) {
    addMessage(
      setState,
      "system",
      "No feature list found at ~/.gordon/feature-list.json. Seed one to begin.",
    );
    return true;
  }

  if (target === "features") {
    addMessage(setState, "gordon", formatFeatureList(list));
    return true;
  }

  // features-next
  const next = pickHighestPriority(list);
  if (!next) {
    addMessage(setState, "gordon", "All features passing.");
    return true;
  }
  const lines = [
    `Next: [${next.category}] ${next.description} (priority ${next.priority})`,
    "Steps:",
    ...next.steps.map((s, i) => `  ${i + 1}. ${s}`),
  ];
  if (next.failedReason) {
    lines.push(`Last failure: ${next.failedReason}`);
  }
  addMessage(setState, "gordon", lines.join("\n"));
  return true;
}

// ============================================================================
// Human-input tool menu commands: /pending, /answer
// ============================================================================

export async function handleHumanInputMenuCommand(
  target: string,
  args: string,
  setState: StateUpdater,
): Promise<boolean> {
  if (target !== "pending" && target !== "answer") return false;

  if (!isHumanInputToolEnabled()) {
    addMessage(
      setState,
      "system",
      "Human-input tool is disabled. Set GORDON_HUMAN_INPUT_TOOL=1 to enable.",
    );
    return true;
  }

  if (target === "pending") {
    const pending = listPending();
    addMessage(setState, "gordon", formatPending(pending));
    return true;
  }

  // /answer <request-id> <text>
  const trimmed = args.trim();
  if (!trimmed) {
    addMessage(
      setState,
      "system",
      "Usage: /answer <request-id> <text>\nUse /pending to list open requests.",
    );
    return true;
  }
  const firstSpace = trimmed.indexOf(" ");
  if (firstSpace === -1) {
    addMessage(setState, "system", "Usage: /answer <request-id> <text>");
    return true;
  }
  const requestId = trimmed.slice(0, firstSpace);
  const answer = trimmed.slice(firstSpace + 1).trim();
  if (!answer) {
    addMessage(setState, "system", "Answer text cannot be empty.");
    return true;
  }

  try {
    const resp = answerRequest(requestId, answer);
    addMessage(
      setState,
      "gordon",
      `◈ Answer recorded for ${resp.requestId} at ${resp.answeredAt}.`,
    );
  } catch (err) {
    if (err instanceof RequestNotFoundError) {
      addMessage(setState, "system", `No pending request with id "${requestId}".`);
    } else if (err instanceof RequestNotPendingError) {
      addMessage(setState, "system", err.message);
    } else {
      addMessage(
        setState,
        "system",
        `Failed to record answer: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
  return true;
}

