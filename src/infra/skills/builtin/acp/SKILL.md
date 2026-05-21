---
name: acp
description: Use this when operating inside an Agent Client Protocol (ACP) host editor — Zed's Agent Panel, Athas's External Agents panel, or any client from the ACP Registry (50+ as of 2026). Gordon runs as a stdio subprocess spawned by the editor. Use when the operator mentions Zed, Athas, ACP, or talks about "the agent panel"; when stdin/stdout JSON-RPC is the transport; when prompt items arrive as a content array rather than a plain string; when the editor forwards MCP servers over ACP. The editor handles UI, file ops, terminal, and permission prompts — Gordon focuses on reasoning + tool calls.
license: MIT
compatibility: Requires `@agentclientprotocol/sdk` and a stdio-spawning ACP host (Zed, Athas). Auth via env-based provider keys (ANTHROPIC_API_KEY, OPENAI_API_KEY, DEDALUS_API_KEY).
metadata:
  author: Gordon
  version: "1.0"
  upstream: https://agentclientprotocol.com/
---

# ACP Skill

When Gordon is running in ACP mode (`bun acp` entry point, spawned as a subprocess by Zed/Athas/etc.), use this skill to understand the protocol surface and edge cases.

## When to use

- The operator opens Gordon in Zed's Agent Panel or Athas's External Agents panel
- The transport is JSON-RPC 2.0 over stdio rather than the TUI's framebuffer
- Prompt items arrive as a content array (text + resource_link + image)
- The editor wants to forward its configured MCP servers to Gordon via the ACP `mcpCapabilities` channel
- The operator references "the agent panel", "Zed agents", or the ACP Registry

## Lifecycle

The editor drives the lifecycle:

1. **Spawns Gordon** as a subprocess with stdio piped
2. **`initialize`** — capability + version negotiation. Gordon declares: `loadSession: true`, `promptCapabilities.embeddedContext: true`, `mcpCapabilities: { http: true, sse: true }`
3. **`authenticate`** — no-op for Gordon (env-based provider keys)
4. **`newSession`** — Gordon mints a 32-hex-char sessionId, fresh history map
5. **`loadSession`** — Gordon rehydrates a previously-persisted session from `~/.gordon/acp-sessions/<id>.jsonl`
6. **`prompt`** — repeats per user turn. Gordon routes through `processMessageStream` (full multi-agent orchestrator); each StreamEvent becomes one or more `session/update` notifications via `StreamTranslator`. Returns `stopReason` when done
7. **`cancel`** — editor signals user pressed stop. Gordon aborts the in-flight prompt
8. **Process exit** — editor closes stdin

## Stop reasons

- `end_turn` — LLM finished, no more model requests
- `cancelled` — `cancel` notification arrived OR re-prompt aborted the prior turn
- `refusal` — Gordon errored out mid-turn; used in v1 in lieu of a generic "error" reason
- `max_tokens` / `max_turn_requests` — v3 emits `usage_update` notifications with cumulative totals; the editor can apply its own thresholds. Gordon doesn't return these stop reasons itself yet (deferred — needs Mastra-level token-budget signal).

## What's WIRED (v3)

- Full protocol layer (initialize / authenticate / newSession / loadSession / setSessionMode / prompt / cancel)
- `processMessageStream` orchestrator — executor + researcher handoffs, thinking phase, compaction, guardrails, full Mastra agent loop
- `StreamTranslator` maps every Gordon StreamEvent to the right ACP `sessionUpdate` discriminator:
  - `text_delta` → `agent_message_chunk`
  - `thinking_delta` → `agent_thought_chunk`
  - `tool_call_start` → `tool_call` (status pending, kind classified from tool-name prefix)
  - `tool_call_end` → `tool_call_update` (status completed | failed; raw output forwarded)
  - `agent_switch` → informational `agent_thought_chunk` ("[handoff → executor]")
  - `done` → end_turn stop reason
  - `cancelled` → cancelled stop reason
  - `error` → error chunk + refusal stop reason
