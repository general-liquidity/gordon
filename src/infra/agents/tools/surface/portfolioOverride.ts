import type { MastraExecutionContext } from "../types.ts";

/** Wrap an execution context's RequestContext so reads of portfolioValue
 *  / availableCash return the operator-supplied override instead of the
 *  live exchange balance. Used by compute_risk + verify_plan to support
 *  hypothetical-portfolio reasoning without flipping into paper mode. */
export function withPortfolioOverride(
  execContext: MastraExecutionContext | undefined,
  overrideUsd: number,
): MastraExecutionContext | undefined {
  if (!execContext?.requestContext) return execContext;
  const original = execContext.requestContext;
  const proxied = new Proxy(original, {
    get(target, prop, receiver) {
      if (prop === "get") {
        return (key: string) => {
          if (key === "portfolioValue" || key === "availableCash") return overrideUsd;
          return Reflect.get(target, "get").call(target, key);
        };
      }
      return Reflect.get(target, prop, receiver);
    },
  });
  return { ...execContext, requestContext: proxied };
}
