/**
 * Lettura di QR code con la BarcodeDetector API del browser: niente libreria
 * di decodifica, che dovrebbe vedere il secret 2FA in chiaro. Dove l'API non
 * c'e' (Safari, Firefox) resta l'incolla manuale: il segreto e' scritto in
 * chiaro accanto a ogni QR di configurazione 2FA.
 */

interface RisultatoBarcode {
  rawValue: string;
}
interface RilevatoreBarcode {
  detect(source: ImageBitmapSource): Promise<RisultatoBarcode[]>;
}
interface CostruttoreBarcode {
  new (opts?: { formats?: string[] }): RilevatoreBarcode;
  getSupportedFormats?: () => Promise<string[]>;
}

function costruttore(): CostruttoreBarcode | null {
  const w = window as Window & { BarcodeDetector?: CostruttoreBarcode };
  return w.BarcodeDetector ?? null;
}

export function lettoreQrDisponibile(): boolean {
  return costruttore() !== null;
}

export function fotocameraDisponibile(): boolean {
  return lettoreQrDisponibile() && !!navigator.mediaDevices?.getUserMedia;
}

function nuovoRilevatore(): RilevatoreBarcode {
  const C = costruttore();
  if (!C) throw new Error("Questo browser non sa leggere i QR code: incolla il codice a mano.");
  return new C({ formats: ["qr_code"] });
}

/** Legge il primo QR da un'immagine (screenshot, foto). */
export async function leggiQrDaFile(file: File): Promise<string | null> {
  const bitmap = await createImageBitmap(file);
  try {
    const trovati = await nuovoRilevatore().detect(bitmap);
    return trovati[0]?.rawValue ?? null;
  } finally {
    bitmap.close();
  }
}

/**
 * Inquadra con la fotocamera finche' non compare un QR. Restituisce una
 * funzione per fermare tutto: la fotocamera va spenta anche se l'utente
 * chiude la finestra prima di aver inquadrato nulla.
 */
export function scansionaDaFotocamera(
  video: HTMLVideoElement,
  onTrovato: (valore: string) => void,
  onErrore: (msg: string) => void
): () => void {
  let fermato = false;
  let stream: MediaStream | null = null;
  let timer = 0;

  (async () => {
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
        audio: false,
      });
    } catch (err) {
      const nome = err instanceof Error ? err.name : "";
      onErrore(
        nome === "NotAllowedError"
          ? "Permesso fotocamera negato."
          : "Fotocamera non disponibile."
      );
      return;
    }
    if (fermato) {
      stream.getTracks().forEach((t) => t.stop());
      return;
    }
    video.srcObject = stream;
    await video.play().catch(() => {});
    const rilevatore = nuovoRilevatore();
    const giro = async () => {
      if (fermato) return;
      if (video.readyState >= 2) {
        try {
          const trovati = await rilevatore.detect(video);
          if (trovati[0]?.rawValue) {
            onTrovato(trovati[0].rawValue);
            return;
          }
        } catch {
          // frame non leggibile: si riprova al prossimo
        }
      }
      timer = window.setTimeout(giro, 250);
    };
    void giro();
  })();

  return () => {
    fermato = true;
    window.clearTimeout(timer);
    stream?.getTracks().forEach((t) => t.stop());
    video.srcObject = null;
  };
}
