#!/usr/bin/env bash
# Avvio in HTTPS con certificato Tailscale.
#
# Il TLS qui NON e' indurimento opzionale: senza secure context il browser non
# espone `crypto.subtle`, e il frontend non puo' derivare chiavi ne' decifrare
# nulla. Senza HTTPS l'app non funziona proprio — a parte su localhost.
#
# I certificati Tailscale sono firmati da una CA pubblica: nessun profilo da
# installare sui telefoni, nessun avviso da accettare.
set -euo pipefail

HOST="${VAULT_HOST:-$(tailscale status --json | python3 -c 'import json,sys; print(json.load(sys.stdin)["Self"]["DNSName"].rstrip("."))')}"
CERT_DIR="${VAULT_CERT_DIR:-./certs}"
PORT="${VAULT_PORT:-8443}"

mkdir -p "$CERT_DIR"
if [ ! -f "$CERT_DIR/$HOST.crt" ]; then
    echo "genero il certificato per $HOST..."
    tailscale cert --cert-file "$CERT_DIR/$HOST.crt" --key-file "$CERT_DIR/$HOST.key" "$HOST"
fi
chmod 600 "$CERT_DIR/$HOST.key"

echo "https://$HOST:$PORT"
exec .venv/bin/python -m uvicorn app.main:app \
    --host 0.0.0.0 --port "$PORT" \
    --ssl-certfile "$CERT_DIR/$HOST.crt" \
    --ssl-keyfile "$CERT_DIR/$HOST.key"
