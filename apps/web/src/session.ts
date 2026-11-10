import type { CreateSessionResponse, Role } from "@pictionary/protocol";

/**
 * Session tokens live in sessionStorage per room code, so a page reload (or a
 * reconnect) resumes the same session instead of creating a new one.
 */
export interface StoredSession {
  role: Exclude<Role, "agent">;
  pairCode?: string;
  session: CreateSessionResponse;
}

const key = (code: string) => `ap:session:${code.toUpperCase()}`;

export function loadSession(code: string): StoredSession | null {
  try {
    const raw = window.sessionStorage.getItem(key(code));
    return raw ? (JSON.parse(raw) as StoredSession) : null;
  } catch {
    return null;
  }
}

export function saveSession(code: string, s: StoredSession): void {
  try {
    window.sessionStorage.setItem(key(code), JSON.stringify(s));
  } catch {
    // Private mode or quota: the page still works for this load.
  }
}

export function clearSession(code: string): void {
  try {
    window.sessionStorage.removeItem(key(code));
  } catch {
    // ignore
  }
}
