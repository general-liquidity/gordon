# Research (Backtest Research Loop)

Self-directed strategy research mode. Gordon forms hypotheses, runs backtests, screens verdicts, records experiments, and iterates without waiting for permission each cycle. Named `/research` to avoid collision with the existing `/lab` workspace menu command.

## When to use

- User invokes `/research start` or explicitly asks to iterate on strategies
- User wants to explore a new setup idea and doesn't know yet if it works
- After a losing week — research mode is where you figure out what changed
- Paired with the playbook evolution system — successful research loops become new playbooks

## The loop

1. **Form a hypothesis**. Write it as a single sentence: "I think <signal> on <symbol> <timeframe> will work because <reason>." The hypothesis gets captured in the experiment journal alongside the verdict.
2. **Check preconditions** — call `check_backtest_preconditions` with your config. Pulls limits from the live risk kernel config, so passing the gate means passing the live constitution too. Violations abort before the engine runs.
3. **Run the backtest** — call `run_backtest` with the validated config.
4. **Screen the result** — call `screen_backtest_result` with the metrics. Returns a machine-parseable `[VERDICT]` line: ELIGIBLE, DISCARD_SAMPLE_SIZE, DISCARD_RISK, DISCARD_PROFIT, or CRASH.
5. **Record the experiment** — call `record_backtest_experiment` with hypothesis AND verdict. Journal at `~/.gordon/backtest-experiments.jsonl` becomes the audit trail.
6. **Decide next step**:
   - **ELIGIBLE**: consider promoting to a playbook or paper-trading. One eligible run is not proof — do walk-forward before promoting.
   - **DISCARD_SAMPLE_SIZE**: strategy didn't trade enough. Loosen entry criteria or extend the window, but chronic sample-size failures usually mean the setup is too rare.
   - **DISCARD_RISK**: drawdown exceeded the cap. Tighten stops, reduce size, or reconsider the edge.
   - **DISCARD_PROFIT**: Sharpe or Calmar below threshold. Trades enough but doesn't earn enough risk-adjusted return.
   - **CRASH**: config was structurally broken. Fix it before the next iteration.
7. **Form the next hypothesis**. Iterate without pausing for permission.

## Discipline rules

- **Always record a hypothesis before seeing the verdict.** Capture the belief being tested so misses are auditable without hindsight bias.
- **Never modify verdict thresholds to game screening.** The `thresholdsOverride` parameter exists for legitimate tuning, not for gaming. The journal catches it; the discipline catches it earlier.
- **Step back after 10+ consecutive discards.** If nothing lands an ELIGIBLE, your hypothesis-generation approach probably needs to change. Say this out loud in the next hypothesis so it's auditable.
- **Check journal stats periodically.** Every 20 experiments, call `get_backtest_journal_stats` to see if your eligible rate is improving. A declining trend means your ideas are getting worse.

## Slash commands

- `/research start` — begin a new research loop
- `/research status` — recent experiments from the journal with verdicts
- `/research stats` — aggregate journal stats (eligible rate %, avg Sharpe, verdict distribution)

## Tools used

- `check_backtest_preconditions` — pre-run parameter gate (risk kernel limits)
- `run_backtest` — the backtest engine
- `screen_backtest_result` — two-layer verdict computation
- `record_backtest_experiment` — append to journal
- `list_backtest_experiments` — read journal
- `get_backtest_journal_stats` — aggregate stats
- `record_confident_decision` (optional) — log the hypothesis as a calibratable decision

## The persistent journal

`~/.gordon/backtest-experiments.jsonl` is append-only. Earlier sessions inform later ones even after a restart. This is deliberate — research is a long-term activity, not a session-scoped one.
