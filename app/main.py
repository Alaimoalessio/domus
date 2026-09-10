import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from app.api import admin, auth, files, vault
from app.core.config import settings
from app.db.base import Base, engine

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("domus")


@asynccontextmanager
async def lifespan(_: FastAPI):
    Base.metadata.create_all(engine)
    settings.db_path.chmod(0o600)
    log.info("Domus pronto — data_dir=%s", settings.data_dir)
    yield


app = FastAPI(
    title="Domus",
    version="1.0.0",
    description=(
        "Password manager zero-knowledge self-hosted. Il server conserva "
        "ciphertext opaco: non possiede alcuna chiave per leggerlo."
    ),
    lifespan=lifespan,
    # In produzione la documentazione interattiva e' ricognizione gratuita per
    # chi arriva sulla porta: elenca ogni endpoint e ogni campo atteso.
    docs_url="/docs" if settings.expose_docs else None,
    openapi_url="/openapi.json" if settings.expose_docs else None,
    redoc_url=None,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=False,   # i token viaggiano in Authorization, non in cookie: niente CSRF
    allow_methods=["GET", "POST", "PUT", "DELETE"],
    allow_headers=["Authorization", "Content-Type"],
)


# Content-Security-Policy. Vale solo se e' il backend a servire le pagine —
# ecco perche' `frontend_dir` esiste: con Vite davanti in sviluppo, o un proxy
# che serve i file per conto suo, questa intestazione non arriverebbe mai al
# documento che conta.
#
# `wasm-unsafe-eval` non e' negoziabile: Argon2 gira in WebAssembly, e senza di
# quello non si deriva nessuna chiave. `connect-src` elenca l'unica destinazione
# esterna che Domus contatta, e solo su richiesta dell'utente: se un giorno una
# dipendenza compromessa provasse a spedire dati altrove, il browser la ferma.
CSP = "; ".join([
    "default-src 'self'",
    "script-src 'self' 'wasm-unsafe-eval'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "connect-src 'self' https://api.pwnedpasswords.com",
    "worker-src 'self'",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
])

PERMESSI = "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()"


@app.middleware("http")
async def security_headers(request: Request, call_next):
    response = await call_next(request)

    # `no-store` SOLO sull'API: li' passano ciphertext e token, e non devono
    # finire in nessuna cache. Applicarlo anche ai file statici, come facevo
    # prima, ha due effetti sgraditi: il guscio dell'applicazione viene
    # riscaricato a ogni visita, e — verificato — il service worker non si
    # registra affatto, quindi salta la modalita' offline. I file statici hanno
    # gia' etag e last-modified, che bastano.
    if request.url.path.startswith("/api/"):
        response.headers.setdefault("Cache-Control", "no-store")
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("Referrer-Policy", "no-referrer")
    response.headers.setdefault("X-Frame-Options", "DENY")
    response.headers.setdefault("Content-Security-Policy", CSP)
    response.headers.setdefault("Permissions-Policy", PERMESSI)
    # Ignorata su http, applicata appena c'e' TLS: meglio averla gia' pronta
    # che ricordarsi di aggiungerla il giorno del passaggio a https.
    response.headers.setdefault("Strict-Transport-Security", "max-age=31536000")
    # Nota: l'intestazione Server la aggiunge uvicorn a valle del middleware,
    # quindi da qui non si sostituisce — si otterrebbe solo un doppione. Si
    # toglie con --no-server-header, come fa scripts/serve-tls.sh.
    return response


app.include_router(auth.router, prefix="/api/v1")
app.include_router(vault.router, prefix="/api/v1")
app.include_router(files.router, prefix="/api/v1")
app.include_router(admin.router, prefix="/api/v1")


@app.get("/health", tags=["meta"])
def health():
    return {"status": "ok"}


# Il frontend compilato, servito dallo stesso processo. Una sola origine
# significa niente CORS, niente proxy da configurare, e soprattutto la CSP
# applicata al documento e non solo alle risposte dell'API.
if settings.frontend_dir.is_dir():
    ASSET_DIR = settings.frontend_dir / "assets"
    if ASSET_DIR.is_dir():
        app.mount("/assets", StaticFiles(directory=ASSET_DIR), name="assets")

    @app.get("/{percorso:path}", include_in_schema=False)
    def spa(percorso: str):
        """Serve i file statici, e per ogni altra rotta restituisce index.html:
        e' un'applicazione a pagina singola, /settings esiste solo nel browser.

        `resolve()` e il controllo di appartenenza fermano i percorsi che
        risalgono l'albero: senza, un `..%2f..%2fetc%2fpasswd` uscirebbe dalla
        cartella del frontend."""
        radice = settings.frontend_dir.resolve()
        if percorso:
            candidato = (radice / percorso).resolve()
            if candidato.is_relative_to(radice) and candidato.is_file():
                return FileResponse(candidato)

        indice = radice / "index.html"
        if not indice.is_file():
            raise HTTPException(404)
        return FileResponse(indice)
