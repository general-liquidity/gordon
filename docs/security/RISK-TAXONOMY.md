# Gordon Risk Taxonomy

> **What this is.** A human-readable risk model for a money-handling agent, mapping each
> attack/failure category to the **existing** control that mitigates it. This is documentation
> only — it adds no enforcement. Every cross-reference below points at a real file/mechanism
> in the codebase (verified). If you change a control, update its row here.
>
> This is the "policy.md" analog of layered security organization (cf. Codex / Claude Code):
> a single parent document that names the risks and points at where they are already enforced.

Companion document: [`PERMISSION-PROFILES.md`](./PERMISSION-PROFILES.md) (named trust profiles).
Top-level reporting policy: [`../../SECURITY.md`](../../SECURITY.md).

---

## How to read this

Gordon's enforcement is **deny-first and layered**. No single control is the whole defense;
the taxonomy below shows which layer owns which risk. The non-negotiable invariant across all
of them: **safety-critical tools never auto-approve, regardless of trust, profile, or prompt.**

| Layer | Owner file | Role |
|---|---|---|
| Permission gate | `src/runtime/permissions/PermissionEngine.ts` | Deny-first hook chain; `allow / deny / queue / abstain` per tool call |
| Safety-critical deny-list | `src/runtime/permissions/trustTrajectory.ts` (`SAFETY_CRITICAL_PATTERNS`, `isSafetyCritical`) | Tools that can NEVER auto-approve via trust |
| Risk classifier | `src/infra/trading/risk/riskClassifier.ts` (`classifyTradeRisk`, 15 dims) | Per-trade composite score → `auto_approve / prompt_user / require_confirmation / block` |
| Trading constitution | `src/infra/safety/defense/tradingConstitution.ts` (`TRADING_CONSTITUTION`) | Immutable hard limits the LLM/user cannot override |
| Kill switches | `src/infra/safety/killSwitches.ts` (`isExecutionAllowed`) | Multi-scope tripwires gating any irreversible action |
| Injection defense | `src/infra/safety/defense/injectionDefense.ts` | Pattern defense run before input reaches the agent |
| Value redaction | `src/infra/platform/observability/valueRedaction.ts` (`redactDeep`, `redactString`), wired in `src/infra/logger/logger.ts` | Strips secrets from logs/error traces |

---

## Risk categories

### 1. Unauthorized order / execution
The agent places, modifies, or executes an order the operator did not authorize.

- **Primary control:** safety-critical deny-list — `SAFETY_CRITICAL_PATTERNS` in
  `src/runtime/permissions/trustTrajectory.ts` includes `execute_plan`, `place_order`,
  `place_market_order`, `place_limit_order`, `place_bracket_order`, `place_oco_order`,
  `execute_trade`, `submit_order`. `isSafetyCritical()` makes these **never** eligible for
  trust-trajectory auto-approval.
- **Engine enforcement:** `PermissionEngine.evaluate()` suppresses a *broad* persisted `allow`
  rule (wildcard/scope-only) for a deny-listed tool (`safetyCriticalAllowSuppressed`), so a
  remembered approval can't silently auto-fire a safety-critical tool.
- **Rationale audit:** `execute_plan` and `cancel` carry a required `rationale` (min 10 chars)
  in `src/infra/agents/tools/surface/plan.ts` — intent is logged, not just the call.

### 2. Oversize / over-leverage position
A trade exceeds prudent sizing or leverage.

- **Primary control:** `classifyTradeRisk` in `src/infra/trading/risk/riskClassifier.ts` —
  the **Position Size**, **Concentration**, **Vol-Adjusted Sizing**, and **Correlation Risk**
  dimensions raise the composite score; `tier: "critical"` maps to `recommendation: "block"`.
- **Hard ceiling:** `TRADING_CONSTITUTION` in `src/infra/safety/defense/tradingConstitution.ts`
  — `MAX_POSITION_SIZE_PCT` (5), `ABSOLUTE_MAX_POSITION_PCT` (10), `MAX_LEVERAGE` (3),
  `MAX_CORRELATED_EXPOSURE_PCT` (25). These are immutable: the comment states the LLM cannot
  override and the user cannot disable them.

