/**
 * Regime → Allocation Policy via Tabular Policy Iteration
 * (Verma, Putri & Lesupi 2025, "Regime-Based Portfolio Allocation Using HMMs
 * and Reinforcement Learning", §6)
 *
 * The one genuinely-missing piece from that paper: an interpretable MDP whose
 * STATE is the market regime, whose ACTIONS are discrete portfolio-weight
 * vectors, whose DYNAMICS are the regime transition matrix, and whose REWARDS
 * are state-conditional asset returns. Solving it yields π* — a regime → weights
 * lookup. Distinct from everything Gordon already has:
 *   - `hmmRegime.ts` / `markov-regime.ts` / `core/regime/` — DETECT regimes
 *     (and `fitHmmRegime` already produces the transition matrix this consumes).
 *   - `allocator.ts` — allocation strategies, but NONE regime-conditional.
 *   - `metaWeighting.ts` — regime-aware signal weighting, not a regime→weights
 *     policy.
 *   - `consensus/protocol.ts` `allowed_regimes` — a regime GATE, not a map.
 *
 * Composition: `fitHmmRegime(returns)` → `{ transitions, statePath }`, then
 * `stateConditionalReturns(statePath, assetReturns)` → per-regime per-asset
 * expected returns, then `regimePolicyIteration({ transitions, actions,
 * expectedReturns })` → π*.
 *
 * A note on correctness the paper glosses: the regime transition is taken as
 * INDEPENDENT of the allocation (a price-taker assumption — your weights don't
 * move the market regime). Under that assumption the continuation term
 * γ·Σ P(s,s')V(s') is identical across actions, so the optimal policy is the
 * argmax of the (optionally transition-weighted) immediate reward, and the
 * discount γ changes the VALUE but not the POLICY. Full policy iteration is
 * still implemented (it generalizes to action-dependent transitions and yields
 * the correct value function for policy comparison).
 *
 * Pure functions.
 */

// ---------------------------------------------------------------------------
// State-conditional returns (the paper's Table 3 builder)
// ---------------------------------------------------------------------------

export interface StateConditionalReturns {
  /** meanReturns[state][asset] — average return of `asset` while in `state`. */
  meanReturns: number[][];
  /** Number of observations assigned to each state. */
  counts: number[];
}

/**
 * Group each asset's returns by the regime each period was in (e.g. a Viterbi
 * path from `fitHmmRegime`) and average — the per-regime, per-asset expected
 * returns that become the MDP reward inputs. `assetReturns[asset][t]` aligned
 * with `statePath[t]`; states are 0..nStates-1.
 */
export function stateConditionalReturns(
  statePath: number[],
  assetReturns: number[][],
  nStates: number,
): StateConditionalReturns {
  const nAssets = assetReturns.length;
  const sums: number[][] = Array.from({ length: nStates }, () => new Array(nAssets).fill(0));
  const counts = new Array(nStates).fill(0);

  for (let t = 0; t < statePath.length; t++) {
    const s = statePath[t]!;
    if (s < 0 || s >= nStates) continue;
    counts[s]++;
    for (let a = 0; a < nAssets; a++) {
      const r = assetReturns[a]?.[t];
      if (typeof r === "number" && Number.isFinite(r)) sums[s]![a] = sums[s]![a]! + r;
    }
  }

  const meanReturns = sums.map((row, s) =>
    row.map((sum) => (counts[s]! > 0 ? sum / counts[s]! : 0)),
  );
  return { meanReturns, counts };
}

// ---------------------------------------------------------------------------
// Action-set builder
// ---------------------------------------------------------------------------

/**
 * A reasonable default discrete action set over `nAssets`: every pure
 * single-asset position (100% in one asset) plus the equal-weight portfolio.
 * Callers can pass their own action set (e.g. the paper's 7 TLT/GLD/SPY
 * combinations) instead.
 */
export function defaultDiscreteActions(nAssets: number): number[][] {
  const actions: number[][] = [];
  for (let i = 0; i < nAssets; i++) {
    const w = new Array(nAssets).fill(0);
    w[i] = 1;
    actions.push(w);
  }
  if (nAssets > 1) actions.push(new Array(nAssets).fill(1 / nAssets));
  return actions;
}

// ---------------------------------------------------------------------------
// The MDP solver
// ---------------------------------------------------------------------------

export type RewardModel = "current" | "lookahead";

export interface RegimeMdpInput {
  /** Regime transition matrix. transitions[s][s'] = P(s' | s). Rows sum to ~1. */
  transitions: number[][];
  /** Discrete actions: each a portfolio-weight vector over nAssets. */
  actions: number[][];
  /** expectedReturns[state][asset] — per-regime per-asset expected return. */
  expectedReturns: number[][];
  /**
   * Reward model. "current" = reward from the current regime's returns;
   * "lookahead" = transition-weighted next-period return (you set weights in
   * regime s, the return realizes in the regime you transition into). The
   * lookahead model is the more faithful one for a 1-period-lag allocation.
   * Default "current".
   */
  rewardModel?: RewardModel;
  /**
   * Fully override the reward with an explicit nStates × nActions matrix. When
   * set, expectedReturns / rewardModel are ignored.
   */
  rewardMatrix?: number[][];
  /** Discount factor γ ∈ [0, 1). Default 0.9. */
  discount?: number;
  /** Max policy-iteration sweeps. Default 200. */
  maxIterations?: number;
  /** Policy-evaluation convergence tolerance. Default 1e-12. */
  tolerance?: number;
}

