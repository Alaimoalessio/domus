import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware

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
    docs_url="/docs",
    redoc_url=None,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=False,   # i token viaggiano in Authorization, non in cookie: niente CSRF
    allow_methods=["GET", "POST", "PUT", "DELETE"],
    allow_headers=["Authorization", "Content-Type"],
)


@app.middleware("http")
async def security_headers(request: Request, call_next):
    response = await call_next(request)
    # Nessuna risposta di questa API deve finire in una cache intermedia.
    response.headers.setdefault("Cache-Control", "no-store")
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("Referrer-Policy", "no-referrer")
    response.headers.setdefault("X-Frame-Options", "DENY")
    return response


app.include_router(auth.router, prefix="/api/v1")
app.include_router(vault.router, prefix="/api/v1")
app.include_router(files.router, prefix="/api/v1")
app.include_router(admin.router, prefix="/api/v1")


@app.get("/health", tags=["meta"])
def health():
    return {"status": "ok"}
