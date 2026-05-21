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

## V3.5 (shipped)

- **Permission hook wired to PermissionEngine.** `installAcpPermissionHook` registers via `prependHook` per prompt turn. Non-safety-critical tools that would otherwise need approval surface as interactive ACP `request_permission` prompts in the editor. Safety-critical tools (place_order, execute_plan, etc.) still hit Gordon's hard deny-list — editor approval is too thin a gate for those. Hook uninstalls in the finally block.
- **Trust-trajectory persistence.** `allow_always` / `reject_always` outcomes record into `trustTrajectory` so subsequent calls short-circuit at the trust layer rather than re-prompting.
- **Mastra MCP-client spin-up.** `createAcpMcpClient` instantiates a `@mastra/mcp` MCPClient at `newSession` / `loadSession` using the editor-forwarded `mcpServers` array. Stdio + HTTP + SSE transports supported; acp-type and unrecognized variants skip silently. `listAcpMcpTools(sessionId)` exposes discovered tools to the prompt handler. Full executor-agent dynamic tool registration is the remaining v3.6 piece.
- **Vision-LLM routing — inline text path.** `extractMultimodalPrompt` returns `{ text, attachments }`; the default handler routes through `renderInlineTextPrompt` which prepends short attachment descriptors (`[image: image/png, ~12KB]`) before the user prompt so the LLM has context even on text-only models. `toAnthropicContentBlocks` / `toOpenAIContentParts` ready-to-use translators are exported for the v3.6 flip when Gordon's LLM client gains content-block support. Set `GORDON_ACP_VISION_PATH=blocks` to opt into the v3.6 path once it ships.
- **Token-budget stop reasons.** `probeBudgetHalt` checks Gordon's cost tracker before AND after each prompt. When the daily budget is exhausted (or max-iterations signal arrives), the prompt returns `max_tokens` / `max_turn_requests` stop reasons so the editor knows to halt cleanly instead of looking like the agent stopped mid-thought.

## V3.6+ (deferred)

- **Executor-agent dynamic tool registration** from session-scoped MCP clients. v3.5 spins up the client; routing its tools into the agent surface needs Mastra-wrapper changes.
- **LLM client content-block support.** Right now Gordon's LLM client accepts `Message[] = { role, content: string }`. v3.6 widens to accept content blocks so the `blocks` vision path becomes the default.
- **Mastra-level token budget signals.** Gordon's iteration budget can fire mid-turn; surfacing that as `max_turn_requests` requires a signal channel from the orchestrator the ACP server can listen to.

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
