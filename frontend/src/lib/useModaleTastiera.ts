import { useEffect, useRef } from "react";

const SELEZIONABILI =
  'a[href], button, input, textarea, select, [tabindex]:not([tabindex="-1"])';

/**
 * Lo stato "disabilitato" va escluso qui e non nel selettore: base-ui mette
 * tabindex="0" anche sui pulsanti disabilitati, quindi la clausola [tabindex]
 * li riammetteva subito dopo che button:not([disabled]) li aveva scartati. Il
 * risultato era un focus mandato su un elemento incapace di riceverlo, e il
 * giro del Tab che si interrompeva li'.
 */
function raggiungibile(el: HTMLElement): boolean {
  if (el.offsetParent === null) return false;
  if (el.getAttribute("aria-disabled") === "true") return false;
  return !(el as HTMLButtonElement | HTMLInputElement).disabled;
}

function selezionabiliIn(nodo: HTMLElement): HTMLElement[] {
  return [...nodo.querySelectorAll<HTMLElement>(SELEZIONABILI)].filter(raggiungibile);
}

/**
 * Rende una finestra modale utilizzabile da tastiera: Escape per chiudere,
 * Tab che gira in tondo dentro la modale invece di finire sulla pagina sotto,
 * e il focus che torna dov'era alla chiusura.
 *
 * Senza il confinamento del focus, premendo Tab si arriva ai campi della
 * pagina retrostante pur vedendo la modale davanti: si finisce per digitare
 * in un campo che non si vede.
 */
export function useModaleTastiera(onClose: () => void) {
  const contenitore = useRef<HTMLDivElement>(null);

  // La callback passa da una ref, non dalle dipendenze dell'effetto: chi usa
  // l'hook scrive `onClose={() => setAperto(false)}`, che e' una funzione
  // NUOVA a ogni render. Con onClose fra le dipendenze l'effetto si
  // rimonterebbe di continuo e rimetterebbe il focus sul primo campo a ogni
  // carattere digitato — scrivere nelle note diventerebbe impossibile.
  const chiudi = useRef(onClose);
  chiudi.current = onClose;

  useEffect(() => {
    const precedente = document.activeElement as HTMLElement | null;
    const nodo = contenitore.current;

    // Il primo campo utile, non il pulsante di chiusura: chi apre una modale
    // vuole scrivere, non uscirne.
    const primi = nodo ? selezionabiliIn(nodo) : [];
    const primoCampo = primi.find((e) => e.tagName === "INPUT" || e.tagName === "TEXTAREA");
    (primoCampo ?? primi[0])?.focus();

    const suTasto = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        chiudi.current();
        return;
      }
      if (e.key !== "Tab" || !nodo) return;

      // Ricalcolata a ogni Tab: un pulsante puo' abilitarsi o disabilitarsi
      // mentre la modale e' aperta (Salva lo fa appena si scrive un nome).
      const elementi = selezionabiliIn(nodo);
      if (elementi.length === 0) return;
      const primo = elementi[0];
      const ultimo = elementi[elementi.length - 1];

      if (e.shiftKey && document.activeElement === primo) {
        e.preventDefault();
        ultimo.focus();
      } else if (!e.shiftKey && document.activeElement === ultimo) {
        e.preventDefault();
        primo.focus();
      }
    };

    document.addEventListener("keydown", suTasto);
    // Il resto della pagina non deve scorrere sotto la modale.
    const overflowPrecedente = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", suTasto);
      document.body.style.overflow = overflowPrecedente;
      precedente?.focus?.();
    };
    // Volutamente una sola volta: si monta con la modale e si smonta con lei.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return contenitore;
}
