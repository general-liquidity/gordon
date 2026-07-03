import type { BrokerId } from "../types.ts";

export interface BrokerInclusionCriteria {
  retailB2COnboarding: boolean;
  documentedExecutionEndpoints: boolean;
  apiTermsAllowCustomerExecution: boolean;
  paperOrSafeDryRunPath: boolean;
  tsRuntimeAuthMaintainable: boolean;
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
      paperOrSafeDryRunPath: true,
      tsRuntimeAuthMaintainable: true,
    },
    rationale: "Client-portal style execution APIs support retail/pro accounts and TS adapter abstraction.",
  },
};

export function getBrokerInclusionDecision(brokerId: BrokerId): BrokerInclusionDecision {
  return BROKER_INCLUSION_GATE[brokerId];
}

export function getFailedCriteria(criteria: BrokerInclusionCriteria): Array<keyof BrokerInclusionCriteria> {
  const failed: Array<keyof BrokerInclusionCriteria> = [];
  for (const [key, value] of Object.entries(criteria) as Array<[keyof BrokerInclusionCriteria, boolean]>) {
    if (!value) failed.push(key);
  }
  return failed;
}

export function validateBrokerInclusionGate(brokerIds: readonly BrokerId[]): {
  approved: boolean;
  failures: BrokerInclusionFailure[];
} {
  const failures: BrokerInclusionFailure[] = [];

  for (const brokerId of brokerIds) {
    const decision = getBrokerInclusionDecision(brokerId);
    const failedCriteria = getFailedCriteria(decision.criteria);
    if (!decision.approved || failedCriteria.length > 0 || decision.segment !== "b2c") {
      failures.push({ brokerId, failedCriteria });
    }
  }

  return {
    approved: failures.length === 0,
    failures,
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
