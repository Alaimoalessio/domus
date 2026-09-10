/**
 * Preferenze locali del dispositivo.
 *
 * Stanno in localStorage e NON nel vault, di proposito: sono scelte che
 * riguardano questo dispositivo, non l'account. Il portatile di casa e il
 * telefono che porti in giro meritano timeout diversi, e sincronizzarle
 * significherebbe imporre a entrambi la scelta fatta per uno solo.
 *
 * Non contengono nulla di segreto: nessuna password, nessuna chiave.
 */

const CHIAVE = "domus:preferenze:v1";

export interface Preferenze {
  /** Minuti di inattivita' prima che la chiave sparisca dalla memoria. */
  minutiBlocco: number;
  /** Secondi dopo i quali la clipboard viene svuotata. */
  secondiClipboard: number;
}

export const PREFERENZE_DEFAULT: Preferenze = {
  minutiBlocco: 10,
  secondiClipboard: 20,
};

export const SCELTE_BLOCCO = [1, 5, 10, 30, 60] as const;
export const SCELTE_CLIPBOARD = [10, 20, 60, 0] as const;

export function leggiPreferenze(): Preferenze {
  try {
    const grezzo = localStorage.getItem(CHIAVE);
    if (!grezzo) return PREFERENZE_DEFAULT;
    const lette = JSON.parse(grezzo) as Partial<Preferenze>;
    return {
      // Ogni valore viene validato: un localStorage manomesso o rimasto da una
      // versione precedente non deve poter disattivare il blocco automatico.
      minutiBlocco: SCELTE_BLOCCO.includes(lette.minutiBlocco as never)
        ? lette.minutiBlocco!
        : PREFERENZE_DEFAULT.minutiBlocco,
      secondiClipboard: SCELTE_CLIPBOARD.includes(lette.secondiClipboard as never)
        ? lette.secondiClipboard!
        : PREFERENZE_DEFAULT.secondiClipboard,
    };
  } catch {
    return PREFERENZE_DEFAULT;
  }
}

export function salvaPreferenze(p: Preferenze): void {
  try {
    localStorage.setItem(CHIAVE, JSON.stringify(p));
    // Le altre schede aperte devono adeguarsi subito, non al prossimo
    // caricamento: `storage` non scatta nella scheda che scrive.
    window.dispatchEvent(new CustomEvent("domus:preferenze"));
  } catch {
    /* modalita' privata o storage pieno: si resta sui valori correnti */
  }
}

export function osservaPreferenze(callback: (p: Preferenze) => void): () => void {
  const gestore = () => callback(leggiPreferenze());
  window.addEventListener("domus:preferenze", gestore);
  window.addEventListener("storage", gestore);
  return () => {
    window.removeEventListener("domus:preferenze", gestore);
    window.removeEventListener("storage", gestore);
  };
}

export function etichettaBlocco(minuti: number): string {
  return minuti === 60 ? "1 ora" : `${minuti} min`;
}

export function etichettaClipboard(secondi: number): string {
  return secondi === 0 ? "mai" : `${secondi} s`;
}
