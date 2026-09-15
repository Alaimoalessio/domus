#!/usr/bin/env bash
# Avvio "di produzione" sul Mac: un solo processo che serve API e frontend.
#
# Se esiste un certificato Tailscale in certs/, ascolta in HTTPS su tutte le
# interfacce (raggiungibile dal telefono via VPN). Altrimenti resta in HTTP
# su 127.0.0.1: localhost e' contesto sicuro per il browser, la rete no.
set -euo pipefail
cd "$(dirname "$0")/.."

PORT="${VAULT_PORT:-8443}"
CERT_DIR="${VAULT_CERT_DIR:-./certs}"
CERT="$(ls "$CERT_DIR"/*.crt 2>/dev/null | head -1 || true)"

if [ -n "$CERT" ] && [ -f "${CERT%.crt}.key" ]; then
    echo "HTTPS su :$PORT con $(basename "$CERT")"
    exec .venv/bin/python -m uvicorn app.main:app \
        --host 0.0.0.0 --port "$PORT" --no-server-header \
        --ssl-certfile "$CERT" --ssl-keyfile "${CERT%.crt}.key"
else
    echo "nessun certificato in $CERT_DIR: HTTP solo su 127.0.0.1:8000"
    exec .venv/bin/python -m uvicorn app.main:app \
        --host 127.0.0.1 --port 8000 --no-server-header
fi
