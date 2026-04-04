import React, { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from "react";

// ============================================================================
// Overlay Context — Tracks active overlays for Escape key routing
//
// When overlays (dialogs, pickers, menus) are open, Escape dismisses the
// topmost overlay instead of canceling the underlying operation.
// ============================================================================

interface OverlayState {
  activeOverlayIds: string[];
  hasActiveOverlay: boolean;
  hasModalOverlay: boolean;
}

interface OverlayActions {
  registerOverlay: (id: string, modal?: boolean) => void;
  unregisterOverlay: (id: string) => void;
  isTopOverlay: (id: string) => boolean;
}

const OverlayStateContext = createContext<OverlayState>({
  activeOverlayIds: [],
  hasActiveOverlay: false,
  hasModalOverlay: false,
});

const OverlayActionsContext = createContext<OverlayActions>({
  registerOverlay: () => {},
  unregisterOverlay: () => {},
  isTopOverlay: () => false,
});

interface OverlayEntry {
  id: string;
  modal: boolean;
}

export function OverlayProvider({ children }: { children: ReactNode }) {
  const [overlays, setOverlays] = useState<OverlayEntry[]>([]);

  const registerOverlay = useCallback((id: string, modal = true) => {
    setOverlays((prev) => [...prev.filter((o) => o.id !== id), { id, modal }]);
  }, []);

  const unregisterOverlay = useCallback((id: string) => {
    setOverlays((prev) => prev.filter((o) => o.id !== id));
  }, []);

  const isTopOverlay = useCallback(
    (id: string) => {
      return overlays.length > 0 && overlays[overlays.length - 1]!.id === id;
    },
    [overlays],
  );

  const state: OverlayState = {
    activeOverlayIds: overlays.map((o) => o.id),
    hasActiveOverlay: overlays.length > 0,
    hasModalOverlay: overlays.some((o) => o.modal),
  };

  const actions: OverlayActions = { registerOverlay, unregisterOverlay, isTopOverlay };

  return (
    <OverlayStateContext.Provider value={state}>
      <OverlayActionsContext.Provider value={actions}>
        {children}
      </OverlayActionsContext.Provider>
    </OverlayStateContext.Provider>
  );
}

export function useOverlayState(): OverlayState {
  return useContext(OverlayStateContext);
}

export function useOverlayActions(): OverlayActions {
  return useContext(OverlayActionsContext);
}

export function useRegisterOverlay(id: string, modal = true): void {
  const { registerOverlay, unregisterOverlay } = useOverlayActions();
  useEffect(() => {
    registerOverlay(id, modal);
    return () => unregisterOverlay(id);
  }, [id, modal, registerOverlay, unregisterOverlay]);
}

export function useIsTopOverlay(id: string): boolean {
  const { isTopOverlay } = useOverlayActions();
  return isTopOverlay(id);
}