- Tool-kind classification follows ACP's enum (`read` / `edit` / `delete` / `move` / `search` / `execute` / `think` / `fetch` / `switch_mode` / `other`) via a tool-name prefix heuristic
- Session persistence to `~/.gordon/acp-sessions/<id>.jsonl` (one JSON-per-line, append-only, survives partial process crashes)
- Cancelled turns NOT persisted — re-prompting starts fresh
- `loadSession` rehydrates history from disk so editors can resume conversations across restarts
- **v3: `session/request_permission` bridge** (`requestAcpPermission` helper) — emits the 4-option prompt (allow_once / allow_always / reject_once / reject_always), maps outcomes to Gordon verdicts (`approve` / `reject` / `cancelled` with persist flag)
- **v3: editor-forwarded MCP servers** captured from `newSession` / `loadSession` `mcpServers` parameter, queryable via `getSessionMcpServers(sessionId)`
- **v3: editor `fs/read_text_file` + `fs/write_text_file`** routed through `readTextFileViaAcp` / `writeTextFileViaAcp` helpers — prefer editor-fs when capable, fall back to Node fs on failure
- **v3: multimodal content** — image / audio / resource items extracted via `extractMultimodalPrompt`, attachments preserved for downstream multimodal LLM passing, text channel still carries placeholder markers for text-only routing
- **v3: token usage reporting** — `emitUsageUpdate` accumulates per-session totals + emits `usage_update` notifications with cumulative `promptTokens` / `completionTokens` / `totalTokens` / optional `costUsd`
- **v3: initialize advertises `image: true`, `audio: true`** so editors will forward multimodal content items

## What's DEFERRED to v3.5

- **Trust-trajectory persistence**: `allow_always` / `reject_always` outcomes from the ACP permission prompt currently inform Gordon's verdict but don't yet update `trustTrajectory` to auto-apply on subsequent calls. The `persist` flag in `GordonAcpPermissionVerdict` carries the intent.
- **Gordon-side MCP-client spinup**: v3 captures + exposes editor-forwarded MCP server configs but doesn't yet instantiate Mastra MCP clients per server + register their tools with the agent registry. Tools currently see Gordon's own MCP-consumed tools, not the editor-forwarded ones.
- **Multimodal LLM routing**: image/audio attachments are preserved in the `MultimodalAttachment[]` channel but the default prompt handler still passes only text to the LLM. Vision-capable models would receive the attachments verbatim with a small update to the handler.
- **Permission-bridge wired to the tool execution path**: `requestAcpPermission` exists as a helper but Gordon's PermissionEngine isn't yet rerouted to call it. Tool calls that Gordon's internal gate would block still surface as failed `tool_call_update` notifications rather than interactive permission prompts. The bridge is ready; the runtime hookup is the missing piece.

## Pitfalls

1. **stdout is reserved.** Anything written to `console.log` or `process.stdout.write` from anywhere inside Gordon corrupts ACP frames. Use `process.stderr.write` for diagnostics. Gordon's logger module routes to stderr when GORDON_ACP_MODE is set.

2. **No TUI.** The TUI framebuffer is bypassed entirely. Operators see Gordon's output in the editor's panel, not in a terminal window.

3. **Cancel races.** If the operator cancels and immediately re-prompts, the prior turn's handler must abort cleanly. Gordon uses `AbortController` per-prompt; handler authors must thread the signal through any async work.

4. **MCP forwarding (Zed-specific).** When Zed forwards its configured MCP servers to Gordon via ACP, Gordon sees them through the editor's mcp-over-acp channel, NOT through Gordon's own MCP client. v1 does not actively consume these — v2 will.

5. **Capability lies are caught.** If Gordon's initialize says `promptCapabilities.image: false` but Gordon accidentally tries to handle image content, the editor may have already filtered it. Don't claim capabilities you don't implement.

6. **Session history persists to disk.** `~/.gordon/acp-sessions/<id>.jsonl`, append-only JSONL. Override the directory via `GORDON_ACP_SESSIONS_PATH`. The editor can call `loadSession` with any previously-seen sessionId to resume; missing sessions throw.

## Verification

Before claiming ACP mode is working:
- The editor's panel shows Gordon as an available agent (registry installed or extension configured)
- Initialize round-trip completes (editor shows Gordon's capabilities)
- A prompt produces streaming text in the editor's UI
- Cancel actually stops the turn (operator presses stop, Gordon doesn't keep emitting)
- Stderr-only logging — no JSON-RPC corruption

## When NOT to use

- Operator is in Gordon's native TUI — that path doesn't go through ACP at all
- Operator wants Gordon to consume an MCP server (use Gordon's MCP client via Mastra, not the ACP-forwarded version)
- Operator wants Gordon as a peer agent to delegate to (use the `CliSubprocessPeer` in `peers/` instead — that's outbound delegation, not ACP-server-mode)
