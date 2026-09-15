import { Camera, ImageUp } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { fotocameraDisponibile, leggiQrDaFile, lettoreQrDisponibile, scansionaDaFotocamera } from "../lib/qr";

/**
 * Due modi per leggere il QR di un sito: inquadrarlo con la fotocamera (dal
 * telefono, guardando lo schermo del computer) o caricare uno screenshot
 * (dal computer stesso). Se il browser non sa leggere i QR, il componente
 * lo dice e non mostra pulsanti inutili.
 */
export function ScannerQr({ onLetto }: { onLetto: (valore: string) => void }) {
  const [attiva, setAttiva] = useState(false);
  const [errore, setErrore] = useState("");
  const video = useRef<HTMLVideoElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!attiva || !video.current) return;
    return scansionaDaFotocamera(
      video.current,
      (v) => {
        setAttiva(false);
        onLetto(v);
      },
      (msg) => {
        setAttiva(false);
        setErrore(msg);
      }
    );
  }, [attiva, onLetto]);

  const daFile = async (file: File | undefined) => {
    if (!file) return;
    setErrore("");
    try {
      const v = await leggiQrDaFile(file);
      if (!v) setErrore("Nessun QR code trovato nell'immagine.");
      else onLetto(v);
    } catch {
      setErrore("Immagine non leggibile.");
    } finally {
      if (fileInput.current) fileInput.current.value = "";
    }
  };

  if (!lettoreQrDisponibile()) {
    return (
      <p className="text-xs text-neutral-500">
        Questo browser non sa leggere i QR code: usa il codice scritto accanto al QR (il sito lo
        mostra sempre, di solito sotto "non riesci a scansionare?").
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {attiva ? (
        <div className="overflow-hidden rounded-xl border border-neutral-800 bg-black">
          <video ref={video} playsInline muted className="aspect-square w-full object-cover" />
          <button
            type="button"
            onClick={() => setAttiva(false)}
            className="w-full py-2 text-sm text-neutral-400 hover:text-neutral-100"
          >
            Annulla
          </button>
        </div>
      ) : (
        <div className="flex gap-2">
          {fotocameraDisponibile() && (
            <button
              type="button"
              onClick={() => {
                setErrore("");
                setAttiva(true);
              }}
              className="flex flex-1 items-center justify-center gap-2 rounded-lg border border-neutral-800 py-2.5 text-sm text-neutral-200 transition hover:border-neutral-700 hover:bg-neutral-800/50"
            >
              <Camera className="h-4 w-4" /> Inquadra il QR
            </button>
          )}
          <button
            type="button"
            onClick={() => fileInput.current?.click()}
            className="flex flex-1 items-center justify-center gap-2 rounded-lg border border-neutral-800 py-2.5 text-sm text-neutral-200 transition hover:border-neutral-700 hover:bg-neutral-800/50"
          >
            <ImageUp className="h-4 w-4" /> Da screenshot
          </button>
          <input
            ref={fileInput}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => void daFile(e.target.files?.[0])}
          />
        </div>
      )}
      {errore && <p className="text-xs text-amber-300">{errore}</p>}
    </div>
  );
}