export interface RegimeMdpResult {
  /** policy[state] = chosen action index. */
  policy: number[];
  /** policy resolved to weight vectors: policyWeights[state] = actions[policy[state]]. */
  policyWeights: number[][];
  /** Discounted state values V(s) under π*. */
  values: number[];
  /** Q[state][action]. */
  qValues: number[][];
  iterations: number;
  converged: boolean;
  summary: string;
}

function dot(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i]! * (b[i] ?? 0);
  return s;
}

/** Build the nStates × nActions reward matrix from expectedReturns + actions. */
function buildRewardMatrix(
  transitions: number[][],
  actions: number[][],
  expectedReturns: number[][],
  model: RewardModel,
): number[][] {
  const nStates = transitions.length;
  const nActions = actions.length;
  const R: number[][] = Array.from({ length: nStates }, () => new Array(nActions).fill(0));
  for (let s = 0; s < nStates; s++) {
    for (let a = 0; a < nActions; a++) {
      if (model === "current") {
        R[s]![a] = dot(actions[a]!, expectedReturns[s] ?? []);
      } else {
        // lookahead: Σ_s' P(s,s') · ⟨weights_a, returns[s']⟩
        let r = 0;
        for (let sp = 0; sp < nStates; sp++) {
          r += (transitions[s]![sp] ?? 0) * dot(actions[a]!, expectedReturns[sp] ?? []);
        }
        R[s]![a] = r;
      }
    }
  }
  return R;
}

/** Iterative policy evaluation: V(s) = R(s,π(s)) + γ Σ_s' P(s,s') V(s'). */
function evaluatePolicy(
  policy: number[],
  R: number[][],
  transitions: number[][],
  discount: number,
  tolerance: number,
  maxSweeps: number,
): number[] {
  const nStates = transitions.length;
  const V = new Array(nStates).fill(0);
  for (let sweep = 0; sweep < maxSweeps; sweep++) {
    let delta = 0;
    for (let s = 0; s < nStates; s++) {
      let cont = 0;
      for (let sp = 0; sp < nStates; sp++) cont += (transitions[s]![sp] ?? 0) * V[sp]!;
      const v = R[s]![policy[s]!]! + discount * cont;
      delta = Math.max(delta, Math.abs(v - V[s]!));
      V[s] = v;
    }
    if (delta < tolerance) break;
  }
  return V;
}

/**
 * Solve the regime-allocation MDP by policy iteration. Returns the optimal
 * policy π* (regime → action), its value function, and the Q-table.
 */
export function regimePolicyIteration(input: RegimeMdpInput): RegimeMdpResult {
  const transitions = input.transitions;
  const actions = input.actions;
  const nStates = transitions.length;
  const nActions = actions.length;
  const discount = input.discount ?? 0.9;
  const maxIterations = input.maxIterations ?? 200;
  const tolerance = input.tolerance ?? 1e-12;
  const model = input.rewardModel ?? "current";

  if (nStates === 0 || nActions === 0) {
    return {
      policy: [],
      policyWeights: [],
      values: [],
      qValues: [],
      iterations: 0,
      converged: true,
      summary: "Empty MDP (no states or no actions).",
    };
  }

  const R =
    input.rewardMatrix ??
    buildRewardMatrix(transitions, actions, input.expectedReturns ?? [], model);

  // Initialize the policy greedily on immediate reward.
  let policy = new Array(nStates).fill(0);
  for (let s = 0; s < nStates; s++) {
    let best = 0;
    for (let a = 1; a < nActions; a++) if (R[s]![a]! > R[s]![best]!) best = a;
    policy[s] = best;
  }

  let V = new Array(nStates).fill(0);
  let iterations = 0;
  let converged = false;

  for (let iter = 0; iter < maxIterations; iter++) {
    iterations = iter + 1;
    // Policy evaluation.
    V = evaluatePolicy(policy, R, transitions, discount, tolerance, 10_000);
    // Policy improvement.
    const newPolicy = policy.slice();
    let stable = true;
    for (let s = 0; s < nStates; s++) {
      let cont = 0;
      for (let sp = 0; sp < nStates; sp++) cont += (transitions[s]![sp] ?? 0) * V[sp]!;
      let bestA = 0;
      let bestQ = R[s]![0]! + discount * cont;
      for (let a = 1; a < nActions; a++) {
        const q = R[s]![a]! + discount * cont;
        if (q > bestQ) {
          bestQ = q;
          bestA = a;
        }
      }
      newPolicy[s] = bestA;
      if (bestA !== policy[s]) stable = false;
    }
    policy = newPolicy;
    if (stable) {
      converged = true;
      break;
    }
  }

  // Final value + Q-table under the converged policy.
  V = evaluatePolicy(policy, R, transitions, discount, tolerance, 10_000);
  const qValues: number[][] = Array.from({ length: nStates }, () => new Array(nActions).fill(0));
  for (let s = 0; s < nStates; s++) {
    let cont = 0;
    for (let sp = 0; sp < nStates; sp++) cont += (transitions[s]![sp] ?? 0) * V[sp]!;
    for (let a = 0; a < nActions; a++) qValues[s]![a] = R[s]![a]! + discount * cont;
  }

  const policyWeights = policy.map((a) => actions[a]!);
  const summary =
    `Regime→allocation π* over ${nStates} regimes × ${nActions} actions ` +
    `(γ=${discount}, ${model} reward): ` +
    policy
      .map((a, s) => `S${s}→A${a}[${actions[a]!.map((w) => w.toFixed(2)).join(",")}]`)
      .join("  ") +
    (converged ? "" : " [did not converge]");

  return {
    policy,
    policyWeights,
    values: V.map((v) => parseFloat(v.toFixed(8))),
    qValues: qValues.map((row) => row.map((q) => parseFloat(q.toFixed(8)))),
    iterations,
    converged,
    summary,
  };
}
