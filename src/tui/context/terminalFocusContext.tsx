import { createContext, useContext, useState, useEffect, type ReactNode } from "react";

// ============================================================================
// Terminal Focus Context — Tracks terminal focus/blur state
//
// Uses DECSET 1004 for focus reporting. Pauses animations when blurred.
// Falls back to 'unknown' if terminal doesn't support focus events.
// ============================================================================

export type FocusState = "focused" | "blurred" | "unknown";

interface FocusContextValue {
  state: FocusState;
  isFocused: boolean;
  isBlurred: boolean;
}

const FocusContext = createContext<FocusContextValue>({
  state: "unknown",
  isFocused: false,
  isBlurred: false,
});

export function TerminalFocusProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<FocusState>("unknown");

  useEffect(() => {
    // Enable focus reporting
    if (process.stdout.isTTY) {
      process.stdout.write("\x1b[?1004h");
    }

    const onData = (data: Buffer) => {
      const str = data.toString();
      if (str.includes("\x1b[I")) {
        setState("focused");
      } else if (str.includes("\x1b[O")) {
        setState("blurred");
      }
    };

    process.stdin.on("data", onData);

    return () => {
      process.stdin.off("data", onData);
      if (process.stdout.isTTY) {
        process.stdout.write("\x1b[?1004l");
      }
    };
  }, []);

  const value: FocusContextValue = {
    state,
    isFocused: state === "focused" || state === "unknown",
    isBlurred: state === "blurred",
  };

  return <FocusContext.Provider value={value}>{children}</FocusContext.Provider>;
}

export function useTerminalFocus(): FocusContextValue {
  return useContext(FocusContext);
}
