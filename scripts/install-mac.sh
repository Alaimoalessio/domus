#!/usr/bin/env bash
# Installa (o aggiorna) i servizi launchd di Domus per l'utente corrente.
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p logs ~/Library/LaunchAgents
for f in scripts/launchd/*.plist; do
    l=$(basename "$f" .plist)
    cp "$f" ~/Library/LaunchAgents/
    launchctl bootout "gui/$(id -u)/$l" 2>/dev/null || true
    launchctl bootstrap "gui/$(id -u)" ~/Library/LaunchAgents/"$l".plist
    echo "installato $l"
done
launchctl print "gui/$(id -u)/it.domus.server" | grep -E "state|pid" | head -2
