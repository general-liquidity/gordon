import {
  getCurrentSession,
  initializeSession,
  loadSessionState,
  resumeSession,
  saveSessionState,
  startNewSession,
  type SessionInfo,
  type SessionState,
} from "../../infra/storage/entities/session.ts";
import type { RuntimeSessionSnapshot } from "../contracts/types.ts";

export class SessionController {
  /** Capture the persisted session pointer before a lifecycle-gated change. */
  async captureState(): Promise<SessionState> {
    return structuredClone(await loadSessionState());
  }

  /** Restore a rejected session transition so a hook veto is atomic. */
  async restoreState(state: SessionState): Promise<void> {
    await saveSessionState(state);
  }

  async initializeSession(options: { autoResume?: boolean; forceNewThread?: boolean } = {}): Promise<SessionInfo> {
    return initializeSession(options);
  }

  async resumeSession(): Promise<SessionInfo | null> {
    return resumeSession();
  }

  async startNewSession(): Promise<SessionInfo> {
    return startNewSession();
  }

  async getCurrentSession(): Promise<RuntimeSessionSnapshot> {
    return getCurrentSession();
  }
}
