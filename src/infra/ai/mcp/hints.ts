/**
 * MCP standard behavioral tool annotations.
 *
 * Per the MCP spec, every tool can carry four boolean behavioral hints
 * that let a downstream host (Cursor, Claude Code, Warp) shape its own
 * approval UX WITHOUT understanding Gordon's internals:
 *
 *   - readOnlyHint    — the tool does not modify any state (price reads,
 *                       news, portfolio snapshots, pure compute). Hosts
 *                       may auto-approve these.
 *   - destructiveHint — the tool can perform an irreversible / money-
 *                       moving action (order placement, cancel, wallet
 *                       transfer, plan execution). Hosts should force
 *                       explicit confirmation.
 *   - idempotentHint  — repeating the call with the same args has no
 *                       additional effect (only meaningful when the tool
 *                       is not read-only). A cancel is idempotent; a
 *                       market order is not.
 *   - openWorldHint   — the tool reaches an "open" world of external
 *                       entities (a venue, the web, a news feed) rather
 *                       than a closed local computation (indicator math,
 *                       local memory, local audit log).
 *
 * These hints are ADVISORY to the consuming host. They do NOT relax
 * Gordon's own gates: riskClassifier, trust-trajectory, the execution
 * deny-list, and the trading constitution still fire on every exposed
 * call regardless of what a hint says. This is the host's approval-UX
 * signal, a second surface on top of Gordon's non-negotiable safety.
 *
 * Derivation philosophy: classify from signals that already exist, do
 * NOT hand-maintain a parallel enumerated list per tool.
 *
 *   - destructive is anchored on `EXECUTION_DENY_LIST` (the canonical
 *     safety-critical set) plus the structural order/cancel/wallet/close
 *     name shape, so a new destructive tool is classified correctly even
 *     before it lands on the deny-list.
 *   - read-only / write / open-world derive from the tool-domain name
 *     shape (get_/fetch_/scan_/compute_ vs place_/cancel/memory_write).
 *
 * Defaults lean conservative: a tool that matches no read pattern is NOT
 * marked read-only, and anything that is not a pure local computation is
 * treated as open-world — the host errs toward asking, not toward silent
 * auto-approval.
 */

import { EXECUTION_DENY_LIST } from "./exposeServer.ts";

/**
 * Standard MCP `ToolAnnotations` behavioral-hint subset. Shape matches the
 * spec's `annotations` object on a tool descriptor.
 */
export interface BehavioralHints {
  readOnlyHint: boolean;
  destructiveHint: boolean;
  idempotentHint: boolean;
  openWorldHint: boolean;
}

/**
 * Structural mutation shape — order placement, cancels, closes, wallet
 * moves, plan execution, trailing-stop writes. Complements the explicit
 * `EXECUTION_DENY_LIST` so a state-mutating tool is caught by name shape
 * even if it has not been enumerated on the deny-list yet.
 */
const DESTRUCTIVE_PATTERN =
  /^(place_|cancel|execute_|close_|withdraw|wallet_|liquidate|flatten|set_trailing|update_trailing|set_permission)/;

/**
 * Local, non-external tools — indicator/regime/risk/microstructure math,
 * local memory, local audit log, plan construction/verification. These do
 * NOT reach a venue, the web, or a news feed, so `openWorldHint` is false.
 */
const PURE_COMPUTE_PATTERN = /^(compute_|calculate_|verify_|create_plan|memory_|audit_)/;

/**
 * Read shape — price/account/news reads, scans, searches, and pure
 * simulations (backtests) that observe without mutating.
 */
const READ_PATTERN =
  /^(get_|fetch_|list_|search_|scan_|read_|find_|compute_|calculate_|analyze_|evaluate_|verify_|backtest|query_|check_|describe_|memory_search)/;

/**
 * Write-but-not-destructive shape — creates a record / plan / schedule but
 * does not move money or place a market order. Not read-only, not
 * destructive.
 */
const WRITE_PATTERN =
  /^(create_|write_|save_|record_|approve_|set_|update_|schedule_|delegate_|arm_|ask_user|report_|memory_write|audit_event)/;

/**
 * True when the tool can perform an irreversible / money-moving action.
 * Anchored on the canonical deny-list, widened by the structural shape.
 */
export function isDestructiveTool(toolId: string): boolean {
  if (EXECUTION_DENY_LIST.has(toolId)) return true;
  return DESTRUCTIVE_PATTERN.test(toolId);
}

/**
 * True when the tool observes state without modifying it. Destructive and
 * write tools are excluded first; the remainder qualifies only if it
 * matches a read shape (so an unrecognized name is NOT auto-marked
 * read-only).
 */
export function isReadOnlyTool(toolId: string): boolean {
  if (isDestructiveTool(toolId)) return false;
  if (WRITE_PATTERN.test(toolId)) return false;
  return READ_PATTERN.test(toolId);
}

/**
 * True when repeating the call with identical args has no additional
 * effect. Reads are trivially idempotent; among mutations only cancels and
 * set/update-value ops are (placing / executing creates new state each
 * call).
 */
export function isIdempotentTool(toolId: string): boolean {
  if (isReadOnlyTool(toolId)) return true;
  if (/^cancel/.test(toolId)) return true;
  if (/^(set_|update_)/.test(toolId)) return true;
  return false;
}

/**
 * True when the tool reaches external entities (venues, web, news feeds).
 * Only pure local computations (indicator math, local memory, local audit,
 * plan construction) are closed-world.
 */
export function hitsOpenWorld(toolId: string): boolean {
  return !PURE_COMPUTE_PATTERN.test(toolId);
}

/**
 * Derive the full standard behavioral-hint bag for a tool id from the
 * existing safety signals. Returned shape is spec-compliant MCP
 * `annotations`.
 */
export function deriveToolHints(toolId: string): BehavioralHints {
  return {
    readOnlyHint: isReadOnlyTool(toolId),
    destructiveHint: isDestructiveTool(toolId),
    idempotentHint: isIdempotentTool(toolId),
    openWorldHint: hitsOpenWorld(toolId),
  };
}
