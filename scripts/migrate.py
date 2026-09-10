"""Allinea un database esistente ai modelli, aggiungendo le colonne mancanti.

`Base.metadata.create_all()` crea le TABELLE che non esistono, ma non tocca
quelle gia' presenti: una colonna aggiunta a un modello non compare mai nel
database di chi ha gia' dei dati, e il primo SELECT che la nomina fallisce.

Lo script confronta i modelli con il database e genera gli ALTER TABLE che
mancano. E' idempotente: rieseguirlo non fa nulla.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import inspect, text  # noqa: E402

from app.core.config import settings  # noqa: E402
from app.db import models  # noqa: F401,E402  (registra i modelli nel metadata)
from app.db.base import Base, engine  # noqa: E402


def colonne_mancanti(conn) -> list[tuple[str, str, str]]:
    ispettore = inspect(conn)
    esistenti = set(ispettore.get_table_names())
    mancanti: list[tuple[str, str, str]] = []

    for tabella in Base.metadata.sorted_tables:
        if tabella.name not in esistenti:
            continue  # la crea create_all()
        presenti = {c["name"] for c in ispettore.get_columns(tabella.name)}
        for colonna in tabella.columns:
            if colonna.name in presenti:
                continue
            tipo = colonna.type.compile(engine.dialect)

            # SQLite non sa riempire retroattivamente una colonna NOT NULL:
            # serve un default, altrimenti le righe gia' presenti resterebbero
            # senza valore e l'ALTER viene rifiutato.
            frammento = f"{colonna.name} {tipo}"
            if not colonna.nullable:
                predefinito = getattr(colonna.default, "arg", None)
                if predefinito is None or callable(predefinito):
                    raise SystemExit(
                        f"{tabella.name}.{colonna.name} e' NOT NULL senza un default "
                        f"utilizzabile: va aggiunta a mano."
                    )
                letterale = (
                    f"'{predefinito}'"
                    if isinstance(predefinito, str)
                    else ("1" if predefinito is True else "0" if predefinito is False else str(predefinito))
                )
                frammento += f" NOT NULL DEFAULT {letterale}"
            mancanti.append((tabella.name, colonna.name, frammento))
    return mancanti


def run() -> None:
    print(f"database: {settings.db_path}")
    Base.metadata.create_all(engine)  # eventuali tabelle nuove

    with engine.begin() as conn:
        mancanti = colonne_mancanti(conn)
        if not mancanti:
            print("gia' allineato: nessuna colonna da aggiungere")
            return
        for tabella, colonna, frammento in mancanti:
            conn.execute(text(f"ALTER TABLE {tabella} ADD COLUMN {frammento}"))
            print(f"  + {tabella}.{colonna}")
    print(f"{len(mancanti)} colonne aggiunte")


if __name__ == "__main__":
    run()
