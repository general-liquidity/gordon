import {
  getCurrentSession,
  initializeSession,
  resumeSession,
  startNewSession,
  type SessionInfo,
} from "../../infra/storage/entities/session.ts";
import type { RuntimeSessionSnapshot } from "../contracts/types.ts";

export class SessionController {
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