### 3. Excessive drawdown / loss-budget breach
Trading continues past the operator's loss tolerance.

- **Primary control:** `classifyTradeRisk` **Drawdown Proximity** + **Daily Loss Budget**
  dimensions.
- **Hard halt:** `TRADING_CONSTITUTION.MAX_DAILY_LOSS_PCT` (3), `MAX_DRAWDOWN_HALT_PCT` (10),
  `RAPID_LOSS_HALT_PCT` (2), `CONSECUTIVE_LOSS_HALT` (5), `EMERGENCY_LIQUIDATION_PCT` (15).

### 4. Fund transfer / withdrawal abuse
The agent moves funds off-venue or to an unauthorized destination.

- **Primary control:** safety-critical deny-list — `wallet_send`, `wallet_transfer`,
  `transfer_funds`, `withdraw`, `approve_token` are all in `SAFETY_CRITICAL_PATTERNS`
  (`src/runtime/permissions/trustTrajectory.ts`). Never trust-auto-approved; always routed to
  the human/confirmation path by `PermissionEngine`.
- **Scope separation:** these run under the `transfer.execute` / `wallet.write` permission
  scopes (`RuntimePermissionScope` in `src/runtime/contracts/types.ts`), distinct from
  read/analysis scopes — a paper or read approval credits no trust toward a transfer.

### 5. Credential exfiltration
Exchange/broker API keys, OAuth/MCP tokens, or working-memory contents leak into logs, error
traces, or third-party requests.

- **Primary control:** `redactDeep` / `redactString` in
  `src/infra/platform/observability/valueRedaction.ts`, wired into structured logging at
  `src/infra/logger/logger.ts` (applied to `entry.context`, `error.message`, `error.stack`).
- **Hot-tier cap:** working-memory hot tier is capped (see `memoryGate.ts`, referenced in
  `SECURITY.md` and `CLAUDE.md`) to prevent credential bleed into prompt context.
- **Scope:** see `SECURITY.md` → "Credential leakage" (in scope) and "Cryptography & credentials".

### 6. Kill-switch bypass
An irreversible action fires while a kill switch is tripped.

- **Primary control:** `isExecutionAllowed(ctx)` in `src/infra/safety/killSwitches.ts` — the
  single gate to consult before any irreversible action, across the scope hierarchy
  `strategy → trader → account → client → instrument → venue → gateway → firm`. Trips persist
  to disk and survive restart; resetting requires a logged rationale.
- **Deny-list overlap:** `skill_install`, `exec_shell`, `run_shell` are also in
  `SAFETY_CRITICAL_PATTERNS` so loader/shell escalation can't be trust-approved.

### 7. Market-data spoofing / fake liquidity
The agent acts on wash-traded volume or a manipulated book.

- **Primary control:** `classifyTradeRisk` **Fake Liquidity** dimension (verdict
  `fake_liquidity` → score 85) and **Venue MEV Exposure** dimension in
  `src/infra/trading/risk/riskClassifier.ts`.
- **Detector source:** microstructure detectors (MS-series) referenced in `SECURITY.md`
  "Out of scope" — Gordon detects and refuses adversarial market behavior.

### 8. Prompt injection triggering financial action
Model context or tool results coerce Gordon into placing/cancelling/modifying orders without an
authorized operator prompt.

- **Primary control:** `src/infra/safety/defense/injectionDefense.ts` — pattern defense
  (`instruction_override`, `role_impersonation`, `mode_manipulation`, `emergency_exploit`,
  `encoding_obfuscation`) run **before** input reaches the agent; high-risk matches block.
- **Untrusted content:** `wrapUntrustedContent` from `src/infra/security/untrustedContent.ts`
  (imported by `injectionDefense.ts`) fences tool/feed content.
- **Backstop:** even if injection slips through, the safety-critical deny-list (#1) means any
  resulting order/transfer/cancel still cannot auto-fire — it routes to human approval. This is
  the SECURITY.md "and that the existing safety chain fails to refuse" qualifier.

---

## What this taxonomy does NOT do

- It does **not** add or change enforcement. All controls above predate this document.
- It does **not** relax the deny-list or the constitution for any profile. See
  `PERMISSION-PROFILES.md` — profiles gate the *easy* stuff; safety-critical always prompts.
