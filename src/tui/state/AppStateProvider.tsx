/**
 * AppStateProvider — Central state context with useReducer
 *
 * Provides the full AppState via React context. Consumer hooks use
 * `useAppState(selector)` with `Object.is` comparison to avoid
 * unnecessary re-renders, and `useDispatch()` for action dispatch.
 *
 * Phase 2 of the 100% parity plan.
 */

import React, {
  createContext,
  useContext,
  useReducer,
  useRef,
  useCallback,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { appReducer } from "./reducer.js";
import { INITIAL_STATE, type AppState, type Action, type Dispatch } from "./types.js";

// ============================================================================
// Internal store wrapper — enables selector-based subscriptions
// ============================================================================

type Listener = () => void;

class StateStore {
  private state: AppState;
  private listeners: Set<Listener> = new Set();
  private readonly reducer: typeof appReducer;

  constructor(initialState: AppState, reducer: typeof appReducer) {
    this.state = initialState;
    this.reducer = reducer;
  }

  getState = (): AppState => this.state;

  dispatch = (action: Action): void => {
    const next = this.reducer(this.state, action);
    if (next !== this.state) {
      this.state = next;
      for (const listener of this.listeners) {
        listener();
      }
    }
  };

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
}

// ============================================================================
// Contexts
// ============================================================================

const StoreContext = createContext<StateStore | null>(null);
const DispatchContext = createContext<Dispatch | null>(null);

// ============================================================================
// Provider
// ============================================================================

interface Props {
  children: ReactNode;
  /** Optional initial state override (useful for tests) */
  initialState?: Partial<AppState>;
}

export function AppStateProvider({ children, initialState }: Props) {
  // Create the store once and keep it stable across renders
  const storeRef = useRef<StateStore | null>(null);
  if (storeRef.current === null) {
    const merged: AppState = initialState
      ? { ...INITIAL_STATE, ...initialState }
      : INITIAL_STATE;
    storeRef.current = new StateStore(merged, appReducer);
  }
  const store = storeRef.current;

  return (
    <StoreContext.Provider value={store}>
      <DispatchContext.Provider value={store.dispatch}>
        {children}
      </DispatchContext.Provider>
    </StoreContext.Provider>
  );
}

// ============================================================================
// useAppState(selector) — select a slice of AppState with Object.is memoization
// ============================================================================

function useStore(): StateStore {
  const store = useContext(StoreContext);
  if (!store) {
    throw new Error("useAppState must be used within <AppStateProvider>");
  }
  return store;
}

/**
 * Subscribe to a slice of application state. The selector is called on every
 * state change; the component only re-renders when the selected value changes
 * according to `Object.is`.
 *
 * @example
 *   const isStreaming = useAppState((s) => s.isStreaming);
 *   const messages = useAppState((s) => s.messages);
 */
export function useAppState<T>(selector: (state: AppState) => T): T {
  const store = useStore();

  // Keep a stable reference to the selector so useSyncExternalStore
  // doesn't re-subscribe on every render.
  const selectorRef = useRef(selector);
  selectorRef.current = selector;

  const getSnapshot = useCallback(
    () => selectorRef.current(store.getState()),
    [store],
  );

  return useSyncExternalStore(store.subscribe, getSnapshot, getSnapshot);
}

// ============================================================================
// useDispatch — stable dispatch function
// ============================================================================

/**
 * Returns the dispatch function. The reference is stable across renders.
 */
export function useDispatch(): Dispatch {
  const dispatch = useContext(DispatchContext);
  if (!dispatch) {
    throw new Error("useDispatch must be used within <AppStateProvider>");
  }
  return dispatch;
}

// ============================================================================
// useAppStore — escape hatch for imperative access
// ============================================================================

/**
 * Returns the underlying store for imperative reads (e.g., inside
 * event handlers that need the latest state without subscribing).
 */
export function useAppStore() {
  const store = useStore();
  return {
    getState: store.getState,
    dispatch: store.dispatch,
    subscribe: store.subscribe,
  };
}
