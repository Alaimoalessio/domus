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
import { disabilita as disabilitaWebAuthn } from "../lib/biometric";
import { leggiPreferenze, osservaPreferenze } from "../lib/preferenze";
import { disabilitaImprontaNativa, disabilitaPin } from "../lib/sblocco";
import type { Session } from "../lib/vault";

/** Chi c'era prima del blocco: basta a riaprire senza rifare il login. */
export interface SessioneBloccata {
  email: string;
  userId: string;
  isAdmin: boolean;
  /** Vero se e' scattato il timer di inattivita', falso se l'ha chiesto l'utente. */
  perInattivita: boolean;
}

interface AuthContextType {
  session: Session | null;
  email: string | null;
  isAuthenticated: boolean;
  signIn: (session: Session, email: string) => void;
  /** Esce davvero: sessione revocata e sblocco rapido rimosso dal dispositivo.
   *  Il messaggio sopravvive alla disconnessione: passarlo via state della
   *  rotta non funziona, perche' azzerare la sessione fa scattare prima il
   *  redirect di ProtectedRoute, che lo state non ce l'ha. */
  signOut: (notice?: string) => void;
  /** Blocca soltanto: la chiave del vault sparisce dalla RAM, la sessione
   *  con il server resta. Si riapre con PIN, impronta o master password. */
  lock: () => void;
  locked: SessioneBloccata | null;
  notice: string | null;
  clearNotice: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  // SK e token vivono SOLO qui, in memoria. Niente localStorage, niente
  // sessionStorage: un refresh della pagina chiude il vault, ed e' voluto.
  const [session, setSession] = useState<Session | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const [locked, setLocked] = useState<SessioneBloccata | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [minutiBlocco, setMinutiBlocco] = useState(() => leggiPreferenze().minutiBlocco);

  // Cambiare il timeout deve avere effetto subito, non al prossimo accesso.
  useEffect(() => osservaPreferenze((p) => setMinutiBlocco(p.minutiBlocco)), []);

  const signOut = useCallback((message?: string) => {
    setSession(null);
    setEmail(null);
    setLocked(null);
    setNotice(message ?? null);
    // Uscire e' un gesto deliberato: come in Bitwarden, toglie anche lo
    // sblocco rapido, o "esci" lascerebbe il vault a un PIN di distanza.
    // Il PIN va tolto PRIMA di buttare i token: la DELETE sul server e'
    // autenticata.
    void Promise.allSettled([disabilitaPin(), disabilitaImprontaNativa(), disabilitaWebAuthn()]).then(
      () => api.clear()
    );
  }, []);

  const signIn = useCallback((next: Session, userEmail: string) => {
    setSession(next);
    setEmail(userEmail);
    setLocked(null);
    setNotice(null);
  }, []);

  const lock = useCallback(
    (perInattivita = false) => {
      if (!session || !email) return;
      setLocked({ email, userId: session.userId, isAdmin: session.isAdmin, perInattivita });
      setSession(null);
    },
    [session, email]
  );

  // Auto-lock: dopo il periodo scelto, la SK sparisce dalla RAM.
  useEffect(() => {
    if (!session) return;

    let timeoutId: number;
    const resetTimer = () => {
      window.clearTimeout(timeoutId);
      timeoutId = window.setTimeout(() => lock(true), minutiBlocco * 60_000);
    };

    const events = ["mousemove", "keydown", "touchstart", "click", "scroll"] as const;
    events.forEach((event) => window.addEventListener(event, resetTimer, { passive: true }));
    resetTimer();

    return () => {
      window.clearTimeout(timeoutId);
      events.forEach((event) => window.removeEventListener(event, resetTimer));
    };
  }, [session, lock, minutiBlocco]);

  const value = useMemo(
    () => ({
      session,
      email,
      isAuthenticated: session !== null,
      signIn,
      signOut,
      lock: () => lock(false),
      locked,
      notice,
      clearNotice: () => setNotice(null),
    }),
    [session, email, signIn, signOut, lock, locked, notice]
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
