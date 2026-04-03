# Broker Inclusion Gate (B2C Execution Only)

Gordon stock broker integrations must pass all criteria below before they can be exposed in `BrokerFactory`:

1. Retail B2C onboarding path exists.
2. Publicly documented execution endpoints exist (account + order lifecycle + quotes).
3. API terms allow execution for customer-owned accounts.
4. Paper trading or safe dry-run path is available.
5. Auth/session model is maintainable in the TypeScript runtime.

Implementation is enforced by:

- `src/infra/broker/inclusion-gate.ts` (policy source of truth)
- `src/infra/broker/factory.ts` (`assertBrokerPassesInclusionGate` at adapter creation)
- `src/infra/broker/inclusion-gate.test.ts` (test coverage)

