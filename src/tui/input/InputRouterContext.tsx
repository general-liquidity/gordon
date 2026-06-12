import React, { createContext, useContext, useEffect, useMemo, useRef, type ReactNode } from "react";
import { useInput } from "../ink-custom";
import { FocusStack, type FocusOwner } from "./focusStack.ts";

const InputRouterContext = createContext<FocusStack | null>(null);

export function InputRouterProvider({ children }: { children: ReactNode }): React.ReactElement {
  const stack = useMemo(() => new FocusStack(), []);
  useInput((input, key) => {
    stack.dispatch(input, key);
  });
  return <InputRouterContext.Provider value={stack}>{children}</InputRouterContext.Provider>;
}

export function useRoutedInput(
  handler: FocusOwner["handler"],
  opts: { id: string; priority: number; isActive?: boolean },
): void {
  const stack = useContext(InputRouterContext);
  const handlerRef = useRef(handler);
  const activeRef = useRef(opts.isActive ?? true);
  handlerRef.current = handler;
  activeRef.current = opts.isActive ?? true;

  useEffect(() => {
    if (!stack) return;
    return stack.register({
      id: opts.id,
      priority: opts.priority,
      isActive: () => activeRef.current,
      handler: (input, key) => handlerRef.current(input, key),
    });
  }, [opts.id, opts.priority, stack]);
}

export { FOCUS_PRIORITY } from "./focusStack.ts";
