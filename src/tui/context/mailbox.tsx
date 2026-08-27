import { createContext, useContext, useRef, useCallback, useEffect, type ReactNode } from "react";

// ============================================================================
// Mailbox — Pub/sub inter-component communication
//
// Decoupled messaging between components without prop drilling.
// Price updates, position changes, alerts flow through channels.
// ============================================================================

type Handler = (data: any) => void;
type Subscribers = Map<string, Set<Handler>>;

interface MailboxContextValue {
  publish: (channel: string, data: any) => void;
  subscribe: (channel: string, handler: Handler) => () => void;
}

const MailboxContext = createContext<MailboxContextValue>({
  publish: () => {},
  subscribe: () => () => {},
});

export function MailboxProvider({ children }: { children: ReactNode }) {
  const subscribersRef = useRef<Subscribers>(new Map());

  const publish = useCallback((channel: string, data: any) => {
    const handlers = subscribersRef.current.get(channel);
    if (handlers) {
      for (const handler of handlers) {
        handler(data);
      }
    }
  }, []);

  const subscribe = useCallback((channel: string, handler: Handler): (() => void) => {
    const subs = subscribersRef.current;
    if (!subs.has(channel)) {
      subs.set(channel, new Set());
    }
    subs.get(channel)!.add(handler);
    return () => {
      subs.get(channel)?.delete(handler);
    };
  }, []);

  return (
    <MailboxContext.Provider value={{ publish, subscribe }}>{children}</MailboxContext.Provider>
  );
}

export function usePublish(): (channel: string, data: any) => void {
  return useContext(MailboxContext).publish;
}

export function useSubscribe(channel: string, handler: Handler): void {
  const { subscribe } = useContext(MailboxContext);
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    return subscribe(channel, (data) => handlerRef.current(data));
  }, [channel, subscribe]);
}
