#!/usr/bin/env bash
# Backup consistente. L'ORDINE conta.
#
# Prima il DB, poi i blob: lo snapshot del DB a T1 referenzia solo blob scritti
# prima di T1, tutti catturati dalla scansione a T2 > T1. L'ordine inverso
# produce riferimenti pendenti — righe che puntano a blob mai copiati.
#
# Funziona perche' i blob sono immutabili e le cancellazioni passano dal GC
# con periodo di grazia.
set -euo pipefail

DATA_DIR="${VAULT_DATA_DIR:-./data}"
DEST="${1:?uso: backup.sh /percorso/destinazione}"
STAMP="$(date +%Y%m%d-%H%M%S)"

mkdir -p "$DEST"

# 1. DB — VACUUM INTO produce una copia coerente senza fermare il server
sqlite3 "$DATA_DIR/vault.db" "VACUUM INTO '$DEST/vault-$STAMP.db'"
chmod 600 "$DEST/vault-$STAMP.db"

# 2. blob — incrementale reale: i file esistenti non vengono mai riscritti
rsync -a --info=stats1 "$DATA_DIR/blobs/" "$DEST/blobs/"

echo "backup completato: $DEST/vault-$STAMP.db + $DEST/blobs/"
