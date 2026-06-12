import { useEffect, useRef } from "react";
import { isKillSwitchesEnabled, listTrippedSwitches } from "../../infra/safety/killSwitches.ts";
import { buildKillSwitchStatus } from "../state/killSwitchStatus.ts";
import type { Dispatch } from "../state/types.ts";

export function useKillSwitchStatus(dispatch: Dispatch): void {
  const lastSignature = useRef<string | null>(null);
  const hintedSignature = useRef<string | null>(null);

  useEffect(() => {
    let disposed = false;

    const poll = () => {
      const status = buildKillSwitchStatus({
        enabled: isKillSwitchesEnabled(),
        trips: listTrippedSwitches(),
      });
      if (disposed || status.signature === lastSignature.current) return;
      lastSignature.current = status.signature;
      dispatch({ type: "SET_KILL_SWITCH_STATUS", status });
      if (status.halted && hintedSignature.current !== status.signature) {
        hintedSignature.current = status.signature;
        dispatch({
          type: "ADD_MESSAGE",
          message: {
            id: `kill-switch-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            role: "system",
            variant: "error",
            content: status.summary,
            timestamp: new Date().toISOString(),
          },
        });
      }
    };

    poll();
    const timer = setInterval(poll, 5_000);
    timer.unref?.();
    return () => {
      disposed = true;
      clearInterval(timer);
    };
  }, [dispatch]);
}
