/**
 * useStatusLineHook — throttled React wrapper around `runStatusLineHook`.
 *
 * Reads the operator's status-line command (default source:
 * `GORDON_STATUS_LINE_COMMAND`, matching Gordon's env-config convention) and
 * runs it on a fixed interval — NOT per render frame — returning the sanitized
 * single-line segment, or `null` when nothing should render (no command set,
 * error, timeout, empty). ALL execution safety (timeout kill, output cap, ANSI
 * strip, fail-closed-to-null) lives in `statusLineHook.ts`; this hook owns only
 * the throttle + React state, and never overlaps two runs.
 */

import { useEffect, useRef, useState } from "react";
import { runStatusLineHook, type StatusLineRunner } from "../components/status/statusLineHook.ts";

/** Refresh cadence — a status hook reflects slow-moving external state. */
export const STATUS_LINE_REFRESH_MS = 5_000;

export function useStatusLineHook(opts?: {
  command?: string;
  refreshMs?: number;
  runner?: StatusLineRunner;
}): string | null {
  const command = opts?.command ?? process.env.GORDON_STATUS_LINE_COMMAND;
  const refreshMs = opts?.refreshMs ?? STATUS_LINE_REFRESH_MS;
  const runner = opts?.runner;
  const [segment, setSegment] = useState<string | null>(null);
  const runningRef = useRef(false);

  useEffect(() => {
    if (!command?.trim()) {
      setSegment(null);
      return;
    }
    let cancelled = false;

    const tick = async () => {
      if (runningRef.current) return; // never overlap two hook runs
      runningRef.current = true;
      try {
        const out = await runStatusLineHook(command, { runner });
        if (!cancelled) setSegment(out);
      } finally {
        runningRef.current = false;
      }
    };

    void tick(); // immediate first paint, then on the interval
    const id = setInterval(() => void tick(), refreshMs);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [command, refreshMs, runner]);

  return segment;
}
