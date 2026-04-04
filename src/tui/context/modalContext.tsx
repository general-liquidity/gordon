import React, { createContext, useContext, useState, useCallback, type ReactNode } from "react";

// ============================================================================
// Modal Context — Scroll-owning modal dialog management
//
// When a modal is open, scroll keybindings route to the modal's scroll
// instead of the main transcript.
// ============================================================================

interface ModalState {
  isModalOpen: boolean;
  modalId: string | null;
}

interface ModalActions {
  openModal: (id: string) => void;
  closeModal: () => void;
}

const ModalStateContext = createContext<ModalState>({ isModalOpen: false, modalId: null });
const ModalActionsContext = createContext<ModalActions>({ openModal: () => {}, closeModal: () => {} });

export function ModalProvider({ children }: { children: ReactNode }) {
  const [modalId, setModalId] = useState<string | null>(null);

  const openModal = useCallback((id: string) => setModalId(id), []);
  const closeModal = useCallback(() => setModalId(null), []);

  return (
    <ModalStateContext.Provider value={{ isModalOpen: modalId !== null, modalId }}>
      <ModalActionsContext.Provider value={{ openModal, closeModal }}>
        {children}
      </ModalActionsContext.Provider>
    </ModalStateContext.Provider>
  );
}

export function useModalState(): ModalState {
  return useContext(ModalStateContext);
}

export function useOpenModal(): (id: string) => void {
  return useContext(ModalActionsContext).openModal;
}

export function useCloseModal(): () => void {
  return useContext(ModalActionsContext).closeModal;
}
