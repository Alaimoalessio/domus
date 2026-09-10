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
import { leggiPreferenze, osservaPreferenze } from "../lib/preferenze";
import type { Session } from "../lib/vault";

interface AuthContextType {
  session: Session | null;
  email: string | null;
  isAuthenticated: boolean;
  signIn: (session: Session, email: string) => void;
  /** Il messaggio sopravvive alla disconnessione: passarlo via state della
   *  rotta non funziona, perche' azzerare la sessione fa scattare prima il
   *  redirect di ProtectedRoute, che lo state non ce l'ha. */
  signOut: (notice?: string) => void;
  notice: string | null;
  clearNotice: () => void;
  lockedOut: boolean;
  dismissLock: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);



export function AuthProvider({ children }: { children: ReactNode }) {
  // SK e token vivono SOLO qui, in memoria. Niente localStorage, niente
  // sessionStorage: un refresh della pagina chiude il vault, ed e' voluto.
  const [session, setSession] = useState<Session | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const [lockedOut, setLockedOut] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [minutiBlocco, setMinutiBlocco] = useState(() => leggiPreferenze().minutiBlocco);

  // Cambiare il timeout deve avere effetto subito, non al prossimo accesso.
  useEffect(() => osservaPreferenze((p) => setMinutiBlocco(p.minutiBlocco)), []);

  const signOut = useCallback((message?: string) => {
    setSession(null);
    setEmail(null);
    setNotice(message ?? null);
    api.clear();
  }, []);

  const signIn = useCallback((next: Session, userEmail: string) => {
    setSession(next);
    setEmail(userEmail);
    setLockedOut(false);
    setNotice(null);
  }, []);

  // Auto-lock: dopo il periodo scelto, la SK sparisce dalla RAM.
  useEffect(() => {
    if (!session) return;

    let timeoutId: number;
    const resetTimer = () => {
      window.clearTimeout(timeoutId);
      timeoutId = window.setTimeout(() => {
        setLockedOut(true);
        signOut();
      }, minutiBlocco * 60_000);
    };

    const events = ["mousemove", "keydown", "touchstart", "click", "scroll"] as const;
    events.forEach((event) => window.addEventListener(event, resetTimer, { passive: true }));
    resetTimer();

    return () => {
      window.clearTimeout(timeoutId);
      events.forEach((event) => window.removeEventListener(event, resetTimer));
    };
  }, [session, signOut, minutiBlocco]);

  const value = useMemo(
    () => ({
      session,
      email,
      isAuthenticated: session !== null,
      signIn,
      signOut,
      notice,
      clearNotice: () => setNotice(null),
      lockedOut,
      dismissLock: () => setLockedOut(false),
    }),
    [session, email, signIn, signOut, notice, lockedOut]
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
