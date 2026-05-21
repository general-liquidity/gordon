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
2. **`initialize`** — capability + version negotiation. Gordon declares: `loadSession: false`, `promptCapabilities.embeddedContext: true`, `mcpCapabilities: { http: true, sse: true }`
3. **`authenticate`** — no-op for Gordon (env-based provider keys)
4. **`newSession`** — Gordon mints a 32-hex-char sessionId, fresh history map
5. **`prompt`** — repeats per user turn. Gordon streams `agent_message_chunk` notifications via `session/update`, returns `stopReason` when done
6. **`cancel`** — editor signals user pressed stop. Gordon aborts the in-flight prompt
7. **Process exit** — editor closes stdin

## Stop reasons

- `end_turn` — LLM finished, no more model requests
- `cancelled` — `cancel` notification arrived OR re-prompt aborted the prior turn
- `refusal` — Gordon errored out mid-turn; used in v1 in lieu of a generic "error" reason
- `max_tokens` / `max_turn_requests` — not yet emitted in v1 (no token tracking in the ACP path)

## What's WIRED in v1

- Protocol layer (initialize / authenticate / newSession / prompt / cancel)
- LLM text streaming as `agent_message_chunk` updates
- Conversation history per session
- Permission outcomes consumed (selected / cancelled)
- Resource links in prompts surface as `[file: <uri>]` placeholders

## What's DEFERRED to v2

- Full `processMessageStream` integration (multi-agent orchestrator with executor + researcher handoffs)
- Tool calls bridged to ACP `tool_call` + `tool_call_update` notifications
- `session/request_permission` bridged to Gordon's `riskClassifier` + `trustTrajectory`
- Editor's `fs/read_text_file`, `fs/write_text_file` consumed for context
- Session persistence (the `loadSession` capability is currently `false`)
- Image / audio content items
- Token usage reporting

## Pitfalls

1. **stdout is reserved.** Anything written to `console.log` or `process.stdout.write` from anywhere inside Gordon corrupts ACP frames. Use `process.stderr.write` for diagnostics. Gordon's logger module routes to stderr when GORDON_ACP_MODE is set.

2. **No TUI.** The TUI framebuffer is bypassed entirely. Operators see Gordon's output in the editor's panel, not in a terminal window.

3. **Cancel races.** If the operator cancels and immediately re-prompts, the prior turn's handler must abort cleanly. Gordon uses `AbortController` per-prompt; handler authors must thread the signal through any async work.

4. **MCP forwarding (Zed-specific).** When Zed forwards its configured MCP servers to Gordon via ACP, Gordon sees them through the editor's mcp-over-acp channel, NOT through Gordon's own MCP client. v1 does not actively consume these — v2 will.

5. **Capability lies are caught.** If Gordon's initialize says `promptCapabilities.image: false` but Gordon accidentally tries to handle image content, the editor may have already filtered it. Don't claim capabilities you don't implement.

6. **Session history is in-memory.** No persistence across process restarts. `loadSession: false` in initialize confirms this to the editor; calling `loadSession` throws.

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
