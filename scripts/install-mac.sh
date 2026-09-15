#!/usr/bin/env bash
# Installa (o aggiorna) i servizi launchd di Domus per l'utente corrente.
# Va eseguito dalla copia di deploy, FUORI da Scrivania/Documenti/Download:
# macOS nega a launchd l'accesso a quelle cartelle.
set -euo pipefail
cd "$(dirname "$0")/.."
DIR="$(pwd)"
case "$DIR" in
    "$HOME/Desktop"*|"$HOME/Documents"*|"$HOME/Downloads"*)
        echo "errore: $DIR e' in una cartella protetta da macOS; clona il repo in ~/domus" >&2; exit 1;;
esac
mkdir -p logs ~/Library/LaunchAgents
for f in scripts/launchd/*.plist; do
    l=$(basename "$f" .plist)
    sed "s#__DOMUS_DIR__#$DIR#g" "$f" > ~/Library/LaunchAgents/"$l".plist
    launchctl bootout "gui/$(id -u)/$l" 2>/dev/null || true
    launchctl bootstrap "gui/$(id -u)" ~/Library/LaunchAgents/"$l".plist
    echo "installato $l"
done
sleep 2
launchctl print "gui/$(id -u)/it.domus.server" | grep -E "^\s+(state|pid) " | head -2
