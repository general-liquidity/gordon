# Security Policy

Gordon is an autonomous trading agent. A vulnerability here can move money, leak API keys, or place orders on the operator's behalf. We treat security reports as high priority.

## Reporting a vulnerability

**Do not** open a public GitHub issue for security reports.

Email **security@general-liquidity.com** with:

- A clear description of the issue and its impact
- Steps to reproduce (ideally a minimal repro against `main`)
- The version (`gordon --version`) and platform (`win32` / `darwin` / `linux`)
- Whether you've shared details with anyone else

You'll get an acknowledgment within **2 business days**. We aim to triage within **7 days** and ship a fix or mitigation within **30 days** of confirmation for high-severity issues. Coordinated disclosure on a timeline we agree together.

If you don't hear back in 3 business days, follow up at `tibi.toca@gmail.com`.

## Security model documentation

Two layered "parent" documents describe Gordon's security posture and map each risk to the
control that already enforces it (documentation only — they add no enforcement):

- [`docs/security/RISK-TAXONOMY.md`](docs/security/RISK-TAXONOMY.md) — the risk model: each
  category (unauthorized order, oversize/leverage, fund transfer, credential exfiltration,
  kill-switch bypass, market-data spoofing, prompt injection) mapped to its existing control.
- [`docs/security/PERMISSION-PROFILES.md`](docs/security/PERMISSION-PROFILES.md) — three named
  trust profiles (`read_only` → `paper_trading` → `live_trading`) as an inheritance chain. No
  profile relaxes the safety-critical deny-list or risk gate.

## In scope

The following are treated as security issues, not feature requests:

- **Permission bypass** — anything that lets a tool execute without going through `src/runtime/permissions/PermissionEngine.ts`, including trust-trajectory short-circuits past the safety-critical deny-list (`place_order`, `execute_trade`, `cancel_order`, `wallet_transfer`, etc.)
- **Risk-gate circumvention** — paths that reach the order layer while skipping `riskClassifier`, `killSwitches`, `preTradeRateControls`, or `manipulationContext` when those gates are wired
- **Order-routing tampering** — modifying order parameters (size, side, price, symbol, venue) between user approval and broker submission
- **Credential leakage** — exchange/broker API keys, OAuth tokens, MCP auth tokens, session cookies, or working-memory contents appearing in logs, stdout, error traces, structured observations, screen-shares, or third-party requests
- **Prompt injection that triggers financial action** — model context or tool results that cause Gordon to place, cancel, or modify orders without an authorized operator prompt — and that the existing safety chain fails to refuse
- **Hook engine integrity** — execution paths that fire `place_order` or similar irreversible tools without invoking `PreToolUse` / `PreOrderPlacement` hooks, including async-rewake bypasses
- **Audit-trail tampering** — changes that make a tool call, decision, or hook outcome unrecoverable from the structured-observation stream (Axiom) or decision log
- **Supply-chain** — compromised dependencies, MCP servers Gordon connects to, or plugin loaders that execute arbitrary code without operator approval
- **Sandbox escape** — anything in Gordon's plugin / skill / hook loaders that escalates from operator-scoped to host-process privileges

## Out of scope

Reports for these will generally be closed without action:

- Theoretical attacks requiring physical access to the operator's machine
- Social engineering (the operator authorizing a malicious action remains the operator's decision)
- Vulnerabilities in third-party brokers / exchanges / data providers — report those upstream
- Issues that require explicit operator approval at every step Gordon currently surfaces approval for
- Adversarial market behavior (frontrunning, quote stuffing) — Gordon detects and refuses these via MS1-MS12; new evasions are welcome as research notes, not security reports
- Self-DoS by giving Gordon a clearly absurd prompt
- Outdated dependency warnings without a concrete exploit path
- Issues in pre-1.0 friends-build features explicitly marked as `shadow-mode` or `cold (flag-gated)` — these don't reach production order paths

## Cryptography & credentials

- API keys never appear in `git log`, `git diff`, or any committed file. If you find one, treat it as a high-severity report.
- Working-memory hot tier is capped at 2,200 chars by `memoryGate.ts` to prevent credential bleed into prompt context. Any path that bypasses this cap is in scope.
- Keychain storage (libsecret / macOS Keychain / Windows DPAPI) is the intended credential store; env-var paths exist as a fallback. Persisting credentials in plaintext at rest is in scope.

## Disclosure

We'll credit reporters in the release notes for the fix release unless you prefer to remain anonymous. We don't run a paid bounty program at this time.

## Production trading caveat

Gordon can place real orders on real exchanges when the operator wires API keys and approves live trading. This is not a research toy. If you find a way to make Gordon take a financial action the operator didn't authorize, **email us before testing it on a funded account** — including your own.
