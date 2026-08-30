import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { api } from "../lib/api";
import type { Session } from "../lib/vault";

interface AuthContextType {
  session: Session | null;
  email: string | null;
  isAuthenticated: boolean;
  signIn: (session: Session, email: string) => void;
  signOut: () => void;
  lockedOut: boolean;
  dismissLock: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const AUTO_LOCK_TIMEOUT = 10 * 60 * 1000;

export function AuthProvider({ children }: { children: ReactNode }) {
  // SK e token vivono SOLO qui, in memoria. Niente localStorage, niente
  // sessionStorage: un refresh della pagina chiude il vault, ed e' voluto.
  const [session, setSession] = useState<Session | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const [lockedOut, setLockedOut] = useState(false);

  const signOut = useCallback(() => {
    setSession(null);
    setEmail(null);
    api.clear();
  }, []);

  const signIn = useCallback((next: Session, userEmail: string) => {
    setSession(next);
    setEmail(userEmail);
    setLockedOut(false);
  }, []);

  // Auto-lock: dopo 10 minuti di inattivita' la SK sparisce dalla RAM.
  useEffect(() => {
    if (!session) return;

    let timeoutId: number;
    const resetTimer = () => {
      window.clearTimeout(timeoutId);
      timeoutId = window.setTimeout(() => {
        setLockedOut(true);
        signOut();
      }, AUTO_LOCK_TIMEOUT);
    };

    const events = ["mousemove", "keydown", "touchstart", "click", "scroll"] as const;
    events.forEach((event) => window.addEventListener(event, resetTimer, { passive: true }));
    resetTimer();

    return () => {
      window.clearTimeout(timeoutId);
      events.forEach((event) => window.removeEventListener(event, resetTimer));
    };
  }, [session, signOut]);

  const value = useMemo(
    () => ({
      session,
      email,
      isAuthenticated: session !== null,
      signIn,
      signOut,
      lockedOut,
      dismissLock: () => setLockedOut(false),
    }),
    [session, email, signIn, signOut, lockedOut]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth deve stare dentro AuthProvider");
  }
  return context;
}
