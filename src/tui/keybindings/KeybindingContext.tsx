import React, { createContext, useContext, useEffect, useRef, useMemo, useCallback, type ReactNode } from "react";
import { useInput } from "../ink-custom";
import { KeyContext, type KeybindingAction, type ParsedKeystroke } from "./types.js";
import { KeybindingResolver } from "./resolver.js";
import { DEFAULT_BINDINGS } from "./defaultBindings.js";
import { loadUserBindings } from "./loadUserBindings.js";

// ============================================================================
// Keybinding Context — React provider for configurable keybindings
//
// Wraps the KeybindingResolver and provides hooks for components to register
// handlers for specific actions. Uses Ink's useInput internally.
// ============================================================================

type Handler = () => void;
type HandlerRegistry = Map<KeybindingAction, Set<Handler>>;

interface KeybindingContextValue {
  resolver: KeybindingResolver;
  register: (action: KeybindingAction, handler: Handler) => () => void;
  activeContext: KeyContext;
}

const Ctx = createContext<KeybindingContextValue | null>(null);

interface Props {
  children: ReactNode;
  activeContext?: KeyContext;
}

export function KeybindingProvider({ children, activeContext = KeyContext.Chat }: Props) {
  const registryRef = useRef<HandlerRegistry>(new Map());

  const resolver = useMemo(() => {
    const userBindings = loadUserBindings();
    return new KeybindingResolver(DEFAULT_BINDINGS, userBindings);
  }, []);

  const register = useCallback((action: KeybindingAction, handler: Handler): (() => void) => {
    const registry = registryRef.current;
    if (!registry.has(action)) {
      registry.set(action, new Set());
    }
    registry.get(action)!.add(handler);
    return () => {
      registry.get(action)?.delete(handler);
    };
  }, []);

  useInput((input, key) => {
    const keystroke: ParsedKeystroke = {
      key: key.return ? "enter" : key.escape ? "escape" : key.tab ? "tab" : key.backspace ? "backspace" : key.upArrow ? "up" : key.downArrow ? "down" : key.leftArrow ? "left" : key.rightArrow ? "right" : input,
      ctrl: key.ctrl ?? false,
      shift: key.shift ?? false,
      alt: false,
      meta: key.meta ?? false,
    };

    const action = resolver.resolve(keystroke, activeContext);
    if (action) {
      const handlers = registryRef.current.get(action);
      if (handlers) {
        for (const handler of handlers) {
          handler();
        }
      }
    }
  });

  const value: KeybindingContextValue = { resolver, register, activeContext };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useKeybinding(action: KeybindingAction, handler: () => void): void {
  const ctx = useContext(Ctx);
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    if (!ctx) return;
    return ctx.register(action, () => handlerRef.current());
  }, [ctx, action]);
}

export function useKeybindings(
  bindings: Array<{ action: KeybindingAction; handler: () => void }>,
): void {
  const ctx = useContext(Ctx);
  const bindingsRef = useRef(bindings);
  bindingsRef.current = bindings;

  useEffect(() => {
    if (!ctx) return;
    const unsubscribes = bindingsRef.current.map((b) =>
      ctx.register(b.action, () => {
        const current = bindingsRef.current.find((bb) => bb.action === b.action);
        current?.handler();
      }),
    );
    return () => unsubscribes.forEach((u) => u());
  }, [ctx]);
}

export function useKeybindingResolver(): KeybindingResolver | null {
  const ctx = useContext(Ctx);
  return ctx?.resolver ?? null;
}
