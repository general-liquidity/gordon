import type { BrokerId } from "../types.ts";

/**
 * `"unverifiable"` is distinct from `false`: the criterion is neither met nor
 * refuted because the integration cannot observe it. It must never be read as
 * a guarantee, and it is reported separately from an outright failure.
 */
export type BrokerInclusionCriterion = boolean | "unverifiable";

export interface BrokerInclusionCriteria {
  retailB2COnboarding: BrokerInclusionCriterion;
  documentedExecutionEndpoints: BrokerInclusionCriterion;
  apiTermsAllowCustomerExecution: BrokerInclusionCriterion;
  paperOrSafeDryRunPath: BrokerInclusionCriterion;
  tsRuntimeAuthMaintainable: BrokerInclusionCriterion;
}

export interface BrokerInclusionDecision {
  brokerId: BrokerId;
  segment: "b2c";
  approved: boolean;
  criteria: BrokerInclusionCriteria;
  rationale: string;
}

export interface BrokerInclusionFailure {
  brokerId: BrokerId;
  failedCriteria: Array<keyof BrokerInclusionCriteria>;
}

export interface BrokerInclusionUnverified {
  brokerId: BrokerId;
  unverifiableCriteria: Array<keyof BrokerInclusionCriteria>;
}

export const BROKER_INCLUSION_GATE: Record<BrokerId, BrokerInclusionDecision> = {
  alpaca: {
    brokerId: "alpaca",
    segment: "b2c",
    approved: true,
    criteria: {
      retailB2COnboarding: true,
      documentedExecutionEndpoints: true,
      apiTermsAllowCustomerExecution: true,
      paperOrSafeDryRunPath: true,
      tsRuntimeAuthMaintainable: true,
    },
    rationale: "Retail-first API with mature paper/live execution paths and stable TS integration.",
  },
  tastytrade: {
    brokerId: "tastytrade",
    segment: "b2c",
    approved: true,
    criteria: {
      retailB2COnboarding: true,
      documentedExecutionEndpoints: true,
      apiTermsAllowCustomerExecution: true,
      paperOrSafeDryRunPath: true,
      tsRuntimeAuthMaintainable: true,
    },
    rationale: "Retail API with account/order workflows and maintainable auth lifecycle in TS runtime.",
  },
  ibkr: {
    brokerId: "ibkr",
    segment: "b2c",
    approved: true,
    criteria: {
      retailB2COnboarding: true,
      documentedExecutionEndpoints: true,
      apiTermsAllowCustomerExecution: true,
      // The gateway is a local bridge on one URL; paper versus live is decided
      // by the account logged into it, which the adapter cannot observe.
      paperOrSafeDryRunPath: "unverifiable",
      tsRuntimeAuthMaintainable: true,
    },
    rationale:
      "Client-portal style execution APIs support retail/pro accounts and TS adapter abstraction. " +
      "Paper-versus-live is not observable from the gateway, so no dry-run guarantee is claimed.",
  },
};

export function getBrokerInclusionDecision(brokerId: BrokerId): BrokerInclusionDecision {
  return BROKER_INCLUSION_GATE[brokerId];
}

export function getFailedCriteria(criteria: BrokerInclusionCriteria): Array<keyof BrokerInclusionCriteria> {
  const failed: Array<keyof BrokerInclusionCriteria> = [];
  for (const [key, value] of Object.entries(criteria) as Array<[keyof BrokerInclusionCriteria, BrokerInclusionCriterion]>) {
    if (value === false) failed.push(key);
  }
  return failed;
}

/** Criteria the integration cannot observe. Never a guarantee, never a failure. */
export function getUnverifiableCriteria(criteria: BrokerInclusionCriteria): Array<keyof BrokerInclusionCriteria> {
  const unverifiable: Array<keyof BrokerInclusionCriteria> = [];
  for (const [key, value] of Object.entries(criteria) as Array<[keyof BrokerInclusionCriteria, BrokerInclusionCriterion]>) {
    if (value === "unverifiable") unverifiable.push(key);
  }
  return unverifiable;
}

export function validateBrokerInclusionGate(brokerIds: readonly BrokerId[]): {
  approved: boolean;
  failures: BrokerInclusionFailure[];
  unverified: BrokerInclusionUnverified[];
} {
  const failures: BrokerInclusionFailure[] = [];
  const unverified: BrokerInclusionUnverified[] = [];

  for (const brokerId of brokerIds) {
    const decision = getBrokerInclusionDecision(brokerId);
    const failedCriteria = getFailedCriteria(decision.criteria);
    if (!decision.approved || failedCriteria.length > 0 || decision.segment !== "b2c") {
      failures.push({ brokerId, failedCriteria });
    }
    const unverifiableCriteria = getUnverifiableCriteria(decision.criteria);
    if (unverifiableCriteria.length > 0) {
      unverified.push({ brokerId, unverifiableCriteria });
    }
  }

  return {
    approved: failures.length === 0,
    failures,
    unverified,
  };
}

export function assertBrokerPassesInclusionGate(brokerId: BrokerId): void {
  const decision = getBrokerInclusionDecision(brokerId);
  const failedCriteria = getFailedCriteria(decision.criteria);

  if (!decision.approved || decision.segment !== "b2c" || failedCriteria.length > 0) {
    const details = [
      `broker=${brokerId}`,
      `segment=${decision.segment}`,
      `approved=${decision.approved}`,
      failedCriteria.length > 0 ? `failed=${failedCriteria.join(",")}` : undefined,
    ]
      .filter(Boolean)
      .join(" ");
    throw new Error(`Broker failed B2C inclusion gate: ${details}`);
  }
}
