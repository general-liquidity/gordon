import type { BrokerId } from "./types.ts";

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
  webull: {
    brokerId: "webull",
    segment: "b2c",
    approved: true,
    criteria: {
      retailB2COnboarding: true,
      documentedExecutionEndpoints: true,
      apiTermsAllowCustomerExecution: true,
      paperOrSafeDryRunPath: true,
      tsRuntimeAuthMaintainable: true,
    },
    rationale: "Retail broker with execution APIs and maintainable signed-request TS adapter path.",
  },
  schwab: {
    brokerId: "schwab",
    segment: "b2c",
    approved: true,
    criteria: {
      retailB2COnboarding: true,
      documentedExecutionEndpoints: true,
      apiTermsAllowCustomerExecution: true,
      paperOrSafeDryRunPath: true,
      tsRuntimeAuthMaintainable: true,
    },
    rationale: "Retail brokerage API with documented account/order surfaces suitable for TS adapters.",
  },
  tradier: {
    brokerId: "tradier",
    segment: "b2c",
    approved: true,
    criteria: {
      retailB2COnboarding: true,
      documentedExecutionEndpoints: true,
      apiTermsAllowCustomerExecution: true,
      paperOrSafeDryRunPath: true,
      tsRuntimeAuthMaintainable: true,
    },
    rationale: "Execution-focused retail API with sandbox support and straightforward TS client patterns.",
  },
  tradestation: {
    brokerId: "tradestation",
    segment: "b2c",
    approved: true,
    criteria: {
      retailB2COnboarding: true,
      documentedExecutionEndpoints: true,
      apiTermsAllowCustomerExecution: true,
      paperOrSafeDryRunPath: true,
      tsRuntimeAuthMaintainable: true,
    },
    rationale: "Retail brokerage APIs provide account/order/market endpoints and paper-like environments.",
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
  trading212: {
    brokerId: "trading212",
    segment: "b2c",
    approved: true,
    criteria: {
      retailB2COnboarding: true,
      documentedExecutionEndpoints: true,
      apiTermsAllowCustomerExecution: true,
      paperOrSafeDryRunPath: true,
      tsRuntimeAuthMaintainable: true,
    },
    rationale: "Retail public API covers account, positions, and equity orders with maintainable TS auth patterns.",
  },
  etrade: {
    brokerId: "etrade",
    segment: "b2c",
    approved: true,
    criteria: {
      retailB2COnboarding: true,
      documentedExecutionEndpoints: true,
      apiTermsAllowCustomerExecution: true,
      paperOrSafeDryRunPath: true,
      tsRuntimeAuthMaintainable: true,
    },
    rationale: "Retail execution API with OAuth flow and standardized account/order surfaces.",
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
