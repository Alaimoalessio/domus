import sqlite3
from datetime import datetime, timezone

from sqlalchemy import DateTime, create_engine, event
from sqlalchemy.orm import DeclarativeBase, sessionmaker
from sqlalchemy.types import TypeDecorator

from app.core.config import settings


class UtcDateTime(TypeDecorator):
    """SQLite non conserva il timezone: rilegge datetime naive, e confrontarle
    con `datetime.now(timezone.utc)` solleva TypeError al primo refresh token.

    Qui si scrive sempre UTC naive e si rilegge sempre UTC aware, in un punto
    solo. Un datetime naive in scrittura e' un errore, non un valore da
    indovinare: meglio fallire subito che salvare un'ora locale silenziosamente.
    """

    impl = DateTime
    cache_ok = True

    def process_bind_param(self, value: datetime | None, dialect):
        if value is None:
            return None
        if value.tzinfo is None:
            raise ValueError("datetime naive: usare sempre datetime aware in UTC")
        return value.astimezone(timezone.utc).replace(tzinfo=None)

    def process_result_value(self, value: datetime | None, dialect):
        if value is None:
            return None
        return value.replace(tzinfo=timezone.utc)


class Base(DeclarativeBase):
    pass


engine = create_engine(
    f"sqlite:///{settings.db_path}",
    connect_args={"check_same_thread": False, "timeout": 30},
)


@event.listens_for(engine, "connect")
def _pragmas(dbapi_conn: sqlite3.Connection, _record) -> None:
    cur = dbapi_conn.cursor()
    cur.execute("PRAGMA journal_mode=WAL")     # letture concorrenti alle scritture
    cur.execute("PRAGMA foreign_keys=ON")      # OFF di default: le CASCADE dipendono da questo
    cur.execute("PRAGMA synchronous=NORMAL")   # sicuro in modalita' WAL
    cur.execute("PRAGMA busy_timeout=30000")
    cur.close()


SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
