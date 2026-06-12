import { useEffect, useState } from "react";
import { getTuiAccountEquity } from "../bridge/runtime.ts";

export function useAccountEquity(): number | null {
  const [equity, setEquity] = useState<number | null>(null);

  useEffect(() => {
    let disposed = false;
    async function refresh(): Promise<void> {
      const value = await getTuiAccountEquity();
      if (!disposed) setEquity(value);
    }
    void refresh();
    const timer = setInterval(() => void refresh(), 5 * 60_000);
    timer.unref?.();
    return () => {
      disposed = true;
      clearInterval(timer);
    };
  }, []);

  return equity;
}
